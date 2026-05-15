// ============================================
// KOYAMBEDU DAILY — Combined Controller
// Roles: superAdmin > admin > koyambeduSeller > buyer (user)
//
// SECURITY RULE: seller NEVER sees buyer address/phone.
// Only admin/superAdmin can see full buyer details.
// ============================================
'use strict';

const KoyambeduSeller       = require('../models/KoyambeduSeller');
const KoyambeduSellerAdmin  = require('../models/KoyambeduSellerAdmin');
const KoyambeduCategory     = require('../models/KoyambeduCategory');
const KoyambeduProduct      = require('../models/KoyambeduProduct');
const KoyambeduCart         = require('../models/KoyambeduCart');
const KoyambeduOrder        = require('../models/KoyambeduOrder');
const KoyambeduDeliverySlot = require('../models/KoyambeduDeliverySlot');
const User                  = require('../models/User');
const Razorpay              = require('razorpay');
const crypto                = require('crypto');
const {
  sendTemplateWhatsApp,
  sendOrderStatusWhatsApp,
} = require('../utils/sendWhatsApp');

// ── Delivery constants ───────────────────────
const KOYAMBEDU_LAT  = 13.0748;
const KOYAMBEDU_LNG  = 80.2136;
const MAX_RADIUS_KM  = 7;
const MIN_WEIGHT_KG  = 1;
const MAX_WEIGHT_KG  = 90;

/** Haversine distance in km */
const haversineKm = (lat1, lon1, lat2, lon2) => {
  const R    = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a    = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

/** Weight per item in kg */
const itemWeightKg = (item) => {
  const wpu = item.product?.weightKg != null ? item.product.weightKg
    : (item.unit === 'g' ? 0.001 : 1);
  return wpu * (item.quantity || 0);
};

/** Delivery charge based on total weight */
const calcDeliveryCharge = (totalKg) => {
  if (totalKg < MIN_WEIGHT_KG)  return { blocked: true,  reason: 'below_min', charge: 0 };
  if (totalKg > MAX_WEIGHT_KG)  return { blocked: true,  reason: 'above_max', charge: 0 };
  if (totalKg >= 20)            return { blocked: false,  reason: null,        charge: 249 };
  return                               { blocked: false,  reason: null,        charge: 149 };
};

const getRazorpay = () => {
  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) return null;
  return new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET });
};

// ── WhatsApp helpers (fire-and-forget) ──────
const waSend = (phone, params) => {
  const tpl = process.env.META_WHATSAPP_STATUS_TEMPLATE;
  if (!tpl || !phone) return;
  sendTemplateWhatsApp(phone, tpl, [
    { type: 'body', parameters: params.map(t => ({ type: 'text', text: String(t) })) },
  ]).then(r => {
    if (!r.success) console.warn('[KBD WA] Failed to', phone, r.error);
  }).catch(() => {});
};

// ─── Mask buyer details for seller view ─────
const maskOrder = (order) => {
  const o = order.toObject ? order.toObject() : { ...order };
  // Remove buyer identity fields
  delete o.buyer;
  delete o.shippingAddress;
  delete o.deliveryPersonPhone;
  delete o.paymentDetails;
  // Keep only safe item fields
  o.items = (o.items || []).map(it => ({
    _id:         it._id,
    name:        it.name,
    unit:        it.unit,
    unitLabel:   it.unitLabel,
    quantity:    it.quantity,
    deliveryType:it.deliveryType,
    orderedPrice:it.orderedPrice,
    finalPrice:  it.finalPrice,
    priceRevised:it.priceRevised,
    sellerPayout:it.sellerPayout,
    seller:      it.seller,
  }));
  return o;
};

// ══════════════════════════════════════════════
// SECTION 1 — PUBLIC / BUYER ROUTES
// ══════════════════════════════════════════════

/** GET /api/koyambedu/categories */
const getCategories = async (req, res) => {
  const cats = await KoyambeduCategory.find({ status: 'approved', isActive: true })
    .sort({ sortOrder: 1, name: 1 }).lean();
  // Build tree: root categories + their children
  const roots    = cats.filter(c => !c.parent);
  const children = cats.filter(c => c.parent);
  const tree = roots.map(r => ({
    ...r,
    subcategories: children.filter(c => String(c.parent) === String(r._id)),
  }));
  res.json({ success: true, categories: tree });
};

/** GET /api/koyambedu/products?category=&search=&deliveryType=&page= */
const getProducts = async (req, res) => {
  const { category, search, deliveryType, page = 1, limit = 20, sort = 'default' } = req.query;

  const filter = { isActive: true, isAvailable: true };
  if (category) filter.category = category;
  if (deliveryType === 'today')    filter.isSameDay = true;
  if (deliveryType === 'tomorrow') filter.isNextDay = true;
  if (search) filter.$text = { $search: search };

  const sortMap = {
    price_asc:  { currentPrice: 1 },
    price_desc: { currentPrice: -1 },
    fresh:      { freshArrivalDate: -1 },
    popular:    { totalOrders: -1 },
    default:    { freshArrivalDate: -1, totalOrders: -1 },
  };

  const skip = (Number(page) - 1) * Number(limit);
  const [products, total] = await Promise.all([
    KoyambeduProduct.find(filter)
      .populate('seller', 'businessName stallNumber marketSection rating')
      .populate('category', 'name icon')
      .sort(sortMap[sort] || sortMap.default)
      .skip(skip)
      .limit(Number(limit))
      .lean(),
    KoyambeduProduct.countDocuments(filter),
  ]);
  res.json({ success: true, products, total, page: Number(page), pages: Math.ceil(total / limit) });
};

/** GET /api/koyambedu/products/featured — home page sections */
const getFeaturedProducts = async (req, res) => {
  const base = { isActive: true, isAvailable: true };

  const [freshArrivals, deals, flowers, bulk, seasonal] = await Promise.all([
    KoyambeduProduct.find({ ...base, badges: 'fresh_arrival' })
      .populate('category', 'name icon').sort({ freshArrivalDate: -1 }).limit(8).lean(),
    KoyambeduProduct.find({ ...base, badges: 'best_seller' })
      .populate('category', 'name icon').sort({ totalOrders: -1 }).limit(8).lean(),
    KoyambeduProduct.find({ ...base, category: { $exists: true } })
      .populate('category', 'name icon slug')
      .sort({ totalOrders: -1 }).limit(8)
      .lean()
      .then(prods => prods.filter(p => p.category?.name?.toLowerCase().includes('flower') || p.category?.slug?.includes('flower'))),
    KoyambeduProduct.find({ ...base, isBulkAvailable: true })
      .populate('category', 'name icon').sort({ totalOrders: -1 }).limit(6).lean(),
    KoyambeduProduct.find({ ...base, badges: 'seasonal' })
      .populate('category', 'name icon').sort({ freshArrivalDate: -1 }).limit(6).lean(),
  ]);

  res.json({ success: true, sections: { freshArrivals, deals, flowers, bulk, seasonal } });
};

/** GET /api/koyambedu/products/:productId */
const getProductDetail = async (req, res) => {
  const product = await KoyambeduProduct.findOne({ _id: req.params.productId, isActive: true })
    .populate('seller', 'businessName stallNumber marketSection rating ratingCount offersSameDay offersNextDay sameDayCutoff')
    .populate('category', 'name nameTamil icon slug')
    .lean();
  if (!product) return res.status(404).json({ success: false, message: 'Product not found' });
  res.json({ success: true, product });
};

/** POST /api/koyambedu/check-delivery — validate location + return delivery charge */
const checkDeliveryAvailability = async (req, res) => {
  const { lat, lng } = req.body;
  if (lat == null || lng == null) {
    return res.status(400).json({
      success: false,
      available: false,
      message: 'Please share your location to check Koyambedu Fresh delivery availability.',
    });
  }

  const distanceKm = haversineKm(Number(lat), Number(lng), KOYAMBEDU_LAT, KOYAMBEDU_LNG);

  if (distanceKm > MAX_RADIUS_KM) {
    return res.json({
      success: true,
      available: false,
      distanceKm: Math.round(distanceKm * 10) / 10,
      message: 'We will extend our service soon to your area.',
    });
  }

  // Compute weight from cart (if logged in)
  let totalWeightKg = 0;
  let deliveryCharge = 149;
  let weightBlocked = false;
  let weightMessage = null;

  if (req.user) {
    const cart = await KoyambeduCart.findOne({ user: req.user._id })
      .populate({ path: 'items.product', select: 'weightKg unit' });
    if (cart?.items?.length) {
      totalWeightKg = cart.items.reduce((s, i) => s + itemWeightKg(i), 0);
      const calc = calcDeliveryCharge(totalWeightKg);
      deliveryCharge = calc.charge;
      if (calc.blocked && calc.reason === 'above_max') {
        weightBlocked = true;
        weightMessage = 'For orders above 90 kg, please contact us.';
      } else if (calc.blocked && calc.reason === 'below_min') {
        weightBlocked = true;
        weightMessage = 'Minimum order quantity is 1 kg.';
      }
    }
  }

  res.json({
    success: true,
    available: !weightBlocked,
    distanceKm: Math.round(distanceKm * 10) / 10,
    totalWeightKg: Math.round(totalWeightKg * 100) / 100,
    deliveryCharge,
    weightBlocked,
    message: weightBlocked ? weightMessage : `Delivery available · ${Math.round(distanceKm * 10) / 10} km from Koyambedu market`,
  });
};

/** GET /api/koyambedu/slots */
const getDeliverySlots = async (req, res) => {
  await KoyambeduDeliverySlot.seedDefaults();
  const now   = new Date();
  const hhmm  = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  const slots = await KoyambeduDeliverySlot.find({ isActive: true }).sort({ sortOrder: 1 }).lean();
  // Mark today slots as expired if past cutoff
  const enriched = slots.map(s => ({
    ...s,
    available: s.type === 'tomorrow' ? true : (hhmm <= s.cutoffTime),
  }));
  res.json({ success: true, slots: enriched });
};

// ══════════════════════════════════════════════
// SECTION 2 — CART (authenticated buyer)
// ══════════════════════════════════════════════

/** GET /api/koyambedu/cart */
const getCart = async (req, res) => {
  let cart = await KoyambeduCart.findOne({ user: req.user._id })
    .populate({
      path: 'items.product',
      select: 'name nameTamil currentPrice unit unitLabel minQty maxQty qtyStep isAvailable isActive isSameDay isNextDay images weightKg',
      populate: { path: 'seller', select: 'businessName isActive status' },
    }).lean();
  if (!cart) cart = { items: [] };
  if (cart.items) {
    cart.items = cart.items.filter(it =>
      it.product?.isActive && it.product?.isAvailable &&
      it.product?.seller?.isActive && it.product?.seller?.status === 'approved'
    );
  }
  res.json({ success: true, cart });
};

/** POST /api/koyambedu/cart — add or update item */
const updateCart = async (req, res) => {
  const { productId, quantity, deliveryType = 'tomorrow' } = req.body;

  const product = await KoyambeduProduct.findOne({ _id: productId, isActive: true, isAvailable: true })
    .populate('seller', '_id status isActive');
  if (!product) return res.status(404).json({ success: false, message: 'Product not found or unavailable' });
  if (product.seller?.status !== 'approved' || !product.seller?.isActive) {
    return res.status(400).json({ success: false, message: 'Seller not available' });
  }
  if (deliveryType === 'today' && !product.isSameDay) {
    return res.status(400).json({ success: false, message: 'Same-day delivery not available for this product' });
  }
  if (deliveryType === 'tomorrow' && !product.isNextDay) {
    return res.status(400).json({ success: false, message: 'Next-day delivery not available for this product' });
  }

  let cart = await KoyambeduCart.findOne({ user: req.user._id });
  if (!cart) cart = new KoyambeduCart({ user: req.user._id, items: [] });

  const idx = cart.items.findIndex(i => String(i.product) === String(productId));

  if (quantity <= 0) {
    if (idx > -1) cart.items.splice(idx, 1);
  } else {
    const qty = Math.max(product.minQty, Math.min(product.maxQty, Number(quantity)));
    const itemData = {
      product:     product._id,
      seller:      product.seller._id,
      name:        product.name,
      unitPrice:   product.currentPrice,
      unit:        product.unit,
      unitLabel:   product.unitLabel,
      quantity:    qty,
      deliveryType,
    };
    if (idx > -1) { Object.assign(cart.items[idx], itemData); }
    else          { cart.items.push(itemData); }
  }

  await cart.save();
  res.json({ success: true, cart });
};

/** DELETE /api/koyambedu/cart/clear */
const clearCart = async (req, res) => {
  await KoyambeduCart.findOneAndUpdate({ user: req.user._id }, { items: [] });
  res.json({ success: true });
};

// ══════════════════════════════════════════════
// SECTION 3 — ORDERS (buyer)
// ══════════════════════════════════════════════

/** POST /api/koyambedu/orders — place order */
const placeOrder = async (req, res) => {
  const { shippingAddress, paymentMethod = 'razorpay', deliverySlot, notes, buyerLocation } = req.body;

  // ── 1. Location mandatory ──────────────────────────────────
  if (!buyerLocation?.lat || !buyerLocation?.lng) {
    return res.status(400).json({
      success: false,
      message: 'Please share your location to check Koyambedu Fresh delivery availability.',
    });
  }

  // ── 2. Distance check ─────────────────────────────────────
  const distanceKm = haversineKm(
    Number(buyerLocation.lat), Number(buyerLocation.lng),
    KOYAMBEDU_LAT, KOYAMBEDU_LNG
  );
  if (distanceKm > MAX_RADIUS_KM) {
    return res.status(400).json({
      success: false,
      message: 'We will extend our service soon to your area.',
      distanceKm: Math.round(distanceKm * 10) / 10,
    });
  }

  // ── 3. Address ────────────────────────────────────────────
  if (!shippingAddress?.fullName || !shippingAddress?.addressLine1 || !shippingAddress?.pincode) {
    return res.status(400).json({ success: false, message: 'Full shipping address required' });
  }

  // ── 4. Cart ───────────────────────────────────────────────
  const cart = await KoyambeduCart.findOne({ user: req.user._id })
    .populate({
      path: 'items.product',
      populate: { path: 'seller', select: 'status isActive commissionRate contact businessName notifyWhatsApp' },
    });

  if (!cart || !cart.items.length) {
    return res.status(400).json({ success: false, message: 'Cart is empty' });
  }

  // ── 5. Weight check ───────────────────────────────────────
  const totalWeightKg = cart.items.reduce((s, ci) => s + itemWeightKg(ci), 0);

  if (totalWeightKg < MIN_WEIGHT_KG) {
    return res.status(400).json({ success: false, message: 'Minimum order quantity is 1 kg.' });
  }
  if (totalWeightKg > MAX_WEIGHT_KG) {
    return res.status(400).json({
      success: false,
      message: 'For orders above 90 kg, please contact us.',
      contactRequired: true,
    });
  }

  // ── 6. Build order items ──────────────────────────────────
  let subtotal = 0;
  const orderItems   = [];
  const deliveryTypes = new Set();

  for (const ci of cart.items) {
    const p  = ci.product;
    const sl = p.seller;
    if (!p?.isActive || !p?.isAvailable || sl?.status !== 'approved' || !sl?.isActive) {
      return res.status(400).json({ success: false, message: `"${p?.name || 'A product'}" is currently unavailable` });
    }
    const lineTotal    = p.currentPrice * ci.quantity;
    const commission   = (sl.commissionRate || 8) / 100;
    const sellerPayout = lineTotal * (1 - commission);
    subtotal += lineTotal;
    deliveryTypes.add(ci.deliveryType);
    orderItems.push({
      product:      p._id,
      seller:       sl._id,
      name:         p.name,
      unit:         p.unit,
      unitLabel:    p.unitLabel,
      quantity:     ci.quantity,
      deliveryType: ci.deliveryType,
      orderedPrice: p.currentPrice,
      finalPrice:   p.currentPrice,
      sellerPayout: Math.round(sellerPayout * 100) / 100,
    });
  }

  // ── 7. Delivery charge (weight-based) ─────────────────────
  const chargeCalc    = calcDeliveryCharge(totalWeightKg);
  const deliveryCharge = chargeCalc.charge;
  const serviceFee    = 10;
  const total         = subtotal + deliveryCharge + serviceFee;
  const deliveryType  = deliveryTypes.size > 1 ? 'mixed' : [...deliveryTypes][0];

  // ── 8. Save order ─────────────────────────────────────────
  const order = new KoyambeduOrder({
    buyer:        req.user._id,
    buyerLocation: {
      lat:        Number(buyerLocation.lat),
      lng:        Number(buyerLocation.lng),
      city:       buyerLocation.city || shippingAddress.city || 'Chennai',
      pincode:    buyerLocation.pincode || shippingAddress.pincode || '',
      distanceKm: Math.round(distanceKm * 10) / 10,
    },
    shippingAddress,
    items:        orderItems,
    deliveryType,
    deliverySlot: deliverySlot || '7 AM – 11 AM',
    paymentMethod,
    paymentStatus:'pending',
    orderStatus:  'placed',
    pricing:      { subtotal, deliveryCharge, serviceFee, total },
    adminNotes:   notes || '',
  });
  await order.save();

  await KoyambeduCart.findOneAndUpdate({ user: req.user._id }, { items: [] });

  if (paymentMethod === 'cod') {
    order.orderStatus = 'pending_confirmation';
    await order.save();
    setImmediate(() => _notifySellerNewOrder(order).catch(() => {}));
  }

  res.status(201).json({ success: true, order: { _id: order._id, orderId: order.orderId, total, paymentMethod, deliveryCharge } });
};

/** POST /api/koyambedu/orders/create-razorpay — initiate Razorpay payment */
const createRazorpayOrder = async (req, res) => {
  const { orderId } = req.body;
  const razorpay = getRazorpay();
  if (!razorpay) return res.status(503).json({ success: false, message: 'Payment gateway not configured' });

  const order = await KoyambeduOrder.findOne({ _id: orderId, buyer: req.user._id });
  if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

  const rzpOrder = await razorpay.orders.create({
    amount:   Math.round(order.pricing.total * 100),
    currency: 'INR',
    receipt:  order.orderId,
    notes:    { kbdOrderId: String(order._id) },
  });

  order.paymentDetails.razorpayOrderId = rzpOrder.id;
  await order.save();

  res.json({ success: true, rzpOrderId: rzpOrder.id, amount: order.pricing.total, currency: 'INR', orderId: order._id });
};

/** POST /api/koyambedu/orders/verify-payment */
const verifyPayment = async (req, res) => {
  const { orderId, razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;
  const order = await KoyambeduOrder.findOne({ _id: orderId, buyer: req.user._id });
  if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

  const secret = process.env.RAZORPAY_KEY_SECRET;
  const body   = `${razorpayOrderId}|${razorpayPaymentId}`;
  const expectedSig = crypto.createHmac('sha256', secret).update(body).digest('hex');
  if (expectedSig !== razorpaySignature) {
    return res.status(400).json({ success: false, message: 'Payment verification failed' });
  }

  order.paymentStatus = 'paid';
  order.orderStatus   = 'pending_confirmation';
  order.paymentDetails.razorpayOrderId   = razorpayOrderId;
  order.paymentDetails.razorpayPaymentId = razorpayPaymentId;
  order.paymentDetails.razorpaySignature = razorpaySignature;
  order.paymentDetails.paidAt = new Date();
  await order.save();

  setImmediate(() => _notifySellerNewOrder(order).catch(() => {}));

  res.json({ success: true, message: 'Payment confirmed!', orderId: order.orderId });
};

/** GET /api/koyambedu/my-orders */
const getMyOrders = async (req, res) => {
  const orders = await KoyambeduOrder.find({ buyer: req.user._id })
    .select('-buyer -shippingAddress.phone -deliveryPersonPhone')
    .populate('items.product', 'name images unit')
    .sort({ createdAt: -1 })
    .lean();
  res.json({ success: true, orders });
};

/** GET /api/koyambedu/my-orders/:orderId */
const getMyOrder = async (req, res) => {
  const order = await KoyambeduOrder.findOne({ _id: req.params.orderId, buyer: req.user._id })
    .populate('items.product', 'name images unit currentPrice')
    .lean();
  if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
  res.json({ success: true, order });
};

/** POST /api/koyambedu/orders/:orderId/approve-revision — buyer approves price revision */
const approveRevision = async (req, res) => {
  const { approve } = req.body; // true or false
  const order = await KoyambeduOrder.findOne({ _id: req.params.orderId, buyer: req.user._id });
  if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
  if (order.orderStatus !== 'price_revision_pending') {
    return res.status(400).json({ success: false, message: 'No pending price revision for this order' });
  }

  if (approve) {
    order.priceRevision.buyerResponse = 'approved';
    order.priceRevision.respondedAt   = new Date();
    order.pricing.revisedTotal        = order.priceRevision.revisedTotal;
    order.orderStatus                 = 'confirmed';
    // Update finalPrice on each revised item
    for (const rev of order.priceRevision.revisedItems) {
      const item = order.items.find(i => String(i.product) === String(rev.productId));
      if (item) { item.finalPrice = rev.revisedPrice; item.priceRevised = true; }
    }
    await order.save();

    // Notify admin
    console.log(`[KBD] Buyer approved price revision for order ${order.orderId}`);
    res.json({ success: true, message: 'Price revision approved. Your order is now confirmed!', order });
  } else {
    order.priceRevision.buyerResponse = 'rejected';
    order.priceRevision.respondedAt   = new Date();
    order.orderStatus  = 'cancelled';
    order.cancelReason = 'Buyer rejected revised pricing';
    await order.save();

    // Initiate refund if online payment
    if (order.paymentStatus === 'paid' && order.paymentMethod === 'razorpay') {
      setImmediate(() => _refundOrder(order).catch(() => {}));
    }
    res.json({ success: true, message: 'Order cancelled. Refund will be initiated shortly.' });
  }
};

/** POST /api/koyambedu/orders/:orderId/cancel — buyer cancel */
const cancelOrder = async (req, res) => {
  const order = await KoyambeduOrder.findOne({ _id: req.params.orderId, buyer: req.user._id });
  if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
  if (['dispatched','delivered','cancelled'].includes(order.orderStatus)) {
    return res.status(400).json({ success: false, message: 'Order cannot be cancelled at this stage' });
  }
  order.orderStatus  = 'cancelled';
  order.cancelReason = req.body.reason || 'Cancelled by buyer';
  await order.save();
  if (order.paymentStatus === 'paid' && order.paymentMethod === 'razorpay') {
    setImmediate(() => _refundOrder(order).catch(() => {}));
  }
  res.json({ success: true, message: 'Order cancelled' });
};

// ══════════════════════════════════════════════
// SECTION 4 — SELLER ROUTES
// ══════════════════════════════════════════════

/** POST /api/koyambedu/seller/register */
const sellerRegister = async (req, res) => {
  const existing = await KoyambeduSeller.findOne({ user: req.user._id });
  if (existing) return res.status(400).json({ success: false, message: 'You already have a Koyambedu seller account' });

  const {
    businessName, ownerName, stallNumber, marketSection,
    contactPhone, contactEmail, productTypes, description,
    bankAccountName, bankAccountNumber, bankIfsc, bankName, bankUpi,
  } = req.body;

  if (!businessName || !ownerName || !contactPhone) {
    return res.status(400).json({ success: false, message: 'Business name, owner name and phone are required' });
  }

  const seller = await KoyambeduSeller.create({
    user: req.user._id,
    businessName, ownerName, stallNumber, marketSection, description,
    contact: { phone: contactPhone, email: contactEmail },
    productTypes: productTypes || [],
    bankDetails: {
      accountName: bankAccountName,
      accountNumber: bankAccountNumber,
      ifsc: bankIfsc,
      bankName: bankName,
      upiId: bankUpi,
    },
  });

  res.status(201).json({ success: true, message: 'Registration submitted. Awaiting admin approval.', seller });
};

/** GET /api/koyambedu/seller/profile */
const getSellerProfile = async (req, res) => {
  const seller = await KoyambeduSeller.findOne({ user: req.user._id });
  if (!seller) return res.status(404).json({ success: false, message: 'Seller profile not found' });
  res.json({ success: true, seller });
};

/** PUT /api/koyambedu/seller/profile */
const updateSellerProfile = async (req, res) => {
  const seller = await KoyambeduSeller.findOne({ user: req.user._id });
  if (!seller) return res.status(404).json({ success: false, message: 'Seller profile not found' });
  const { businessName, ownerName, stallNumber, marketSection, description,
    offersSameDay, offersNextDay, sameDayCutoff, notifyWhatsApp } = req.body;
  Object.assign(seller, {
    ...(businessName  && { businessName }),
    ...(ownerName     && { ownerName }),
    ...(stallNumber   !== undefined && { stallNumber }),
    ...(marketSection !== undefined && { marketSection }),
    ...(description   !== undefined && { description }),
    ...(offersSameDay !== undefined && { offersSameDay }),
    ...(offersNextDay !== undefined && { offersNextDay }),
    ...(sameDayCutoff && { sameDayCutoff }),
    ...(notifyWhatsApp!== undefined && { notifyWhatsApp }),
  });
  await seller.save();
  res.json({ success: true, seller });
};

// ── SELLER PRODUCTS ──────────────────────────

/** GET /api/koyambedu/seller/products */
const getSellerProducts = async (req, res) => {
  const seller = await KoyambeduSeller.findOne({ user: req.user._id });
  if (!seller) return res.status(403).json({ success: false, message: 'Seller profile not found' });
  const products = await KoyambeduProduct.find({ seller: seller._id })
    .populate('category', 'name icon').sort({ createdAt: -1 }).lean();
  res.json({ success: true, products });
};

/** POST /api/koyambedu/seller/products */
const createSellerProduct = async (req, res) => {
  const seller = await KoyambeduSeller.findOne({ user: req.user._id, status: 'approved', isActive: true });
  if (!seller) return res.status(403).json({ success: false, message: 'Seller not approved' });

  const {
    categoryId, name, nameTamil, description, unit, unitLabel,
    minQty, maxQty, qtyStep, marketPriceMin, marketPriceMax, currentPrice,
    stockQty, freshArrivalTime, isSameDay, isNextDay, sameDayCutoff,
    badges, tags, isBulkAvailable, bulkMinQty, bulkPricePerUnit, isRecurringAllowed,
  } = req.body;

  if (!categoryId || !name || !currentPrice) {
    return res.status(400).json({ success: false, message: 'Category, name and price are required' });
  }

  const category = await KoyambeduCategory.findOne({ _id: categoryId, status: 'approved', isActive: true });
  if (!category) return res.status(400).json({ success: false, message: 'Invalid or unapproved category' });

  const product = await KoyambeduProduct.create({
    seller: seller._id, category: category._id,
    name, nameTamil, description, unit: unit || 'kg', unitLabel: unitLabel || unit || 'kg',
    minQty: minQty || 0.5, maxQty: maxQty || 50, qtyStep: qtyStep || 0.5,
    weightKg: req.body.weightKg != null ? Number(req.body.weightKg) : (unit === 'g' ? 0.001 : 1),
    marketPriceMin, marketPriceMax, currentPrice: Number(currentPrice),
    stockQty: stockQty || 0,
    freshArrivalTime: freshArrivalTime || '',
    freshArrivalDate: freshArrivalTime ? new Date() : undefined,
    isSameDay: isSameDay !== false, isNextDay: isNextDay !== false,
    sameDayCutoff: sameDayCutoff || seller.sameDayCutoff,
    badges: badges || [], tags: tags || [],
    isBulkAvailable: isBulkAvailable || false, bulkMinQty, bulkPricePerUnit,
    isRecurringAllowed: isRecurringAllowed || false,
  });

  res.status(201).json({ success: true, product });
};

/** PUT /api/koyambedu/seller/products/:productId */
const updateSellerProduct = async (req, res) => {
  const seller  = await KoyambeduSeller.findOne({ user: req.user._id });
  if (!seller) return res.status(403).json({ success: false, message: 'Not a seller' });
  const product = await KoyambeduProduct.findOne({ _id: req.params.productId, seller: seller._id });
  if (!product) return res.status(404).json({ success: false, message: 'Product not found' });

  const allowed = ['name','nameTamil','description','unit','unitLabel','minQty','maxQty','qtyStep',
    'marketPriceMin','marketPriceMax','currentPrice','stockQty','freshArrivalTime',
    'isSameDay','isNextDay','sameDayCutoff','badges','tags','isActive','isAvailable',
    'isBulkAvailable','bulkMinQty','bulkPricePerUnit','isRecurringAllowed','weightKg'];

  for (const k of allowed) {
    if (req.body[k] !== undefined) product[k] = req.body[k];
  }
  if (req.body.freshArrivalTime) product.freshArrivalDate = new Date();
  if (req.body.currentPrice)     product.priceUpdatedAt   = new Date();
  await product.save();

  res.json({ success: true, product });
};

/** PATCH /api/koyambedu/seller/products/:productId/toggle */
const toggleProductAvailability = async (req, res) => {
  const seller  = await KoyambeduSeller.findOne({ user: req.user._id });
  if (!seller) return res.status(403).json({ success: false, message: 'Not a seller' });
  const product = await KoyambeduProduct.findOne({ _id: req.params.productId, seller: seller._id });
  if (!product) return res.status(404).json({ success: false, message: 'Product not found' });
  product.isAvailable = !product.isAvailable;
  await product.save();
  res.json({ success: true, isAvailable: product.isAvailable });
};

/** DELETE /api/koyambedu/seller/products/:productId */
const deleteSellerProduct = async (req, res) => {
  const seller = await KoyambeduSeller.findOne({ user: req.user._id });
  if (!seller) return res.status(403).json({ success: false, message: 'Not a seller' });
  const product = await KoyambeduProduct.findOneAndDelete({ _id: req.params.productId, seller: seller._id });
  if (!product) return res.status(404).json({ success: false, message: 'Product not found' });
  res.json({ success: true, message: 'Product deleted' });
};

// ── SELLER ORDERS (masked — no buyer info) ──────

/** GET /api/koyambedu/seller/orders */
const getSellerOrders = async (req, res) => {
  const seller = await KoyambeduSeller.findOne({ user: req.user._id });
  if (!seller) return res.status(403).json({ success: false, message: 'Not a seller' });

  const orders = await KoyambeduOrder.find({
    'items.seller': seller._id,
    orderStatus: { $nin: ['placed'] }, // only show after payment confirmed
  }).sort({ createdAt: -1 }).lean();

  // Filter items per this seller only + mask buyer details
  const masked = orders.map(o => {
    const sellerItems = o.items.filter(i => String(i.seller) === String(seller._id));
    const payout = sellerItems.reduce((s, i) => s + (i.sellerPayout || 0) * i.quantity, 0);
    return {
      _id:          o._id,
      orderId:      o.orderId,
      orderStatus:  o.orderStatus,
      deliveryType: o.deliveryType,
      deliverySlot: o.deliverySlot,
      deliveryDate: o.deliveryDate,
      items:        sellerItems,
      estimatedPayout: Math.round(payout * 100) / 100,
      priceRevision:  o.priceRevision?.requested ? {
        requested:    true,
        buyerResponse:o.priceRevision.buyerResponse,
      } : { requested: false },
      placedAt:     o.placedAt,
      createdAt:    o.createdAt,
    };
  });

  res.json({ success: true, orders: masked });
};

/** POST /api/koyambedu/seller/orders/:orderId/confirm-stock */
const confirmStock = async (req, res) => {
  const seller = await KoyambeduSeller.findOne({ user: req.user._id });
  if (!seller) return res.status(403).json({ success: false, message: 'Not a seller' });

  const order = await KoyambeduOrder.findOne({
    _id: req.params.orderId,
    'items.seller': seller._id,
    orderStatus: 'pending_confirmation',
  });
  if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

  order.orderStatus = 'confirmed';
  order.confirmedAt = new Date();
  await order.save();

  // Notify buyer: order confirmed
  _notifyBuyer(order, 'confirmed');

  res.json({ success: true, message: 'Stock confirmed. Order is now processing.' });
};

/** POST /api/koyambedu/seller/orders/:orderId/request-price-revision */
const requestPriceRevision = async (req, res) => {
  const seller = await KoyambeduSeller.findOne({ user: req.user._id });
  if (!seller) return res.status(403).json({ success: false, message: 'Not a seller' });

  const { revisedItems } = req.body; // [{ productId, revisedPrice }]
  if (!revisedItems?.length) return res.status(400).json({ success: false, message: 'Revised items required' });

  const order = await KoyambeduOrder.findOne({
    _id: req.params.orderId,
    'items.seller': seller._id,
    orderStatus: { $in: ['pending_confirmation', 'confirmed'] },
  });
  if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

  // Build revision detail
  const revisedItemDetails = [];
  let   newTotal = order.pricing.subtotal;

  for (const rev of revisedItems) {
    const item = order.items.find(i => String(i.product) === String(rev.productId));
    if (!item) continue;
    const diff = (rev.revisedPrice - item.orderedPrice) * item.quantity;
    newTotal += diff;
    revisedItemDetails.push({
      productId:     item.product,
      name:          item.name,
      originalPrice: item.orderedPrice,
      revisedPrice:  Number(rev.revisedPrice),
    });
  }

  order.priceRevision = {
    requested:    true,
    requestedAt:  new Date(),
    requestedBy:  seller._id,
    revisedItems: revisedItemDetails,
    revisedTotal: newTotal + order.pricing.deliveryCharge + order.pricing.serviceFee,
    buyerResponse:'pending',
  };
  order.orderStatus = 'price_revision_pending';
  await order.save();

  // Notify buyer for approval
  _notifyBuyerPriceRevision(order);

  res.json({ success: true, message: 'Price revision request sent to buyer.' });
};

// ── SELLER CATEGORIES ────────────────────────

/** POST /api/koyambedu/seller/categories */
const createSellerCategory = async (req, res) => {
  const seller = await KoyambeduSeller.findOne({ user: req.user._id, status: 'approved' });
  if (!seller) return res.status(403).json({ success: false, message: 'Seller not approved' });
  const { name, nameTamil, icon, parentId, description } = req.body;
  if (!name) return res.status(400).json({ success: false, message: 'Category name required' });
  const cat = await KoyambeduCategory.create({
    name, nameTamil, icon, description,
    parent: parentId || null,
    createdBy: seller._id,
    status: 'pending', // requires admin approval
  });
  res.status(201).json({ success: true, message: 'Category submitted for admin approval', category: cat });
};

// ══════════════════════════════════════════════
// SECTION 5 — ADMIN ROUTES
// ══════════════════════════════════════════════

/** GET /api/koyambedu/admin/dashboard */
const adminDashboard = async (req, res) => {
  const today = new Date(); today.setHours(0,0,0,0);
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);

  const [
    todayOrders, pendingDispatch, delivered, revenue,
    pendingRevisions, sellers, pendingCategories,
  ] = await Promise.all([
    KoyambeduOrder.countDocuments({ createdAt: { $gte: today } }),
    KoyambeduOrder.countDocuments({ orderStatus: { $in: ['confirmed','packing'] } }),
    KoyambeduOrder.countDocuments({ orderStatus: 'delivered', deliveredAt: { $gte: today } }),
    KoyambeduOrder.aggregate([
      { $match: { paymentStatus: 'paid', createdAt: { $gte: today } } },
      { $group: { _id: null, total: { $sum: '$pricing.total' } } },
    ]),
    KoyambeduOrder.countDocuments({ orderStatus: 'price_revision_pending' }),
    KoyambeduSeller.countDocuments({ isApproved: true, isActive: true }),
    KoyambeduCategory.countDocuments({ status: 'pending' }),
  ]);

  res.json({ success: true, stats: {
    todayOrders, pendingDispatch, delivered,
    todayRevenue: revenue[0]?.total || 0,
    pendingRevisions, activeSellers: sellers, pendingCategories,
  }});
};

/** GET /api/koyambedu/admin/orders */
const adminGetOrders = async (req, res) => {
  const { status, page = 1, limit = 20, deliveryType, search } = req.query;
  const filter = {};
  if (status) filter.orderStatus = status;
  if (deliveryType) filter.deliveryType = deliveryType;
  if (search) filter.orderId = { $regex: search, $options: 'i' };

  const skip = (Number(page) - 1) * Number(limit);
  const [orders, total] = await Promise.all([
    KoyambeduOrder.find(filter)
      .populate('buyer', 'name email phone')
      .populate('items.seller', 'businessName stallNumber contact')
      .sort({ createdAt: -1 }).skip(skip).limit(Number(limit)).lean(),
    KoyambeduOrder.countDocuments(filter),
  ]);
  res.json({ success: true, orders, total, page: Number(page), pages: Math.ceil(total / limit) });
};

/** PATCH /api/koyambedu/admin/orders/:orderId/status */
const adminUpdateOrderStatus = async (req, res) => {
  const { status, deliveryPartner, deliveryPersonPhone, adminNotes } = req.body;
  const order = await KoyambeduOrder.findById(req.params.orderId)
    .populate('buyer', 'email phone name');
  if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

  const prev = order.orderStatus;
  order.orderStatus = status;
  if (adminNotes)         order.adminNotes         = adminNotes;
  if (deliveryPartner)    order.deliveryPartner     = deliveryPartner;
  if (deliveryPersonPhone)order.deliveryPersonPhone = deliveryPersonPhone;
  if (status === 'dispatched') order.dispatchedAt = new Date();
  if (status === 'delivered')  order.deliveredAt  = new Date();
  await order.save();

  // Notify buyer of dispatch / delivery
  if (['dispatched','delivered','confirmed'].includes(status)) {
    _notifyBuyer(order, status);
  }

  res.json({ success: true, order });
};

/** GET /api/koyambedu/admin/sellers */
const adminGetSellers = async (req, res) => {
  const { status, page = 1, limit = 20 } = req.query;
  const filter = {};
  if (status) filter.status = status; // pending_review | approved | rejected | suspended
  const skip = (Number(page) - 1) * Number(limit);
  const [sellers, total] = await Promise.all([
    KoyambeduSeller.find(filter)
      .populate('user', 'name email')
      .populate('createdBySellerAdmin', 'name businessName')
      .sort({ createdAt: -1 }).skip(skip).limit(Number(limit)).lean(),
    KoyambeduSeller.countDocuments(filter),
  ]);
  res.json({ success: true, sellers, total });
};

/** PATCH /api/koyambedu/admin/sellers/:sellerId/approve — SuperAdmin only */
const adminApproveSeller = async (req, res) => {
  const { action, reason } = req.body; // action: 'approve' | 'reject' | 'suspend' | 'unsuspend'
  const seller = await KoyambeduSeller.findById(req.params.sellerId).populate('user', 'name email');
  if (!seller) return res.status(404).json({ success: false, message: 'Seller not found' });

  switch (action) {
    case 'approve':
      seller.status      = 'approved';
      seller.isActive    = true;
      seller.approvedBy  = req.user._id;
      seller.approvedAt  = new Date();
      seller.rejectedReason = undefined;
      break;
    case 'reject':
      seller.status         = 'rejected';
      seller.isActive       = false;
      seller.rejectedReason = reason || 'Does not meet requirements';
      break;
    case 'suspend':
      seller.status   = 'suspended';
      seller.isActive = false;
      await KoyambeduProduct.updateMany({ seller: seller._id }, { isActive: false });
      break;
    case 'unsuspend':
      seller.status   = 'approved';
      seller.isActive = true;
      await KoyambeduProduct.updateMany({ seller: seller._id }, { isActive: true });
      break;
    default:
      return res.status(400).json({ success: false, message: 'Invalid action. Use: approve | reject | suspend | unsuspend' });
  }
  await seller.save();
  res.json({ success: true, seller });
};

/** PATCH /api/koyambedu/admin/sellers/:sellerId/toggle — admin toggle active */
const adminToggleSeller = async (req, res) => {
  const seller = await KoyambeduSeller.findById(req.params.sellerId);
  if (!seller) return res.status(404).json({ success: false, message: 'Seller not found' });
  seller.isActive = !seller.isActive;
  await seller.save();
  if (!seller.isActive) {
    await KoyambeduProduct.updateMany({ seller: seller._id }, { isActive: false });
  }
  res.json({ success: true, isActive: seller.isActive });
};

// ══════════════════════════════════════════════
// SECTION 5B — SELLER ADMIN ROUTES (SuperAdmin only)
// ══════════════════════════════════════════════

/** GET /api/koyambedu/admin/user-search?q=email_or_phone — find an Eptomart user */
const adminUserSearch = async (req, res) => {
  const { q } = req.query;
  if (!q || q.trim().length < 3) return res.json({ success: true, users: [] });
  const User = require('../models/User');
  const regex = new RegExp(q.trim(), 'i');
  const users = await User.find({
    $or: [{ email: regex }, { phone: regex }, { name: regex }],
    role: 'user',
    isActive: true,
  }).select('_id name email phone').limit(8).lean();
  res.json({ success: true, users });
};

/** POST /api/koyambedu/admin/seller-admins — create a SellerAdmin */
const adminCreateSellerAdmin = async (req, res) => {
  const { userId, name, businessName, contactPhone, contactEmail, notes } = req.body;
  if (!userId || !name) {
    return res.status(400).json({ success: false, message: 'userId and name are required' });
  }
  const existing = await KoyambeduSellerAdmin.findOne({ user: userId });
  if (existing) return res.status(400).json({ success: false, message: 'This user is already a SellerAdmin' });

  const sa = await KoyambeduSellerAdmin.create({
    user: userId, name, businessName, contactPhone, contactEmail, notes,
    createdBy: req.user._id,
    status:    'pending_review',
  });
  res.status(201).json({ success: true, sellerAdmin: sa });
};

/** GET /api/koyambedu/admin/seller-admins */
const adminGetSellerAdmins = async (req, res) => {
  const { status } = req.query;
  const filter = status ? { status } : {};
  const sas = await KoyambeduSellerAdmin.find(filter)
    .populate('user', 'name email')
    .populate('createdBy', 'name')
    .sort({ createdAt: -1 }).lean();
  res.json({ success: true, sellerAdmins: sas });
};

/** PATCH /api/koyambedu/admin/seller-admins/:saId/approve */
const adminApproveSellerAdmin = async (req, res) => {
  const { action, reason } = req.body; // approve | reject | suspend
  const sa = await KoyambeduSellerAdmin.findById(req.params.saId);
  if (!sa) return res.status(404).json({ success: false, message: 'SellerAdmin not found' });

  if (action === 'approve') {
    sa.status     = 'approved';
    sa.approvedBy = req.user._id;
    sa.approvedAt = new Date();
  } else if (action === 'reject') {
    sa.status         = 'rejected';
    sa.rejectedReason = reason || 'Rejected by SuperAdmin';
  } else if (action === 'suspend') {
    sa.status = 'suspended';
  } else {
    return res.status(400).json({ success: false, message: 'Invalid action' });
  }
  await sa.save();
  res.json({ success: true, sellerAdmin: sa });
};

// ── SellerAdmin Portal (protectSellerAdmin middleware required) ──

/** GET /api/koyambedu/seller-admin/profile */
const sellerAdminGetProfile = async (req, res) => {
  const sa = await KoyambeduSellerAdmin.findOne({ user: req.user._id });
  if (!sa) return res.status(404).json({ success: false, message: 'SellerAdmin profile not found' });
  res.json({ success: true, sellerAdmin: sa });
};

/** GET /api/koyambedu/seller-admin/sellers — list sellers this SA created */
const sellerAdminGetSellers = async (req, res) => {
  const sa = await KoyambeduSellerAdmin.findOne({ user: req.user._id, status: 'approved' });
  if (!sa) return res.status(403).json({ success: false, message: 'SellerAdmin not approved' });
  const sellers = await KoyambeduSeller.find({ createdBySellerAdmin: sa._id })
    .populate('user', 'name email').sort({ createdAt: -1 }).lean();
  res.json({ success: true, sellers });
};

/** POST /api/koyambedu/seller-admin/sellers — register a new seller under this SA */
const sellerAdminCreateSeller = async (req, res) => {
  const sa = await KoyambeduSellerAdmin.findOne({ user: req.user._id, status: 'approved' });
  if (!sa) return res.status(403).json({ success: false, message: 'SellerAdmin not approved' });

  const {
    businessName, ownerName, stallNumber, marketSection,
    contactPhone, contactEmail, productTypes, description,
    bankAccountName, bankAccountNumber, bankIfsc, bankName, bankUpi,
    // optional Eptomart account creation
    createAccount, accountPhone, accountEmail,
  } = req.body;

  if (!businessName || !ownerName || !contactPhone) {
    return res.status(400).json({ success: false, message: 'businessName, ownerName and contactPhone are required' });
  }

  // Check duplicate by phone to avoid accidental duplicates
  const existing = await KoyambeduSeller.findOne({ 'contact.phone': contactPhone });
  if (existing) return res.status(400).json({ success: false, message: 'A seller with this phone number already exists' });

  // Optionally create / link an Eptomart account so the seller can log in later
  let linkedUserId = null;
  if (createAccount && (accountPhone || accountEmail)) {
    const orQuery = [];
    if (accountPhone) orQuery.push({ phone: accountPhone });
    if (accountEmail) orQuery.push({ email: accountEmail.toLowerCase() });
    let linkedUser = await User.findOne({ $or: orQuery });
    if (!linkedUser) {
      linkedUser = await User.create({
        name:     ownerName,
        phone:    accountPhone  || undefined,
        email:    accountEmail ? accountEmail.toLowerCase() : undefined,
        role:     'user',
        isActive: true,
      });
    }
    linkedUserId = linkedUser._id;
  }

  const seller = await KoyambeduSeller.create({
    ...(linkedUserId && { user: linkedUserId }),
    businessName, ownerName, stallNumber, marketSection, description,
    contact: { phone: contactPhone, email: contactEmail },
    productTypes: productTypes || [],
    bankDetails: {
      accountName: bankAccountName,
      accountNumber: bankAccountNumber,
      ifsc: bankIfsc, bankName, upiId: bankUpi,
    },
    status:               'pending_review',
    createdBySellerAdmin: sa._id,
  });

  res.status(201).json({ success: true, message: 'Seller registered. Awaiting SuperAdmin approval.', seller });
};

// ── Shared product-creation helper ──────────────────────────────────────────
const _createProductForSeller = async (seller, body) => {
  const {
    categoryId, name, nameTamil, description, unit, unitLabel,
    minQty, maxQty, qtyStep, marketPriceMin, marketPriceMax, currentPrice,
    stockQty, freshArrivalTime, isSameDay, isNextDay, sameDayCutoff,
    badges, tags, isBulkAvailable, bulkMinQty, bulkPricePerUnit, weightKg,
  } = body;

  if (!categoryId || !name || currentPrice == null) {
    throw Object.assign(new Error('Category, name and price are required'), { statusCode: 400 });
  }

  const category = await KoyambeduCategory.findOne({ _id: categoryId, isActive: true });
  if (!category) throw Object.assign(new Error('Invalid or inactive category'), { statusCode: 400 });

  return KoyambeduProduct.create({
    seller:   seller._id,
    category: category._id,
    name, nameTamil, description,
    unit:      unit      || 'kg',
    unitLabel: unitLabel || unit || 'kg',
    minQty:    minQty    || 0.5,
    maxQty:    maxQty    || 50,
    qtyStep:   qtyStep   || 0.5,
    weightKg:  weightKg  != null ? Number(weightKg) : (unit === 'g' ? 0.001 : 1),
    marketPriceMin, marketPriceMax,
    currentPrice: Number(currentPrice),
    stockQty:     stockQty || 0,
    freshArrivalTime: freshArrivalTime || '',
    freshArrivalDate: freshArrivalTime ? new Date() : undefined,
    isSameDay:    isSameDay    !== false,
    isNextDay:    isNextDay    !== false,
    sameDayCutoff: sameDayCutoff || seller.sameDayCutoff || '10:00',
    badges: badges || [],
    tags:   tags   || [],
    isBulkAvailable: isBulkAvailable || false,
    bulkMinQty, bulkPricePerUnit,
  });
};

/** POST /api/koyambedu/seller-admin/sellers/:sellerId/products — SA adds product for their seller */
const sellerAdminCreateProduct = async (req, res) => {
  const sa = await KoyambeduSellerAdmin.findOne({ user: req.user._id, status: 'approved' });
  if (!sa) return res.status(403).json({ success: false, message: 'SellerAdmin not approved' });

  const seller = await KoyambeduSeller.findOne({ _id: req.params.sellerId, createdBySellerAdmin: sa._id });
  if (!seller) return res.status(403).json({ success: false, message: 'Seller not managed by this SellerAdmin' });
  if (seller.status !== 'approved') {
    return res.status(400).json({ success: false, message: 'Seller must be approved before adding products' });
  }

  const product = await _createProductForSeller(seller, req.body);
  res.status(201).json({ success: true, product });
};

/** POST /api/koyambedu/admin/sellers/:sellerId/products — admin adds product for any seller */
const adminCreateProduct = async (req, res) => {
  const seller = await KoyambeduSeller.findById(req.params.sellerId);
  if (!seller) return res.status(404).json({ success: false, message: 'Seller not found' });

  const product = await _createProductForSeller(seller, req.body);
  res.status(201).json({ success: true, product });
};

/** PUT /api/koyambedu/seller-admin/sellers/:sellerId/products/:productId — update product (no buyer info) */
const sellerAdminUpdateProduct = async (req, res) => {
  const sa = await KoyambeduSellerAdmin.findOne({ user: req.user._id, status: 'approved' });
  if (!sa) return res.status(403).json({ success: false, message: 'SellerAdmin not approved' });

  // Verify the seller belongs to this SA
  const seller = await KoyambeduSeller.findOne({ _id: req.params.sellerId, createdBySellerAdmin: sa._id });
  if (!seller) return res.status(403).json({ success: false, message: 'Seller not managed by this SellerAdmin' });

  const product = await KoyambeduProduct.findOne({ _id: req.params.productId, seller: seller._id });
  if (!product) return res.status(404).json({ success: false, message: 'Product not found' });

  // SellerAdmin can update: price, stock, minQty, isAvailable, delivery options
  const allowed = [
    'currentPrice','stockQty','minQty','maxQty','qtyStep','isAvailable',
    'isSameDay','isNextDay','sameDayCutoff','weightKg','marketPriceMin','marketPriceMax',
  ];
  for (const k of allowed) {
    if (req.body[k] !== undefined) product[k] = req.body[k];
  }
  if (req.body.currentPrice) product.priceUpdatedAt = new Date();
  await product.save();
  res.json({ success: true, product });
};

/** GET /api/koyambedu/seller-admin/sellers/:sellerId/products */
const sellerAdminGetProducts = async (req, res) => {
  const sa = await KoyambeduSellerAdmin.findOne({ user: req.user._id, status: 'approved' });
  if (!sa) return res.status(403).json({ success: false, message: 'SellerAdmin not approved' });
  const seller = await KoyambeduSeller.findOne({ _id: req.params.sellerId, createdBySellerAdmin: sa._id });
  if (!seller) return res.status(403).json({ success: false, message: 'Seller not managed by this SellerAdmin' });
  const products = await KoyambeduProduct.find({ seller: seller._id }).populate('category','name icon').lean();
  res.json({ success: true, products });
};

/** GET /api/koyambedu/admin/categories */
const adminGetCategories = async (req, res) => {
  const { status } = req.query;
  const filter = status ? { status } : {};
  const cats = await KoyambeduCategory.find(filter)
    .populate('createdBy','businessName').sort({ createdAt: -1 }).lean();
  res.json({ success: true, categories: cats });
};

/** PATCH /api/koyambedu/admin/categories/:catId/approve */
const adminApproveCategory = async (req, res) => {
  const { approve, reason } = req.body;
  const cat = await KoyambeduCategory.findById(req.params.catId);
  if (!cat) return res.status(404).json({ success: false, message: 'Category not found' });
  cat.status         = approve ? 'approved' : 'rejected';
  cat.approvedBy     = req.user._id;
  cat.approvedAt     = approve ? new Date() : undefined;
  cat.rejectedReason = !approve ? reason : undefined;
  await cat.save();
  res.json({ success: true, category: cat });
};

/** GET /api/koyambedu/admin/analytics */
const adminAnalytics = async (req, res) => {
  const { days = 7 } = req.query;
  const since = new Date(Date.now() - Number(days) * 24 * 3600 * 1000);

  const [revenueByDay, topProducts, ordersByStatus, categoryPerf] = await Promise.all([
    KoyambeduOrder.aggregate([
      { $match: { paymentStatus: 'paid', createdAt: { $gte: since } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, revenue: { $sum: '$pricing.total' }, orders: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    KoyambeduOrder.aggregate([
      { $match: { createdAt: { $gte: since } } },
      { $unwind: '$items' },
      { $group: { _id: '$items.product', name: { $first: '$items.name' }, totalQty: { $sum: '$items.quantity' }, totalRevenue: { $sum: { $multiply: ['$items.finalPrice','$items.quantity'] } } } },
      { $sort: { totalRevenue: -1 } },
      { $limit: 10 },
    ]),
    KoyambeduOrder.aggregate([
      { $match: { createdAt: { $gte: since } } },
      { $group: { _id: '$orderStatus', count: { $sum: 1 } } },
    ]),
    KoyambeduOrder.aggregate([
      { $match: { createdAt: { $gte: since } } },
      { $unwind: '$items' },
      { $lookup: { from: 'koyambedupromducts', localField: 'items.product', foreignField: '_id', as: 'prod' } },
      { $group: { _id: '$prod.category', revenue: { $sum: { $multiply: ['$items.finalPrice','$items.quantity'] } } } },
      { $sort: { revenue: -1 } },
      { $limit: 8 },
    ]),
  ]);

  res.json({ success: true, analytics: { revenueByDay, topProducts, ordersByStatus, categoryPerf } });
};

// ══════════════════════════════════════════════
// SECTION 6 — INTERNAL HELPERS
// ══════════════════════════════════════════════

const _notifySellerNewOrder = async (order) => {
  try {
    const fullOrder = await KoyambeduOrder.findById(order._id).populate('items.seller');
    const sellerIds = [...new Set(fullOrder.items.map(i => String(i.seller?._id || i.seller)))];

    for (const sid of sellerIds) {
      const seller = await KoyambeduSeller.findById(sid);
      if (!seller || !seller.contact?.phone || !seller.notifyWhatsApp) continue;

      const sellerItems = fullOrder.items.filter(i => String(i.seller?._id || i.seller) === sid);
      const total = sellerItems.reduce((s, i) => s + (i.finalPrice || i.orderedPrice || 0) * i.quantity, 0);
      const itemSummary = sellerItems.map(i => `${i.name} ×${i.quantity}${i.unitLabel || i.unit}`).join(', ');

      waSend(seller.contact.phone, [
        seller.businessName,
        fullOrder.orderId,
        'New Order Received 📦',
        `${itemSummary}. Est. payout: ₹${Math.round(total * 0.92).toLocaleString('en-IN')}. Confirm at eptomart.com/koyambedu/seller`,
      ]);
    }
  } catch (err) {
    console.error('[KBD] Seller notify error:', err.message);
  }
};

const _notifyBuyer = async (order, event) => {
  try {
    const buyer = await User.findById(order.buyer).select('phone email name').lean();
    if (!buyer?.phone) return;
    const messages = {
      confirmed:  ['Your Order is Confirmed ✅', `Order #${order.orderId} confirmed. We're preparing your fresh produce!`],
      dispatched: ['Your Order is On the Way 🚚', `Order #${order.orderId} is dispatched. Expected: ${order.deliverySlot}.`],
      delivered:  ['Order Delivered! 🎉', `Order #${order.orderId} delivered. Thank you for choosing Koyambedu Daily!`],
    };
    const [status, detail] = messages[event] || [event, ''];
    waSend(buyer.phone, [buyer.name || 'Customer', order.orderId, status, detail]);
  } catch (err) {
    console.error('[KBD] Buyer notify error:', err.message);
  }
};

const _notifyBuyerPriceRevision = async (order) => {
  try {
    const buyer = await User.findById(order.buyer).select('phone name').lean();
    if (!buyer?.phone) return;
    const revisedTotal = order.priceRevision?.revisedTotal || 0;
    waSend(buyer.phone, [
      buyer.name || 'Customer',
      order.orderId,
      'Price Revision Requested ⚠️',
      `Market price for some items in order #${order.orderId} has changed. New total: ₹${revisedTotal.toLocaleString('en-IN')}. Login to approve or cancel: eptomart.com/koyambedu/orders`,
    ]);
  } catch (err) {
    console.error('[KBD] Price revision notify error:', err.message);
  }
};

const _refundOrder = async (order) => {
  try {
    const rzpKeyId     = process.env.RAZORPAY_KEY_ID;
    const rzpKeySecret = process.env.RAZORPAY_KEY_SECRET;
    const paymentId    = order.paymentDetails?.razorpayPaymentId;
    if (!rzpKeyId || !paymentId) return;
    const https  = require('https');
    const amount = Math.round(order.pricing.total * 100);
    const body   = JSON.stringify({ amount, speed: 'normal' });
    const auth   = Buffer.from(`${rzpKeyId}:${rzpKeySecret}`).toString('base64');
    await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'api.razorpay.com',
        path:     `/v1/payments/${paymentId}/refund`,
        method:   'POST',
        headers:  { 'Content-Type': 'application/json', 'Authorization': `Basic ${auth}`, 'Content-Length': Buffer.byteLength(body) },
      }, (res) => {
        let d = ''; res.on('data', c => d += c);
        res.on('end', () => resolve(JSON.parse(d || '{}')));
      });
      req.on('error', reject);
      req.write(body); req.end();
    });
    order.paymentStatus    = 'refunded';
    order.refund           = { status: 'initiated', amount: order.pricing.total, initiatedAt: new Date() };
    await order.save();
    console.log(`[KBD] Refund initiated for order ${order.orderId}`);
  } catch (err) {
    console.error('[KBD] Refund error:', err.message);
  }
};

// ══════════════════════════════════════════════
module.exports = {
  // Public
  getCategories, getProducts, getFeaturedProducts, getProductDetail, getDeliverySlots,
  checkDeliveryAvailability,
  // Cart
  getCart, updateCart, clearCart,
  // Buyer orders
  placeOrder, createRazorpayOrder, verifyPayment,
  getMyOrders, getMyOrder, approveRevision, cancelOrder,
  // Seller
  sellerRegister, getSellerProfile, updateSellerProfile,
  getSellerProducts, createSellerProduct, updateSellerProduct,
  toggleProductAvailability, deleteSellerProduct,
  getSellerOrders, confirmStock, requestPriceRevision, createSellerCategory,
  // Admin — sellers
  adminDashboard, adminGetOrders, adminUpdateOrderStatus,
  adminGetSellers, adminApproveSeller, adminToggleSeller,
  adminGetCategories, adminApproveCategory, adminAnalytics,
  // Admin — seller admins (SuperAdmin only)
  adminUserSearch, adminCreateSellerAdmin, adminGetSellerAdmins, adminApproveSellerAdmin,
  // SellerAdmin portal
  sellerAdminGetProfile, sellerAdminGetSellers, sellerAdminCreateSeller,
  sellerAdminGetProducts, sellerAdminUpdateProduct, sellerAdminCreateProduct,
  // Admin product creation
  adminCreateProduct,
};
