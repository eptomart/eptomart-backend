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
const EptoFreshCoupon       = require('../models/EptoFreshCoupon');
const Razorpay              = require('razorpay');
const crypto                = require('crypto');
const {
  sendTemplateWhatsApp,
  sendOrderStatusWhatsApp,
} = require('../utils/sendWhatsApp');

// ── Delivery constants ───────────────────────
const KOYAMBEDU_LAT  = 13.0748;
const KOYAMBEDU_LNG  = 80.2136;
// No delivery distance limit — serve all areas
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
// Seller NEVER sees: full address, phone, payment, GPS coords
// Seller CAN see: areaName (locality), item quantities, delivery date
const maskOrder = (order) => {
  const o = order.toObject ? order.toObject() : { ...order };
  // Remove buyer identity fields
  delete o.buyer;
  delete o.shippingAddress;
  delete o.deliveryPersonPhone;
  delete o.paymentDetails;
  // From buyerLocation, only expose safe area name
  if (o.buyerLocation) {
    o.deliveryArea = o.buyerLocation.areaName || o.buyerLocation.city || 'Chennai';
    delete o.buyerLocation;
  }
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
      .populate('seller', 'businessName stallNumber marketSection rating servicePincodes')
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
  try {
    const base = { isActive: true };   // removed isAvailable check so empty DB returns [] not 500

    const safeFind = (query) => query.catch(() => []);

    const [freshArrivals, deals, flowers, bulk, seasonal, anyProducts] = await Promise.all([
      safeFind(KoyambeduProduct.find({ ...base, badges: 'fresh_arrival' })
        .populate('category', 'name icon').sort({ freshArrivalDate: -1 }).limit(8).lean()),
      safeFind(KoyambeduProduct.find({ ...base, badges: 'best_seller' })
        .populate('category', 'name icon').sort({ totalOrders: -1 }).limit(8).lean()),
      safeFind(KoyambeduProduct.find({ ...base, category: { $exists: true } })
        .populate('category', 'name icon slug').sort({ totalOrders: -1 }).limit(8).lean()
        .then(prods => prods.filter(p => p.category?.name?.toLowerCase().includes('flower') || p.category?.slug?.includes('flower')))),
      safeFind(KoyambeduProduct.find({ ...base, isBulkAvailable: true })
        .populate('category', 'name icon').sort({ totalOrders: -1 }).limit(6).lean()),
      safeFind(KoyambeduProduct.find({ ...base, badges: 'seasonal' })
        .populate('category', 'name icon').sort({ freshArrivalDate: -1 }).limit(6).lean()),
      safeFind(KoyambeduProduct.find(base)
        .populate('category', 'name icon').sort({ createdAt: -1 }).limit(8).lean()),
    ]);

    // Fallback: if specific badge sections are empty, use any available products
    const fallback = anyProducts || [];
    res.json({
      success: true,
      sections: {
        freshArrivals: freshArrivals.length ? freshArrivals : fallback,
        deals:         deals.length         ? deals         : fallback,
        flowers,
        bulk,
        seasonal:      seasonal.length      ? seasonal      : fallback,
      },
    });
  } catch (err) {
    // Never crash the Koyambedu home page — return empty sections
    res.json({ success: true, sections: { freshArrivals: [], deals: [], flowers: [], bulk: [], seasonal: [] } });
  }
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

  // Distance-based delivery charge: ₹125 per 4 km radius
  const kmRounded    = Math.round(distanceKm * 10) / 10;
  const deliveryCharge = Math.ceil(distanceKm / 4) * 125;

  res.json({
    success:       true,
    available:     true,
    distanceKm:    kmRounded,
    deliveryCharge,
    message:       `Delivery available · ${kmRounded} km from Koyambedu market`,
  });
};

/** GET /api/koyambedu/slots */
const getDeliverySlots = async (req, res) => {
  await KoyambeduDeliverySlot.seedDefaults();
  // One-time migration: fix any old '10:00' or '14:00' cutoffs on today slots to '08:00'
  await KoyambeduDeliverySlot.updateMany(
    { type: 'today', cutoffTime: { $in: ['10:00', '14:00'] } },
    { $set: { cutoffTime: '08:00' } }
  ).catch(() => {});
  // Migrate existing products that still have sameDayCutoff '10:00' to '08:00'
  await KoyambeduProduct.updateMany(
    { sameDayCutoff: '10:00' },
    { $set: { sameDayCutoff: '08:00' } }
  ).catch(() => {});
  const now   = new Date();
  const hhmm  = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  const slots = await KoyambeduDeliverySlot.find({ isActive: true }).sort({ sortOrder: 1 }).lean();
  // Mark today slots as expired if past 8 AM cutoff
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
  const { shippingAddress, paymentMethod = 'razorpay', deliverySlot, deliverySlotKey, deliveryDate, notes, buyerLocation, couponCode } = req.body;

  // ── 1. Location mandatory ──────────────────────────────────
  if (!buyerLocation?.lat || !buyerLocation?.lng) {
    return res.status(400).json({
      success: false,
      message: 'Please share your location to check Koyambedu Fresh delivery availability.',
    });
  }

  // ── 1b. Delivery slot mandatory ────────────────────────────
  const VALID_SLOT_KEYS = ['slot1', 'slot2', 'slot3', 'slot4'];
  if (!deliverySlotKey || !VALID_SLOT_KEYS.includes(deliverySlotKey)) {
    return res.status(400).json({ success: false, message: 'Please select a delivery slot.' });
  }
  if (!deliveryDate) {
    return res.status(400).json({ success: false, message: 'Please select a delivery date.' });
  }

  // ── 1c. Same-day slot availability (IST) ──────────────────
  // Cutoff: 9 AM IST. If booking after 9 AM, today's date is invalid.
  const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
  const nowIST    = new Date(Date.now() + IST_OFFSET_MS);
  const istHour   = nowIST.getUTCHours();
  const todayISO  = nowIST.toISOString().split('T')[0]; // YYYY-MM-DD in IST

  if (deliveryDate === todayISO && istHour >= 9) {
    return res.status(400).json({ success: false, message: 'Same-day booking is closed after 9:00 AM. Please select tomorrow.' });
  }
  // Slot 1 (07:00–08:59) not available for same-day if ordered at/after 04:00 AM
  if (deliveryDate === todayISO && deliverySlotKey === 'slot1') {
    return res.status(400).json({ success: false, message: 'Slot 1 is no longer available for same-day delivery.' });
  }
  // Slot 2 (09:00–11:59) not available for same-day if ordered at/after 04:00 AM
  if (deliveryDate === todayISO && deliverySlotKey === 'slot2' && istHour >= 4) {
    return res.status(400).json({ success: false, message: 'Slot 2 is no longer available for same-day delivery. Please choose Slot 3 or later.' });
  }

  // ── 2. Distance check ─────────────────────────────────────
  const distanceKm = haversineKm(
    Number(buyerLocation.lat), Number(buyerLocation.lng),
    KOYAMBEDU_LAT, KOYAMBEDU_LNG
  );
  // ── 3. Address ────────────────────────────────────────────
  if (!shippingAddress?.fullName || !shippingAddress?.addressLine1 || !shippingAddress?.pincode) {
    return res.status(400).json({ success: false, message: 'Full shipping address required' });
  }

  // ── 4. Cart ───────────────────────────────────────────────
  const cart = await KoyambeduCart.findOne({ user: req.user._id })
    .populate({
      path: 'items.product',
      populate: { path: 'seller', select: 'status isActive commissionRate contact businessName notifyWhatsApp servicePincodes' },
    });

  if (!cart || !cart.items.length) {
    return res.status(400).json({ success: false, message: 'Cart is empty' });
  }

  // ── 4b. Pincode check — buyer pincode must match each seller's servicePincodes ──
  const buyerPincode = String(shippingAddress.pincode).trim();
  for (const ci of cart.items) {
    const seller = ci.product?.seller;
    if (seller?.servicePincodes?.length > 0) {
      if (!seller.servicePincodes.includes(buyerPincode)) {
        return res.status(400).json({
          success: false,
          message: `"${ci.product?.name || 'A product'}" is not available for delivery to pincode ${buyerPincode}. This seller only delivers to: ${seller.servicePincodes.join(', ')}.`,
          pincodeBlocked: true,
          blockedProduct: ci.product?.name,
          sellerPincodes: seller.servicePincodes,
        });
      }
    }
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

  // ── 7. Delivery charge (distance-based: ₹249 per 8 km radius) ──
  const deliveryCharge = Math.ceil(distanceKm / 4) * 125;
  const platformFee    = 15;
  const deliveryType   = deliveryTypes.size > 1 ? 'mixed' : [...deliveryTypes][0];

  // ── 7b. Coupon discount (applied on subtotal, shipping excluded) ──
  let couponDiscount = 0;
  let appliedCoupon  = null;
  if (couponCode) {
    const coupon = await EptoFreshCoupon.findOne({
      code:          couponCode.toUpperCase().trim(),
      isActive:      true,
      requestStatus: { $in: ['admin_created', 'approved'] },
      validFrom:     { $lte: new Date() },
      validTo:       { $gte: new Date() },
    });
    // Koyambedu: allow 'all' or 'koyambedu' platform coupons
    const koyPlatformOk = !coupon || !coupon.platformRestriction || ['all', 'koyambedu'].includes(coupon.platformRestriction);
    if (coupon && koyPlatformOk && coupon.usedCount < coupon.maxUsage && subtotal >= coupon.minOrderValue) {
      if (coupon.discountType === 'flat') {
        couponDiscount = Math.min(coupon.discountValue, subtotal);
      } else {
        couponDiscount = (subtotal * coupon.discountValue) / 100;
        if (coupon.maxDiscount) couponDiscount = Math.min(couponDiscount, coupon.maxDiscount);
      }
      couponDiscount = parseFloat(couponDiscount.toFixed(2));
      appliedCoupon  = coupon;
    }
  }

  const total = parseFloat((subtotal + deliveryCharge + platformFee - couponDiscount).toFixed(2));

  // ── 8. Save order ─────────────────────────────────────────
  // Validate deliveryDate: must be today or future, not more than 2 days ahead
  let parsedDeliveryDate = null;
  if (deliveryDate) {
    parsedDeliveryDate = new Date(deliveryDate);
    parsedDeliveryDate.setHours(0, 0, 0, 0);
    const todayMidnight = new Date(); todayMidnight.setHours(0, 0, 0, 0);
    const maxDate = new Date(todayMidnight); maxDate.setDate(maxDate.getDate() + 2);
    if (parsedDeliveryDate < todayMidnight || parsedDeliveryDate > maxDate) {
      return res.status(400).json({ success: false, message: 'Invalid delivery date. You can book max 2 days in advance.' });
    }
  }

  const order = new KoyambeduOrder({
    buyer:        req.user._id,
    buyerLocation: {
      lat:        Number(buyerLocation.lat),
      lng:        Number(buyerLocation.lng),
      areaName:   buyerLocation.areaName || '',
      city:       buyerLocation.city || shippingAddress.city || 'Chennai',
      pincode:    buyerLocation.pincode || shippingAddress.pincode || '',
      distanceKm: Math.round(distanceKm * 10) / 10,
    },
    shippingAddress,
    items:        orderItems,
    deliveryType,
    deliveryDate:    parsedDeliveryDate,
    deliverySlot:    deliverySlot    || '09:00 AM – 11:59 AM',
    deliverySlotKey: deliverySlotKey || 'slot2',
    orderTimestamp:  new Date(),
    cutoffCycle:     getProcurementCycle(new Date()),
    procurementDate: new Date(getProcurementCycle(new Date())),
    paymentMethod,
    paymentStatus:'pending',
    orderStatus:  'placed',
    pricing:      { subtotal, deliveryCharge, deliveryDistance: Math.round(distanceKm * 10) / 10, platformFee, discount: couponDiscount, couponCode: appliedCoupon?.code || undefined, total },
    adminNotes:   notes || '',
  });
  await order.save();

  await KoyambeduCart.findOneAndUpdate({ user: req.user._id }, { items: [] });

  // Increment coupon usage
  if (appliedCoupon) {
    await EptoFreshCoupon.findByIdAndUpdate(appliedCoupon._id, { $inc: { usedCount: 1 } });
  }

  // Orders auto-proceed to procurement queue — no seller confirmation required
  setImmediate(() => _notifySellerNewOrder(order).catch(() => {}));

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
    images: req.body.images || [],
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
    'isBulkAvailable','bulkMinQty','bulkPricePerUnit','isRecurringAllowed','weightKg','images'];

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
    revisedTotal: newTotal + order.pricing.deliveryCharge + (order.pricing.platformFee || order.pricing.serviceFee || 15),
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

  // Notify buyer on key status changes
  if (['confirmed','packing','dispatched','delivered'].includes(status)) {
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

/** POST /api/koyambedu/admin/sellers — SuperAdmin creates a seller directly (pre-approved) */
const adminCreateSeller = async (req, res) => {
  const {
    businessName, ownerName, stallNumber, marketSection,
    contactPhone, contactEmail, commissionRate, description,
    assignedSellerAdminId,
  } = req.body;

  if (!businessName || !ownerName || !contactPhone) {
    return res.status(400).json({ success: false, message: 'businessName, ownerName and contactPhone are required' });
  }

  const existing = await KoyambeduSeller.findOne({ 'contact.phone': contactPhone });
  if (existing) return res.status(400).json({ success: false, message: 'A seller with this phone number already exists' });

  // Validate assigned seller admin if provided
  let sellerAdmin = null;
  if (assignedSellerAdminId) {
    sellerAdmin = await KoyambeduSellerAdmin.findById(assignedSellerAdminId);
    if (!sellerAdmin) return res.status(400).json({ success: false, message: 'SellerAdmin not found' });
    if (sellerAdmin.status !== 'approved') return res.status(400).json({ success: false, message: 'SellerAdmin must be approved before assigning sellers' });
  }

  const seller = await KoyambeduSeller.create({
    businessName, ownerName, stallNumber, marketSection, description,
    contact: { phone: contactPhone, email: contactEmail || '' },
    commissionRate: commissionRate != null ? Number(commissionRate) : 10,
    status:   'approved',
    isActive: true,
    approvedBy: req.user._id,
    approvedAt: new Date(),
    ...(sellerAdmin && { createdBySellerAdmin: sellerAdmin._id }),
  });

  // Link seller to the SellerAdmin's sellers array if assigned
  if (sellerAdmin) {
    if (!sellerAdmin.sellers) sellerAdmin.sellers = [];
    sellerAdmin.sellers.push(seller._id);
    await sellerAdmin.save();
  }

  res.status(201).json({ success: true, message: 'Seller created and approved.', seller });
};

/** PATCH /api/koyambedu/admin/sellers/:sellerId/contact — SuperAdmin edits seller details */
const adminEditSellerContact = async (req, res) => {
  const seller = await KoyambeduSeller.findById(req.params.sellerId).populate('user', '_id name email phone');
  if (!seller) return res.status(404).json({ success: false, message: 'Seller not found' });

  const {
    ownerName, businessName, stallNumber, marketSection, description,
    contactPhone, contactEmail, syncToAccount,
  } = req.body;

  if (ownerName     !== undefined) seller.ownerName     = ownerName;
  if (businessName  !== undefined) seller.businessName  = businessName;
  if (stallNumber   !== undefined) seller.stallNumber   = stallNumber;
  if (marketSection !== undefined) seller.marketSection = marketSection;
  if (description   !== undefined) seller.description   = description;
  if (contactPhone  !== undefined) seller.contact.phone = contactPhone;
  if (contactEmail  !== undefined) seller.contact.email = contactEmail ? contactEmail.toLowerCase() : '';

  await seller.save();

  // Optionally sync phone/email to the linked Eptomart account
  if (syncToAccount && seller.user) {
    const updates = {};
    if (contactPhone !== undefined) updates.phone = contactPhone;
    if (contactEmail !== undefined) updates.email = contactEmail ? contactEmail.toLowerCase() : '';
    if (Object.keys(updates).length) {
      await User.findByIdAndUpdate(seller.user._id || seller.user, updates);
    }
  }

  const updated = await KoyambeduSeller.findById(seller._id).populate('user', 'name email phone').lean();
  res.json({ success: true, seller: updated });
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

// ── Variant price calculator ─────────────────────────────────────────────────
const calcVariantFinalPrice = (basePrice, procPct, platPct, logPct) => {
  const total = (Number(procPct) || 0) + (Number(platPct) || 0) + (Number(logPct) || 0);
  return Math.round(Number(basePrice) * (1 + total / 100)); // always whole number
};

// ── Shared product-creation helper ──────────────────────────────────────────
const _createProductForSeller = async (seller, body) => {
  const {
    categoryId, name, nameTamil, description, unit, unitLabel,
    stockQty, freshArrivalTime, isSameDay, isNextDay, sameDayCutoff,
    badges, tags, weightKg,
    // Variant pricing
    variants,
    procurementChargePercent,
    platformChargePercent,
    logisticsChargePercent,
    // Legacy fallback (single-price products)
    currentPrice, minQty, maxQty, qtyStep,
  } = body;

  if (!categoryId || !name) {
    throw Object.assign(new Error('Category and name are required'), { statusCode: 400 });
  }

  const category = await KoyambeduCategory.findOne({ _id: categoryId, isActive: true });
  if (!category) throw Object.assign(new Error('Invalid or inactive category'), { statusCode: 400 });

  // ── Variant mode ──────────────────────────────────────────────────────────
  let processedVariants = [];
  let derivedCurrentPrice = currentPrice != null ? Number(currentPrice) : null;
  let derivedMinQty = minQty || 0.5;
  let derivedMaxQty = maxQty || 50;

  if (variants && Array.isArray(variants) && variants.length > 0) {
    // Validate + compute finalPrice for each variant
    const procPct = Number(procurementChargePercent) || 15;
    const platPct = Number(platformChargePercent)    || 10;
    const logPct  = Number(logisticsChargePercent)   || 10;

    for (let i = 0; i < Math.min(variants.length, 4); i++) {
      const v = variants[i];
      if (!v.basePrice || !v.fromQty || !v.toQty) {
        throw Object.assign(new Error(`Variant ${i + 1}: basePrice, fromQty and toQty are required`), { statusCode: 400 });
      }
      if (Number(v.fromQty) >= Number(v.toQty)) {
        throw Object.assign(new Error(`Variant ${i + 1}: fromQty must be less than toQty`), { statusCode: 400 });
      }
      const fp = calcVariantFinalPrice(v.basePrice, procPct, platPct, logPct);
      processedVariants.push({
        basePrice:  Number(v.basePrice),
        fromQty:    Number(v.fromQty),
        toQty:      Number(v.toQty),
        finalPrice: fp,
      });
    }

    // Validate no overlapping ranges
    for (let i = 1; i < processedVariants.length; i++) {
      if (processedVariants[i].fromQty <= processedVariants[i - 1].toQty) {
        throw Object.assign(new Error(`Variant ${i + 1}: qty range overlaps with previous variant`), { statusCode: 400 });
      }
    }

    // Derive product-level fields from variants
    const finalPrices = processedVariants.map(v => v.finalPrice);
    derivedCurrentPrice = Math.min(...finalPrices);
    derivedMinQty = processedVariants[0].fromQty;
    derivedMaxQty = processedVariants[processedVariants.length - 1].toQty;
  } else if (derivedCurrentPrice == null) {
    throw Object.assign(new Error('Either variants or currentPrice is required'), { statusCode: 400 });
  }

  return KoyambeduProduct.create({
    seller:   seller._id,
    category: category._id,
    name, nameTamil, description,
    unit:      unit      || 'kg',
    unitLabel: unitLabel || unit || 'kg',
    minQty:    derivedMinQty,
    maxQty:    derivedMaxQty,
    qtyStep:   qtyStep   || (processedVariants.length > 0 ? processedVariants[0].fromQty : 0.5),
    weightKg:  weightKg  != null ? Number(weightKg) : (unit === 'g' ? 0.001 : 1),
    currentPrice: derivedCurrentPrice,
    variants:     processedVariants,
    procurementChargePercent: Number(procurementChargePercent) || 15,
    platformChargePercent:    Number(platformChargePercent)    || 10,
    logisticsChargePercent:   Number(logisticsChargePercent)   || 10,
    stockQty:     stockQty || 0,
    freshArrivalTime: freshArrivalTime || '',
    freshArrivalDate: freshArrivalTime ? new Date() : undefined,
    isSameDay:    isSameDay    !== false,
    isNextDay:    isNextDay    !== false,
    sameDayCutoff: sameDayCutoff || seller.sameDayCutoff || '10:00',
    badges: badges || [],
    tags:   tags   || [],
    images: body.images || [],
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

/** POST /api/koyambedu/seller-admin/categories — SA submits a new category for admin approval */
const sellerAdminCreateCategory = async (req, res) => {
  const sa = await KoyambeduSellerAdmin.findOne({ user: req.user._id, status: 'approved' });
  if (!sa) return res.status(403).json({ success: false, message: 'SellerAdmin not approved' });

  const { name, nameTamil, icon, image, parentId, description } = req.body;
  if (!name) return res.status(400).json({ success: false, message: 'Category name is required' });

  // Check for duplicate name (case-insensitive)
  const existing = await KoyambeduCategory.findOne({ name: new RegExp(`^${name.trim()}$`, 'i') });
  if (existing) return res.status(400).json({ success: false, message: 'A category with this name already exists' });

  const cat = await KoyambeduCategory.create({
    name: name.trim(), nameTamil, icon: icon || '🌿', image: image || '',
    description, parent: parentId || null,
    status: 'pending', // must be approved by admin
    // createdBy is KoyambeduSeller ref — leave null for SA-created categories
  });

  res.status(201).json({ success: true, message: 'Category submitted for admin approval', category: cat });
};

/** GET /api/koyambedu/seller-admin/categories — list categories (for product form dropdowns) */
const sellerAdminGetCategories = async (req, res) => {
  const { status } = req.query;
  const filter = { isActive: true };
  if (status) filter.status = status; // e.g. ?status=pending to list SA's pending ones
  const cats = await KoyambeduCategory.find(filter).sort({ name: 1 }).lean();
  res.json({ success: true, categories: cats });
};

/** GET /api/koyambedu/admin/products — list all products (admin/superAdmin) */
const adminGetAllProducts = async (req, res) => {
  const { seller: sellerId, category, search, available } = req.query;
  const filter = {};
  if (sellerId)  filter.seller   = sellerId;
  if (category)  filter.category = category;
  if (available !== undefined) filter.isAvailable = available === 'true';
  if (search)    filter.name     = { $regex: search, $options: 'i' };

  const products = await KoyambeduProduct.find(filter)
    .populate('seller',   'businessName ownerName stallNumber marketSection')
    .populate('category', 'name icon')
    .sort({ createdAt: -1 })
    .lean();
  res.json({ success: true, products });
};

/** PUT /api/koyambedu/admin/products/:productId — admin edits any product */
const adminUpdateProduct = async (req, res) => {
  const product = await KoyambeduProduct.findById(req.params.productId);
  if (!product) return res.status(404).json({ success: false, message: 'Product not found' });

  const allowed = [
    'name','nameTamil','unit','unitLabel','stockQty',
    'isAvailable','isSameDay','isNextDay',
    'sameDayCutoff','weightKg','badges','description','images',
  ];
  for (const k of allowed) {
    if (req.body[k] !== undefined) product[k] = req.body[k];
  }

  // Variant update
  if (req.body.variants && Array.isArray(req.body.variants) && req.body.variants.length > 0) {
    const procPct = Number(req.body.procurementChargePercent ?? product.procurementChargePercent) || 15;
    const platPct = Number(req.body.platformChargePercent    ?? product.platformChargePercent)    || 10;
    const logPct  = Number(req.body.logisticsChargePercent   ?? product.logisticsChargePercent)   || 10;
    const processed = req.body.variants.slice(0, 4).map(v => ({
      basePrice:  Number(v.basePrice),
      fromQty:    Number(v.fromQty),
      toQty:      Number(v.toQty),
      finalPrice: calcVariantFinalPrice(v.basePrice, procPct, platPct, logPct),
    }));
    product.variants = processed;
    product.procurementChargePercent = procPct;
    product.platformChargePercent    = platPct;
    product.logisticsChargePercent   = logPct;
    product.currentPrice = Math.min(...processed.map(v => v.finalPrice));
    product.minQty = processed[0].fromQty;
    product.maxQty = processed[processed.length - 1].toQty;
    product.priceUpdatedAt = new Date();
  } else if (req.body.currentPrice !== undefined) {
    product.currentPrice = Number(req.body.currentPrice);
    product.priceUpdatedAt = new Date();
  }

  await product.save();
  res.json({ success: true, product });
};

/** PATCH /api/koyambedu/admin/products/:productId/toggle — toggle availability */
const adminToggleProduct = async (req, res) => {
  const product = await KoyambeduProduct.findById(req.params.productId);
  if (!product) return res.status(404).json({ success: false, message: 'Product not found' });
  product.isAvailable = !product.isAvailable;
  await product.save();
  res.json({ success: true, isAvailable: product.isAvailable });
};

/** POST /api/koyambedu/admin/sellers/:sellerId/products — admin adds product for any seller */
const adminCreateProduct = async (req, res) => {
  const seller = await KoyambeduSeller.findById(req.params.sellerId);
  if (!seller) return res.status(404).json({ success: false, message: 'Seller not found' });

  const product = await _createProductForSeller(seller, req.body);
  res.status(201).json({ success: true, product });
};

/** PATCH /api/koyambedu/seller-admin/sellers/:sellerId/products/:productId/toggle — toggle availability */
const sellerAdminToggleProduct = async (req, res) => {
  const sa = await KoyambeduSellerAdmin.findOne({ user: req.user._id, status: 'approved' });
  if (!sa) return res.status(403).json({ success: false, message: 'SellerAdmin not approved' });
  const seller = await KoyambeduSeller.findOne({ _id: req.params.sellerId, createdBySellerAdmin: sa._id });
  if (!seller) return res.status(403).json({ success: false, message: 'Seller not managed by this SellerAdmin' });
  const product = await KoyambeduProduct.findOne({ _id: req.params.productId, seller: seller._id });
  if (!product) return res.status(404).json({ success: false, message: 'Product not found' });
  product.isAvailable = !product.isAvailable;
  await product.save();
  res.json({ success: true, isAvailable: product.isAvailable });
};

/** DELETE /api/koyambedu/admin/products/:productId — super admin hard-delete */
const adminDeleteProduct = async (req, res) => {
  const product = await KoyambeduProduct.findByIdAndDelete(req.params.productId);
  if (!product) return res.status(404).json({ success: false, message: 'Product not found' });
  res.json({ success: true, message: 'Product deleted' });
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

  // SellerAdmin can update: stock, availability, delivery options, images, variants
  const allowed = ['stockQty','isAvailable','isSameDay','isNextDay','sameDayCutoff','weightKg','images'];
  for (const k of allowed) {
    if (req.body[k] !== undefined) product[k] = req.body[k];
  }

  // Variant update (SellerAdmin can re-price variants)
  if (req.body.variants && Array.isArray(req.body.variants) && req.body.variants.length > 0) {
    const procPct = Number(req.body.procurementChargePercent ?? product.procurementChargePercent) || 15;
    const platPct = Number(req.body.platformChargePercent    ?? product.platformChargePercent)    || 10;
    const logPct  = Number(req.body.logisticsChargePercent   ?? product.logisticsChargePercent)   || 10;
    const processed = req.body.variants.slice(0, 4).map(v => ({
      basePrice:  Number(v.basePrice),
      fromQty:    Number(v.fromQty),
      toQty:      Number(v.toQty),
      finalPrice: calcVariantFinalPrice(v.basePrice, procPct, platPct, logPct),
    }));
    product.variants = processed;
    product.procurementChargePercent = procPct;
    product.platformChargePercent    = platPct;
    product.logisticsChargePercent   = logPct;
    product.currentPrice = Math.min(...processed.map(v => v.finalPrice));
    product.minQty = processed[0].fromQty;
    product.maxQty = processed[processed.length - 1].toQty;
    product.priceUpdatedAt = new Date();
  }

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

/** PATCH /api/koyambedu/seller-admin/sellers/:sellerId/edit-request
 *  SA submits proposed edits for a seller — stored in pendingEdit, not live yet
 */
const sellerAdminRequestEdit = async (req, res) => {
  const sa = await KoyambeduSellerAdmin.findOne({ user: req.user._id, status: 'approved' });
  if (!sa) return res.status(403).json({ success: false, message: 'SellerAdmin not approved' });

  const seller = await KoyambeduSeller.findOne({ _id: req.params.sellerId, createdBySellerAdmin: sa._id });
  if (!seller) return res.status(403).json({ success: false, message: 'Seller not managed by this SellerAdmin' });

  // Reject if there is already a pending edit awaiting review
  if (seller.pendingEdit && seller.pendingEdit.submittedAt) {
    return res.status(400).json({ success: false, message: 'There is already a pending edit awaiting admin review' });
  }

  const {
    ownerName, businessName, stallNumber, marketSection, description,
    contactPhone, contactEmail, contactAltPhone,
  } = req.body;

  // Build pendingEdit — only include fields that were actually sent
  const pendingEdit = {
    submittedAt: new Date(),
    submittedBy: sa._id,
  };
  if (ownerName     !== undefined) pendingEdit.ownerName     = ownerName;
  if (businessName  !== undefined) pendingEdit.businessName  = businessName;
  if (stallNumber   !== undefined) pendingEdit.stallNumber   = stallNumber;
  if (marketSection !== undefined) pendingEdit.marketSection = marketSection;
  if (description   !== undefined) pendingEdit.description   = description;
  if (contactPhone  !== undefined || contactEmail !== undefined || contactAltPhone !== undefined) {
    pendingEdit.contact = {};
    if (contactPhone    !== undefined) pendingEdit.contact.phone    = contactPhone;
    if (contactEmail    !== undefined) pendingEdit.contact.email    = contactEmail?.toLowerCase() || '';
    if (contactAltPhone !== undefined) pendingEdit.contact.altPhone = contactAltPhone;
  }

  seller.pendingEdit = pendingEdit;
  await seller.save();

  res.json({ success: true, message: 'Edit request submitted for SuperAdmin review', seller });
};

/** POST /api/koyambedu/admin/sellers/:sellerId/review-edit
 *  SuperAdmin approves or rejects a pending edit from a SellerAdmin
 */
const adminReviewSellerEdit = async (req, res) => {
  const { approve, rejectReason } = req.body;
  const seller = await KoyambeduSeller.findById(req.params.sellerId).populate('user', '_id');
  if (!seller) return res.status(404).json({ success: false, message: 'Seller not found' });
  if (!seller.pendingEdit || !seller.pendingEdit.submittedAt) {
    return res.status(400).json({ success: false, message: 'No pending edit found for this seller' });
  }

  if (approve) {
    const pe = seller.pendingEdit;
    // Apply the pending changes to the live fields
    if (pe.ownerName     !== undefined) seller.ownerName     = pe.ownerName;
    if (pe.businessName  !== undefined) seller.businessName  = pe.businessName;
    if (pe.stallNumber   !== undefined) seller.stallNumber   = pe.stallNumber;
    if (pe.marketSection !== undefined) seller.marketSection = pe.marketSection;
    if (pe.description   !== undefined) seller.description   = pe.description;
    if (pe.contact) {
      if (!seller.contact) seller.contact = {};
      if (pe.contact.phone    !== undefined) seller.contact.phone    = pe.contact.phone;
      if (pe.contact.email    !== undefined) seller.contact.email    = pe.contact.email;
      if (pe.contact.altPhone !== undefined) seller.contact.altPhone = pe.contact.altPhone;

      // Sync to linked Eptomart user account so OTP login keeps working
      if (seller.user) {
        const userUpdates = {};
        if (pe.contact.phone !== undefined) userUpdates.phone = pe.contact.phone;
        if (pe.contact.email !== undefined) userUpdates.email = pe.contact.email;
        if (Object.keys(userUpdates).length) {
          await User.findByIdAndUpdate(seller.user._id || seller.user, userUpdates);
        }
      }
    }
  }

  // Clear pending edit regardless of approve/reject
  seller.pendingEdit = undefined;
  await seller.save();

  res.json({
    success: true,
    message: approve ? 'Edit approved and applied' : `Edit rejected: ${rejectReason || 'No reason given'}`,
    seller,
  });
};

/** GET /api/koyambedu/admin/categories */
const adminGetCategories = async (req, res) => {
  const { status } = req.query;
  const filter = status ? { status } : {};
  const cats = await KoyambeduCategory.find(filter)
    .populate('createdBy','businessName').sort({ sortOrder: 1, name: 1 }).lean();
  res.json({ success: true, categories: cats });
};

/** POST /api/koyambedu/admin/categories — admin creates a category directly (auto-approved) */
const adminCreateCategory = async (req, res) => {
  const { name, nameTamil, icon, image, description, sortOrder } = req.body;
  if (!name?.trim()) return res.status(400).json({ success: false, message: 'Category name is required' });
  const existing = await KoyambeduCategory.findOne({ name: new RegExp(`^${name.trim()}$`, 'i') });
  if (existing) return res.status(400).json({ success: false, message: 'A category with this name already exists' });
  const cat = await KoyambeduCategory.create({
    name: name.trim(), nameTamil, icon: icon || '🌿', image: image || '',
    description, status: 'approved', isActive: true,
    approvedBy: req.user._id, approvedAt: new Date(),
    sortOrder: sortOrder || 0,
  });
  res.status(201).json({ success: true, category: cat });
};

/** PUT /api/koyambedu/admin/categories/:catId — admin edits a category */
const adminEditCategory = async (req, res) => {
  const cat = await KoyambeduCategory.findById(req.params.catId);
  if (!cat) return res.status(404).json({ success: false, message: 'Category not found' });
  const { name, nameTamil, icon, image, description, sortOrder, isActive } = req.body;
  if (name !== undefined)        cat.name        = name.trim();
  if (nameTamil !== undefined)   cat.nameTamil   = nameTamil;
  if (icon !== undefined)        cat.icon        = icon;
  if (image !== undefined)       cat.image       = image;
  if (description !== undefined) cat.description = description;
  if (sortOrder !== undefined)   cat.sortOrder   = Number(sortOrder);
  if (isActive !== undefined)    cat.isActive    = isActive;
  cat.slug = cat.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  await cat.save();
  res.json({ success: true, category: cat });
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
    const fullOrder = await KoyambeduOrder.findById(order._id)
      .populate('items.seller')
      .populate('buyer', 'name phone');
    const sellerIds = [...new Set(fullOrder.items.map(i => String(i.seller?._id || i.seller)))];

    // Build a single item summary for platform admin
    const allItems   = fullOrder.items.map(i => `${i.name} ×${i.quantity}`).join(', ');
    const areaLabel  = fullOrder.buyerLocation?.areaName || fullOrder.buyerLocation?.city || 'Chennai';
    const delivDate  = fullOrder.deliveryDate
      ? new Date(fullOrder.deliveryDate).toLocaleDateString('en-IN', { day:'numeric', month:'short' })
      : 'TBD';

    // 1. Notify each product seller (existing behaviour)
    for (const sid of sellerIds) {
      const seller = await KoyambeduSeller.findById(sid);
      if (!seller || !seller.contact?.phone || !seller.notifyWhatsApp) continue;

      const sellerItems = fullOrder.items.filter(i => String(i.seller?._id || i.seller) === sid);
      const total       = sellerItems.reduce((s, i) => s + (i.finalPrice || i.orderedPrice || 0) * i.quantity, 0);
      const itemSummary = sellerItems.map(i => `${i.name} ×${i.quantity}${i.unitLabel || i.unit ? ` ${i.unitLabel || i.unit}` : ''}`).join(', ');

      waSend(seller.contact.phone, [
        seller.businessName,
        fullOrder.orderId,
        'New Koyambedu Order 📦',
        `${itemSummary}. Area: ${areaLabel}. Delivery: ${delivDate}. Est. payout: ₹${Math.round(total * 0.92).toLocaleString('en-IN')}. Confirm at eptomart.com/koyambedu/seller`,
      ]);

      // 2. Notify seller admin for this seller (if any)
      const sellerAdmin = await KoyambeduSellerAdmin.findOne({ sellers: seller._id, status: 'approved' });
      if (sellerAdmin?.contact?.phone) {
        waSend(sellerAdmin.contact.phone, [
          sellerAdmin.name || 'Admin',
          fullOrder.orderId,
          'New Koyambedu Order 📦',
          `${itemSummary}. Area: ${areaLabel}. Delivery: ${delivDate}. Payout: ₹${Math.round(total * 0.92).toLocaleString('en-IN')}. Manage at eptomart.com/koyambedu/seller-admin`,
        ]);
      }
    }

    // 3. Notify platform admin
    const adminPhone = process.env.PLATFORM_ADMIN_WHATSAPP || process.env.ADMIN_WHATSAPP_PHONE;
    if (adminPhone) {
      waSend(adminPhone, [
        'Koyambedu Admin',
        fullOrder.orderId,
        'New Koyambedu Order Received 📦',
        `Order #${fullOrder.orderId}: ${allItems}. Delivery area: ${areaLabel}. Date: ${delivDate}. Total: ₹${fullOrder.pricing?.total?.toLocaleString('en-IN') || '-'}. Manage at eptomart.com/admin`,
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
      confirmed:  ['Your Order is Confirmed ✅', `Order #${order.orderId} confirmed by seller. Fresh produce is being arranged for you!`],
      packing:    ['Order Being Packed 📦', `Order #${order.orderId} is being packed and will be dispatched soon.`],
      dispatched: ['Your Order is On the Way 🚚', `Order #${order.orderId} is dispatched. Expected delivery: ${order.deliverySlot}.`],
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
// AI — Translate & Describe
// ══════════════════════════════════════════════
const { callClaude } = require('../utils/claudeAI');

/** POST /api/koyambedu/ai/translate  { text } → { tamil } */
const aiTranslate = async (req, res) => {
  const { text } = req.body;
  if (!text?.trim()) return res.status(400).json({ success: false, message: 'text is required' });

  const tamil = await callClaude(
    `Translate the following produce/vegetable/fruit name from English to Tamil. Return ONLY the Tamil text, nothing else.\n\n"${text.trim()}"`,
    'You are a Tamil language expert specialising in Koyambedu market produce names. Return only the Tamil translation, no explanation.'
  );
  res.json({ success: true, tamil });
};

/** POST /api/koyambedu/ai/describe  { name, nameTamil, category, unit } → { description } */
const aiDescribe = async (req, res) => {
  const { name, nameTamil, category, unit } = req.body;
  if (!name?.trim()) return res.status(400).json({ success: false, message: 'name is required' });

  const prompt = [
    `Write a short, appealing product description (2–3 sentences) for a fresh produce listing on an ecommerce app.`,
    `Product: ${name.trim()}`,
    nameTamil ? `Tamil name: ${nameTamil}` : '',
    category  ? `Category: ${category}`    : '',
    unit      ? `Sold by: ${unit}`         : '',
    `Focus on freshness, taste, and health benefits. Keep it simple and friendly for Indian shoppers. No emojis.`,
  ].filter(Boolean).join('\n');

  const description = await callClaude(
    prompt,
    'You are a helpful assistant writing concise, friendly product descriptions for a Koyambedu daily-fresh produce marketplace in India.'
  );
  res.json({ success: true, description });
};

/** POST /api/koyambedu/upload-image  multipart: image field "image" */
const uploadImage = async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: 'No image uploaded' });
  res.json({
    success:   true,
    url:       req.file.path,
    publicId:  req.file.filename,
  });
};

// ══════════════════════════════════════════════
// SUPERADMIN — Wipe all Koyambedu data
// Deletes: products, sellers, seller-admins, orders, carts, categories
// Does NOT touch main User accounts
// ══════════════════════════════════════════════
const adminWipeAll = async (req, res) => {
  try {
    const [products, sellers, sellerAdmins, orders, carts, categories] = await Promise.all([
      KoyambeduProduct.deleteMany({}),
      KoyambeduSeller.deleteMany({}),
      KoyambeduSellerAdmin.deleteMany({}),
      KoyambeduOrder.deleteMany({}),
      KoyambeduCart.deleteMany({}),
      KoyambeduCategory.deleteMany({}),
    ]);
    res.json({
      success: true,
      message: 'All Koyambedu data wiped',
      deleted: {
        products:     products.deletedCount,
        sellers:      sellers.deletedCount,
        sellerAdmins: sellerAdmins.deletedCount,
        orders:       orders.deletedCount,
        carts:        carts.deletedCount,
        categories:   categories.deletedCount,
      },
    });
  } catch (err) {
    console.error('Koyambedu wipe error:', err);
    res.status(500).json({ message: 'Wipe failed', error: err.message });
  }
};

// ══════════════════════════════════════════════
// HELPERS — price formula
// ══════════════════════════════════════════════
const calcFinalPrice = ({ basePrice, platformFeePercent = 10, logisticsPercent = 10, sellerMarginPercent = 15 }) => {
  const pf = (basePrice * platformFeePercent) / 100;
  const lf = (basePrice * logisticsPercent)   / 100;
  const sm = (basePrice * sellerMarginPercent) / 100;
  return Math.round((basePrice + pf + lf + sm) * 100) / 100;
};

// procurement cycle date: orders before midnight belong to "today", after midnight → "tomorrow"
const getProcurementCycle = (ts = new Date()) => {
  // Use IST (UTC+5:30)
  const ist = new Date(ts.getTime() + (5.5 * 60 * 60 * 1000));
  const h = ist.getUTCHours(), m = ist.getUTCMinutes();
  // After 23:59 → next day cycle
  const base = new Date(ist);
  if (h === 23 && m >= 59) base.setUTCDate(base.getUTCDate() + 1);
  return base.toISOString().slice(0, 10); // "2026-06-22"
};

// Delivery slot definitions
const DELIVERY_SLOTS = {
  slot1: 'Slot 1: 9 AM – 12 PM',
  slot2: 'Slot 2: 12 PM – 3 PM',
  slot3: 'Slot 3: 3 PM – 6 PM',
};

// ══════════════════════════════════════════════
// FEATURE 1 — Dynamic Pricing (product code auto-gen)
// ══════════════════════════════════════════════
const generateProductCode = (name) => {
  const prefix = name.trim().replace(/\s+/g, '').substring(0, 3).toUpperCase();
  const suffix = Date.now().toString(36).slice(-4).toUpperCase();
  return `${prefix}${suffix}`;
};

// ══════════════════════════════════════════════
// FEATURE 4 — Daily Price Update Panel
// GET /seller-admin/daily-price  — list all products with today's price
// PATCH /seller-admin/daily-price/:productId — update price
// PATCH /seller-admin/daily-price/bulk — bulk update
// ══════════════════════════════════════════════
const KoyambeduPriceHistory = require('../models/KoyambeduPriceHistory');

const getDailyPricePanel = async (req, res) => {
  try {
    const sellers = await require('../models/KoyambeduSeller').find({}).select('_id name').lean();
    const sellerIds = sellers.map(s => s._id);
    const products = await KoyambeduProduct.find({ seller: { $in: sellerIds }, isActive: true })
      .populate('seller', 'name')
      .select('name productCode currentPrice finalPrice basePrice sellerMarginPercent platformFeePercent logisticsPercent stockQty priceUpdatedAt')
      .lean();
    res.json({ success: true, products });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const updateDailyPrice = async (req, res) => {
  try {
    const { productId } = req.params;
    const { basePrice, sellerMarginPercent, platformFeePercent, logisticsPercent, stockQty, note } = req.body;

    const product = await KoyambeduProduct.findById(productId);
    if (!product) return res.status(404).json({ success: false, message: 'Product not found' });

    const prevPrice = product.currentPrice;

    if (basePrice !== undefined)           product.basePrice           = basePrice;
    if (sellerMarginPercent !== undefined) product.sellerMarginPercent = sellerMarginPercent;
    if (platformFeePercent !== undefined)  product.platformFeePercent  = platformFeePercent;
    if (logisticsPercent !== undefined)    product.logisticsPercent    = logisticsPercent;
    if (stockQty !== undefined)            product.stockQty            = stockQty;

    const newFinal = calcFinalPrice({
      basePrice:           product.basePrice,
      platformFeePercent:  product.platformFeePercent,
      logisticsPercent:    product.logisticsPercent,
      sellerMarginPercent: product.sellerMarginPercent,
    });
    product.finalPrice    = newFinal;
    product.currentPrice  = newFinal;
    product.priceUpdatedAt = new Date();
    await product.save();

    // Record history
    await KoyambeduPriceHistory.create({
      product:             product._id,
      seller:              product.seller,
      productName:         product.name,
      productCode:         product.productCode,
      previousPrice:       prevPrice,
      updatedPrice:        newFinal,
      basePrice:           product.basePrice,
      platformFeePercent:  product.platformFeePercent,
      logisticsPercent:    product.logisticsPercent,
      sellerMarginPercent: product.sellerMarginPercent,
      updatedBy:           req.user._id,
      updatedByName:       req.user.name || req.user.email,
      updatedByRole:       req.user.role === 'superAdmin' ? 'superAdmin' : 'sellerAdmin',
      source:              'manual',
      note,
    });

    res.json({ success: true, product, breakdown: {
      basePrice: product.basePrice,
      platformFee: Math.round((product.basePrice * product.platformFeePercent) / 100 * 100) / 100,
      logisticsFee: Math.round((product.basePrice * product.logisticsPercent) / 100 * 100) / 100,
      sellerMargin: Math.round((product.basePrice * product.sellerMarginPercent) / 100 * 100) / 100,
      finalPrice: newFinal,
    }});
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const bulkUpdateDailyPrice = async (req, res) => {
  try {
    // updates: [{ productId, basePrice, sellerMarginPercent, stockQty }]
    const { updates } = req.body;
    if (!Array.isArray(updates) || !updates.length) {
      return res.status(400).json({ success: false, message: 'updates array required' });
    }

    const results = [];
    for (const u of updates) {
      try {
        const product = await KoyambeduProduct.findById(u.productId);
        if (!product) { results.push({ productId: u.productId, error: 'not found' }); continue; }

        const prevPrice = product.currentPrice;
        if (u.basePrice !== undefined)           product.basePrice           = u.basePrice;
        if (u.sellerMarginPercent !== undefined) product.sellerMarginPercent = u.sellerMarginPercent;
        if (u.stockQty !== undefined)            product.stockQty            = u.stockQty;

        const newFinal = calcFinalPrice(product);
        product.finalPrice    = newFinal;
        product.currentPrice  = newFinal;
        product.priceUpdatedAt = new Date();
        await product.save();

        await KoyambeduPriceHistory.create({
          product: product._id, seller: product.seller,
          productName: product.name, productCode: product.productCode,
          previousPrice: prevPrice, updatedPrice: newFinal,
          basePrice: product.basePrice, platformFeePercent: product.platformFeePercent,
          logisticsPercent: product.logisticsPercent, sellerMarginPercent: product.sellerMarginPercent,
          updatedBy: req.user._id, updatedByName: req.user.name || req.user.email,
          updatedByRole: req.user.role === 'superAdmin' ? 'superAdmin' : 'sellerAdmin',
          source: 'bulk_update',
        });
        results.push({ productId: u.productId, finalPrice: newFinal });
      } catch (e) {
        results.push({ productId: u.productId, error: e.message });
      }
    }
    res.json({ success: true, results });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ══════════════════════════════════════════════
// FEATURE 5 — Price History
// GET /seller-admin/price-history?productId=&days=7&from=&to=
// ══════════════════════════════════════════════
/** GET /api/koyambedu/products/:productId/price-history — public, last 30 days */
const getProductPriceHistory = async (req, res) => {
  try {
    const since = new Date();
    since.setDate(since.getDate() - 30);
    const history = await KoyambeduPriceHistory.find({
      product: req.params.productId,
      createdAt: { $gte: since },
    }).sort({ createdAt: -1 }).limit(30).select('price date createdAt note').lean();
    res.json({ success: true, history });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getPriceHistory = async (req, res) => {
  try {
    const { productId, days, from, to } = req.query;
    const filter = {};
    if (productId) filter.product = productId;

    const dateFilter = {};
    if (from) dateFilter.$gte = new Date(from);
    if (to)   dateFilter.$lte = new Date(new Date(to).setHours(23,59,59,999));
    if (!from && !to && days) {
      const d = new Date();
      d.setDate(d.getDate() - parseInt(days));
      dateFilter.$gte = d;
    }
    if (Object.keys(dateFilter).length) filter.createdAt = dateFilter;

    const history = await KoyambeduPriceHistory.find(filter)
      .sort({ createdAt: -1 })
      .limit(500)
      .populate('product', 'name productCode')
      .lean();

    res.json({ success: true, history });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ══════════════════════════════════════════════
// FEATURE 6 — Forecast Price
// GET  /seller-admin/forecast — list products with forecastPrice
// PATCH /seller-admin/forecast/:productId — set forecast
// POST  /seller-admin/forecast/:productId/approve — approve (sets currentPrice)
// ══════════════════════════════════════════════
const getForecasts = async (req, res) => {
  try {
    const sellers = await require('../models/KoyambeduSeller').find({}).select('_id').lean();
    const products = await KoyambeduProduct.find({ seller: { $in: sellers.map(s => s._id) }, isActive: true })
      .populate('seller', 'name')
      .select('name productCode currentPrice forecastPrice forecastApproved forecastApprovedAt priceUpdatedAt')
      .lean();
    res.json({ success: true, products });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const setForecastPrice = async (req, res) => {
  try {
    const { productId } = req.params;
    const { forecastPrice } = req.body;
    const product = await KoyambeduProduct.findByIdAndUpdate(
      productId,
      { forecastPrice, forecastApproved: false },
      { new: true }
    );
    if (!product) return res.status(404).json({ success: false, message: 'Product not found' });
    res.json({ success: true, product });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const approveForecast = async (req, res) => {
  try {
    const { productId } = req.params;
    const product = await KoyambeduProduct.findById(productId);
    if (!product) return res.status(404).json({ success: false, message: 'Product not found' });
    if (!product.forecastPrice) return res.status(400).json({ success: false, message: 'No forecast price set' });

    const prevPrice = product.currentPrice;
    product.currentPrice     = product.forecastPrice;
    product.finalPrice       = product.forecastPrice;
    product.priceUpdatedAt   = new Date();
    product.forecastApproved  = true;
    product.forecastApprovedAt = new Date();
    product.forecastApprovedBy = req.user._id;
    await product.save();

    await KoyambeduPriceHistory.create({
      product: product._id, seller: product.seller,
      productName: product.name, productCode: product.productCode,
      previousPrice: prevPrice, updatedPrice: product.forecastPrice,
      updatedBy: req.user._id, updatedByName: req.user.name || req.user.email,
      updatedByRole: req.user.role === 'superAdmin' ? 'superAdmin' : 'sellerAdmin',
      source: 'forecast_approved',
    });

    res.json({ success: true, product, message: `Forecast ₹${product.forecastPrice} is now today's price` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ══════════════════════════════════════════════
// FEATURE 7 — Procurement Summary Report
// GET /admin/reports/procurement?date=2026-06-22
// ══════════════════════════════════════════════
const procurementReport = async (req, res) => {
  try {
    const { date } = req.query;
    const cycle = date || getProcurementCycle();

    const startOfDay = new Date(`${cycle}T00:00:00.000+05:30`);
    const endOfDay   = new Date(`${cycle}T23:59:59.999+05:30`);

    const orders = await KoyambeduOrder.find({
      cutoffCycle: cycle,
      paymentStatus: 'paid',
      orderStatus: { $nin: ['cancelled'] },
    }).populate('items.product', 'name unit unitLabel').lean();

    // Aggregate by product
    const summary = {};
    for (const order of orders) {
      for (const item of order.items) {
        const key = item.product?._id?.toString() || item.name;
        if (!summary[key]) {
          summary[key] = {
            productId:   key,
            productName: item.name,
            unit:        item.unit || 'kg',
            unitLabel:   item.unitLabel || item.unit || 'kg',
            totalQty:    0,
            orderCount:  0,
          };
        }
        summary[key].totalQty  += item.quantity || 0;
        summary[key].orderCount += 1;
      }
    }

    res.json({
      success: true,
      cycle,
      totalOrders: orders.length,
      summary: Object.values(summary).sort((a, b) => a.productName.localeCompare(b.productName)),
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ══════════════════════════════════════════════
// FEATURE 8 — Slot-wise Order Report
// GET /admin/reports/slot-wise?date=2026-06-22&slot=slot1
// ══════════════════════════════════════════════
const slotWiseReport = async (req, res) => {
  try {
    const { date, slot } = req.query;
    const cycle = date || getProcurementCycle();

    const filter = {
      cutoffCycle:   cycle,
      paymentStatus: 'paid',
      orderStatus:   { $nin: ['cancelled'] },
    };
    if (slot) filter.deliverySlotKey = slot;

    const orders = await KoyambeduOrder.find(filter)
      .populate('buyer', 'name email phone')
      .populate('items.product', 'name')
      .sort({ deliverySlotKey: 1, createdAt: 1 })
      .lean();

    // Group by slot
    const grouped = { slot1: [], slot2: [], slot3: [] };
    for (const order of orders) {
      const key = order.deliverySlotKey || 'slot1';
      grouped[key].push({
        orderId:    order.orderId,
        buyerName:  order.buyer?.name || order.shippingAddress?.fullName,
        items:      order.items.map(i => `${i.name} x${i.quantity}${i.unit}`).join(', '),
        amount:     order.pricing?.total,
        slot:       order.deliverySlot,
      });
    }

    res.json({ success: true, cycle, grouped, slotLabels: DELIVERY_SLOTS });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ══════════════════════════════════════════════
// FEATURE 9 — Destination-wise Report
// GET /admin/reports/destination?date=2026-06-22
// ══════════════════════════════════════════════
const destinationReport = async (req, res) => {
  try {
    const { date } = req.query;
    const cycle = date || getProcurementCycle();

    const orders = await KoyambeduOrder.find({
      cutoffCycle:   cycle,
      paymentStatus: 'paid',
      orderStatus:   { $nin: ['cancelled'] },
    })
      .populate('buyer', 'name phone')
      .populate('items.product', 'name')
      .lean();

    // Group by pincode/area
    const grouped = {};
    for (const order of orders) {
      const pincode = order.shippingAddress?.pincode || order.buyerLocation?.pincode || 'Unknown';
      const area    = order.buyerLocation?.areaName  || order.shippingAddress?.city  || 'Chennai';
      const key     = `${area} — ${pincode}`;
      if (!grouped[key]) grouped[key] = { area, pincode, orders: [] };
      grouped[key].orders.push({
        orderId:      order.orderId,
        buyerName:    order.shippingAddress?.fullName || order.buyer?.name,
        phone:        order.shippingAddress?.phone,
        address:      `${order.shippingAddress?.addressLine1 || ''} ${order.shippingAddress?.addressLine2 || ''}`.trim(),
        deliverySlot: order.deliverySlot,
        amount:       order.pricing?.total,
        items:        order.items.map(i => `${i.name} x${i.quantity}${i.unit}`).join(', '),
      });
    }

    res.json({ success: true, cycle, grouped: Object.values(grouped).sort((a, b) => a.pincode.localeCompare(b.pincode)) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ══════════════════════════════════════════════
// FEATURE 10 — Enhanced Dashboard Stats
// GET /admin/reports/dashboard?date=2026-06-22
// ══════════════════════════════════════════════
const dashboardStats = async (req, res) => {
  try {
    const { date } = req.query;
    const cycle = date || getProcurementCycle();

    const [orders, totalSellers, totalProducts] = await Promise.all([
      KoyambeduOrder.find({ cutoffCycle: cycle, paymentStatus: 'paid', orderStatus: { $nin: ['cancelled'] } }).lean(),
      require('../models/KoyambeduSeller').countDocuments({ isApproved: true }),
      KoyambeduProduct.countDocuments({ isActive: true }),
    ]);

    const revenue = orders.reduce((s, o) => s + (o.pricing?.total || 0), 0);
    const pending = orders.filter(o => ['placed','pending_confirmation','confirmed','packing'].includes(o.orderStatus)).length;
    const delivered = orders.filter(o => o.orderStatus === 'delivered').length;

    // Slot breakdown
    const slotBreakdown = { slot1: 0, slot2: 0, slot3: 0 };
    orders.forEach(o => { if (o.deliverySlotKey) slotBreakdown[o.deliverySlotKey]++; });

    res.json({
      success: true,
      cycle,
      ordersToday:   orders.length,
      revenueToday:  Math.round(revenue * 100) / 100,
      pendingOrders: pending,
      deliveredOrders: delivered,
      totalSellers,
      totalProducts,
      slotBreakdown,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ══════════════════════════════════════════════
// FEATURE 12 — Special Occasion Requests
// ══════════════════════════════════════════════
const KoyambeduSpecialRequest = require('../models/KoyambeduSpecialRequest');
const nodemailer = require('nodemailer');

const sendSpecialRequestEmail = async (req) => {
  try {
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) return;
    const transporter = nodemailer.createTransporter({
      service: 'gmail',
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
    });
    const itemsList = (req.requestedItems || []).map(i => `• ${i.itemName} — ${i.quantity} ${i.unit}`).join('\n');
    await transporter.sendMail({
      from:    `"Eptomart Koyambedu" <${process.env.EMAIL_USER}>`,
      to:      process.env.ADMIN_EMAIL || process.env.EMAIL_USER,
      subject: `🎉 Special Occasion Request — ${req.occasionType} — ${req.buyerName}`,
      text:    `New special request received!\n\nName: ${req.buyerName}\nPhone: ${req.phone}\nEmail: ${req.email || '—'}\nOccasion: ${req.occasionType}\nRequired Date: ${req.requiredDate?.toDateString()}\n\nItems:\n${itemsList}\n\nNotes: ${req.additionalNotes || '—'}`,
    });
  } catch (e) {
    console.error('[KBD SpecialRequest Email]', e.message);
  }
};

const submitSpecialRequest = async (req, res) => {
  try {
    const { buyerName, phone, email, occasionType, occasionTypeOther, requestedItems, requiredDate, additionalNotes } = req.body;
    if (!buyerName || !phone || !requiredDate) {
      return res.status(400).json({ success: false, message: 'buyerName, phone, requiredDate required' });
    }
    const sr = await KoyambeduSpecialRequest.create({
      buyerName, phone, email, occasionType, occasionTypeOther,
      requestedItems, requiredDate, additionalNotes,
      user: req.user?._id,
    });
    // Fire-and-forget email
    sendSpecialRequestEmail(sr).then(async () => {
      sr.emailSent = true; sr.emailSentAt = new Date(); await sr.save();
    });
    res.json({ success: true, message: 'Request submitted! We will contact you within 24 hours.', request: sr });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getSpecialRequests = async (req, res) => {
  try {
    const { status } = req.query;
    const filter = status ? { status } : {};
    const requests = await KoyambeduSpecialRequest.find(filter).sort({ createdAt: -1 }).lean();
    res.json({ success: true, requests });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const updateSpecialRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, adminNotes } = req.body;
    const update = { status, adminNotes, handledBy: req.user._id };
    if (status === 'contacted') update.contactedAt = new Date();
    if (status === 'completed') update.completedAt = new Date();
    const sr = await KoyambeduSpecialRequest.findByIdAndUpdate(id, update, { new: true });
    if (!sr) return res.status(404).json({ success: false, message: 'Request not found' });
    res.json({ success: true, request: sr });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// expose helpers for routes
exports._calcFinalPrice       = calcFinalPrice;
exports._getProcurementCycle  = getProcurementCycle;
exports._generateProductCode  = generateProductCode;
exports._DELIVERY_SLOTS       = DELIVERY_SLOTS;

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
  adminGetSellers, adminCreateSeller, adminApproveSeller, adminToggleSeller, adminEditSellerContact,
  adminGetCategories, adminCreateCategory, adminEditCategory, adminApproveCategory, adminAnalytics,
  // Admin — seller admins (SuperAdmin only)
  adminUserSearch, adminCreateSellerAdmin, adminGetSellerAdmins, adminApproveSellerAdmin,
  // SellerAdmin portal
  sellerAdminGetProfile, sellerAdminGetSellers, sellerAdminCreateSeller,
  sellerAdminGetProducts, sellerAdminUpdateProduct, sellerAdminCreateProduct, sellerAdminToggleProduct,
  sellerAdminCreateCategory, sellerAdminGetCategories,
  sellerAdminRequestEdit,
  // Admin product management
  adminGetAllProducts, adminUpdateProduct, adminToggleProduct, adminCreateProduct, adminDeleteProduct,
  // Admin seller-edit review (SuperAdmin only)
  adminReviewSellerEdit,
  // AI
  aiTranslate, aiDescribe,
  // Image upload
  uploadImage,
  // SuperAdmin wipe
  adminWipeAll,
  // F4: Daily Price Panel
  getDailyPricePanel, updateDailyPrice, bulkUpdateDailyPrice,
  // F5: Price History
  getPriceHistory, getProductPriceHistory,
  // F6: Forecast
  getForecasts, setForecastPrice, approveForecast,
  // F7-F9: Reports
  procurementReport, slotWiseReport, destinationReport,
  // F10: Dashboard stats
  dashboardStats,
  // F12: Special Requests
  submitSpecialRequest, getSpecialRequests, updateSpecialRequest,
};
