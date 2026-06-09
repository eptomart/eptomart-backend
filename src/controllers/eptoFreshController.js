// ============================================
// EPTOFRESH CUSTOMER CONTROLLER
// Browse, Cart, Orders, Reviews, Wallet
// ============================================
'use strict';
const EptoFreshSeller  = require('../models/EptoFreshSeller');
const EptoFreshProduct = require('../models/EptoFreshProduct');
const EptoFreshOrder   = require('../models/EptoFreshOrder');
const EptoFreshCart    = require('../models/EptoFreshCart');
const EptoFreshReview  = require('../models/EptoFreshReview');
const EptoFreshWallet  = require('../models/EptoFreshWallet');
const EptoFreshPayout  = require('../models/EptoFreshPayout');
const EptoFreshCoupon         = require('../models/EptoFreshCoupon');
const EptoFreshDeliveryConfig = require('../models/EptoFreshDeliveryConfig');
const Razorpay         = require('razorpay');
const crypto           = require('crypto');
const { haversineDistance, calculateDeliveryCharge, calculatePayout } = require('../utils/eptoFreshDelivery');
const { notifyUser }   = require('../utils/pushNotification');
const { sendWhatsApp } = require('../utils/sendWhatsApp');

// ── Razorpay instance ─────────────────────────────────────────────────────
const getRazorpay = () => {
  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) return null;
  return new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET });
};

// ══════════════════════════════════════════════════════════
// DISCOVERY
// ══════════════════════════════════════════════════════════

/**
 * GET /eptofresh/sellers
 * Returns nearby sellers sorted by distance from customer GPS
 */
exports.getNearbySellers = async (req, res) => {
  const { lat, lng, category, radius = 30 } = req.query;
  const hasLocation = lat && lng;

  const query = { status: 'approved' };
  if (category) query.categories = category;

  const sellers = await EptoFreshSeller.find(query)
    .select('shopName categories rating ratingCount badges shopImage isOpen address location deliveryRadius')
    .lean();

  let result;
  if (hasLocation) {
    // With GPS — sort by distance and filter by radius
    result = sellers
      .map(s => {
        const [sLng, sLat] = s.location?.coordinates || [0, 0];
        const dist = haversineDistance(parseFloat(lat), parseFloat(lng), sLat, sLng);
        return { ...s, distanceKm: dist };
      })
      .filter(s => s.distanceKm <= parseFloat(radius))
      .sort((a, b) => a.distanceKm - b.distanceKm);
  } else {
    // No GPS — return all approved sellers without distance (sorted by rating)
    result = sellers
      .map(s => ({ ...s, distanceKm: null }))
      .sort((a, b) => (b.rating || 0) - (a.rating || 0));
  }

  res.json({ success: true, sellers: result, locationRequired: !hasLocation });
};

/**
 * GET /eptofresh/sellers/:sellerId
 * Public seller profile (no personal info)
 */
exports.getSellerProfile = async (req, res) => {
  const { lat, lng } = req.query;
  const seller = await EptoFreshSeller.findById(req.params.sellerId)
    .select('shopName categories rating ratingCount badges shopImage bannerImage isOpen address location openingTime closingTime')
    .lean();

  if (!seller) return res.status(404).json({ success: false, message: 'Seller not found' });

  let distanceKm = null;
  let deliveryInfo = null;
  if (lat && lng) {
    const [sLng, sLat] = seller.location?.coordinates || [0, 0];
    distanceKm = haversineDistance(parseFloat(lat), parseFloat(lng), sLat, sLng);
    deliveryInfo = calculateDeliveryCharge(distanceKm, 0);
  }

  // Remove private address details — show only city and pincode
  const safeAddress = { city: seller.address?.city, pincode: seller.address?.pincode };

  res.json({ success: true, seller: { ...seller, address: safeAddress, distanceKm, deliveryInfo } });
};

/**
 * GET /eptofresh/sellers/:sellerId/products
 * Products for a specific seller
 */
exports.getSellerProducts = async (req, res) => {
  const { category, inStock } = req.query;
  const query = {
    seller: req.params.sellerId,
    status: 'approved',
  };
  if (category) query.category = category;
  if (inStock === 'true') query.isInStock = true;

  const products = await EptoFreshProduct.find(query)
    .select('name nameLocal category subCategory cutTypes variants basePrice todayPrice images tags isInStock stock rating ratingCount')
    .sort({ 'tags.freshToday': -1, sortOrder: 1 })
    .lean();

  res.json({ success: true, products });
};

/**
 * POST /eptofresh/delivery-check
 * Calculate delivery charge before checkout
 */
exports.checkDelivery = async (req, res) => {
  const { sellerId, buyerLat, buyerLng, orderAmount, city } = req.body;
  const seller = await EptoFreshSeller.findById(sellerId).select('location address').lean();
  if (!seller) return res.status(404).json({ success: false, message: 'Seller not found' });

  const [sLng, sLat] = seller.location?.coordinates || [0, 0];
  const distanceKm = haversineDistance(buyerLat, buyerLng, sLat, sLng);

  // Load admin-configurable delivery settings
  const configDoc = await EptoFreshDeliveryConfig.findOne({ key: 'global' }).lean();
  const config    = configDoc || {};
  // Apply city-specific rule if available
  const sellerCity = city || seller.address?.city;
  let activeConfig = config;
  if (configDoc && configDoc.cityRules?.length && sellerCity) {
    const cityRule = configDoc.cityRules.find(r => r.city?.toLowerCase() === sellerCity.toLowerCase() && r.isActive);
    if (cityRule) activeConfig = { ...config, ...cityRule };
  }

  const info = calculateDeliveryCharge(distanceKm, parseFloat(orderAmount) || 0, activeConfig);

  res.json({ success: true, ...info });
};

// ══════════════════════════════════════════════════════════
// CART
// ══════════════════════════════════════════════════════════

exports.getCart = async (req, res) => {
  const cart = await EptoFreshCart.findOne({ user: req.user._id })
    .populate('seller', 'shopName shopImage isOpen rating')
    .populate('items.product', 'name images isInStock')
    .lean();

  if (!cart) return res.json({ success: true, cart: null, items: [], total: 0 });

  const total = cart.items.reduce((sum, i) => sum + i.price * i.quantity, 0);
  res.json({ success: true, cart, total });
};

exports.updateCart = async (req, res) => {
  const { sellerId, productId, variantId, weight, label, price, quantity, cutType, name, image, buyerLat, buyerLng } = req.body;

  let cart = await EptoFreshCart.findOne({ user: req.user._id });

  // If switching seller — clear old cart
  if (cart && cart.seller && cart.seller.toString() !== sellerId) {
    cart.items = [];
    cart.seller = sellerId;
  }

  if (!cart) {
    cart = new EptoFreshCart({ user: req.user._id, seller: sellerId, items: [] });
  }

  if (!cart.seller) cart.seller = sellerId;

  const idx = cart.items.findIndex(
    i => i.product.toString() === productId && i.variantId?.toString() === variantId
  );

  if (quantity <= 0) {
    if (idx > -1) cart.items.splice(idx, 1);
  } else {
    if (idx > -1) {
      cart.items[idx].quantity = quantity;
    } else {
      cart.items.push({ product: productId, variantId, weight, label, price, quantity, cutType, name, image });
    }
  }

  // Store distance snapshot
  if (buyerLat && buyerLng) {
    const seller = await EptoFreshSeller.findById(sellerId).select('location').lean();
    if (seller) {
      const [sLng, sLat] = seller.location?.coordinates || [0, 0];
      cart.distanceKm = haversineDistance(buyerLat, buyerLng, sLat, sLng);
    }
  }

  await cart.save();
  const total = cart.items.reduce((sum, i) => sum + i.price * i.quantity, 0);
  res.json({ success: true, cart, total });
};

exports.clearCart = async (req, res) => {
  await EptoFreshCart.findOneAndUpdate({ user: req.user._id }, { items: [], seller: null }, { new: true });
  res.json({ success: true });
};

// ══════════════════════════════════════════════════════════
// ORDER PLACEMENT
// ══════════════════════════════════════════════════════════

/**
 * POST /eptofresh/orders
 * Create order from cart — Razorpay or COD
 */
exports.placeOrder = async (req, res) => {
  const {
    sellerId, shippingAddress, paymentMethod,
    buyerLat, buyerLng, couponCode, useWallet,
  } = req.body;

  const cart = await EptoFreshCart.findOne({ user: req.user._id })
    .populate('items.product', 'name category images variants isInStock stock')
    .lean();

  if (!cart || !cart.items?.length) {
    return res.status(400).json({ success: false, message: 'Cart is empty' });
  }

  const seller = await EptoFreshSeller.findById(sellerId).lean();
  if (!seller || seller.status !== 'approved') {
    return res.status(400).json({ success: false, message: 'Seller not available' });
  }

  // Validate stock
  for (const item of cart.items) {
    if (!item.product?.isInStock) {
      return res.status(400).json({ success: false, message: `${item.name} is out of stock` });
    }
  }

  // Calculate distance
  const [sLng, sLat] = seller.location?.coordinates || [0, 0];
  const distanceKm = haversineDistance(buyerLat || 0, buyerLng || 0, sLat, sLng);

  // Calculate pricing
  let subtotal = cart.items.reduce((sum, i) => sum + i.price * i.quantity, 0);
  let couponDiscount = 0;

  // Apply coupon
  if (couponCode) {
    const coupon = await EptoFreshCoupon.findOne({
      code: couponCode.toUpperCase(),
      isActive: true,
      validFrom: { $lte: new Date() },
      validTo:   { $gte: new Date() },
      minOrderValue: { $lte: subtotal },
    });
    if (coupon) {
      if (coupon.discountType === 'flat') {
        couponDiscount = Math.min(coupon.discountValue, subtotal);
      } else {
        couponDiscount = Math.min((subtotal * coupon.discountValue) / 100, coupon.maxDiscount || Infinity);
      }
      coupon.usedCount = (coupon.usedCount || 0) + 1;
      await coupon.save();
    }
  }

  const afterCoupon = subtotal - couponDiscount;
  const { charge: deliveryCharge } = calculateDeliveryCharge(distanceKm, afterCoupon);

  // Wallet
  let walletApplied = 0;
  if (useWallet) {
    const wallet = await EptoFreshWallet.findOne({ user: req.user._id });
    if (wallet && wallet.balance > 0) {
      walletApplied = Math.min(wallet.balance, afterCoupon + deliveryCharge);
    }
  }

  const total = Math.max(0, afterCoupon + deliveryCharge - walletApplied);

  // Payout calculation
  const payoutInfo = calculatePayout(subtotal, seller.commissionRate || 10);

  // Build items array for order
  const orderItems = cart.items.map(i => ({
    product:     i.product._id,
    seller:      sellerId,
    productName: i.name,
    category:    i.product.category,
    cutType:     i.cutType,
    variant:     { weight: i.weight, label: i.label, price: i.price },
    quantity:    i.quantity,
    unitPrice:   i.price,
    totalPrice:  i.price * i.quantity,
    sellerPayout:parseFloat(((i.price * i.quantity * (1 - (seller.commissionRate || 10) / 100 - 0.018)).toFixed(2))),
  }));

  // Generate delivery OTP
  const deliveryOtp = Math.floor(100000 + Math.random() * 900000).toString();

  const order = new EptoFreshOrder({
    buyer:          req.user._id,
    seller:         sellerId,
    buyerLocation:  { lat: buyerLat, lng: buyerLng },
    shippingAddress:{ ...shippingAddress, lat: buyerLat, lng: buyerLng },
    items:          orderItems,
    distanceKm,
    paymentMethod:  paymentMethod || 'razorpay',
    paymentStatus:  paymentMethod === 'cod' ? 'pending' : 'pending',
    orderStatus:    paymentMethod === 'cod' ? 'placed' : 'payment_pending',
    pricing: {
      subtotal,
      deliveryCharge,
      couponDiscount,
      walletApplied,
      total,
      platformFee:    payoutInfo.platformFee,
      gstOnFee:       payoutInfo.gstOnFee,
      sellerReceives: payoutInfo.sellerReceives,
    },
    couponCode,
    walletUsed:  walletApplied > 0,
    deliveryOtp,
    statusHistory: [{ status: paymentMethod === 'cod' ? 'placed' : 'payment_pending', updatedBy: 'customer' }],
  });

  await order.save();

  // Deduct wallet immediately
  if (walletApplied > 0) {
    const wallet = await EptoFreshWallet.findOne({ user: req.user._id });
    if (wallet) {
      wallet.balance -= walletApplied;
      wallet.transactions.push({
        type: 'debit', amount: walletApplied,
        description: `Order #${order.orderId}`, order: order._id,
        balance: wallet.balance,
      });
      await wallet.save();
    }
  }

  // Clear cart
  await EptoFreshCart.findOneAndUpdate({ user: req.user._id }, { items: [], seller: null });

  // For COD — notify seller and admin immediately
  if (paymentMethod === 'cod') {
    _notifyNewOrder(order, seller).catch(() => {});
  }

  // For Razorpay — create payment order
  if (paymentMethod === 'razorpay') {
    const razorpay = getRazorpay();
    if (!razorpay) return res.status(503).json({ success: false, message: 'Payment gateway not configured' });

    const rzpOrder = await razorpay.orders.create({
      amount:   Math.round(total * 100),
      currency: 'INR',
      receipt:  order.orderId,
      notes:    { orderId: order._id.toString() },
    });

    order.paymentDetails = { ...order.paymentDetails, razorpayOrderId: rzpOrder.id };
    await order.save();

    return res.json({
      success: true,
      orderId: order._id,
      orderNumber: order.orderId,
      razorpayOrderId: rzpOrder.id,
      amount: rzpOrder.amount,
      currency: 'INR',
      keyId: process.env.RAZORPAY_KEY_ID,
      pricing: order.pricing,
    });
  }

  res.json({ success: true, orderId: order._id, orderNumber: order.orderId, pricing: order.pricing });
};

/**
 * POST /eptofresh/orders/verify-payment
 */
exports.verifyPayment = async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, orderId } = req.body;

  const expected = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest('hex');

  if (expected !== razorpay_signature) {
    return res.status(400).json({ success: false, message: 'Payment verification failed' });
  }

  const order = await EptoFreshOrder.findById(orderId);
  if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

  order.paymentStatus = 'paid';
  order.orderStatus   = 'placed';
  order.placedAt      = new Date();
  order.paymentDetails = { razorpayOrderId: razorpay_order_id, razorpayPaymentId: razorpay_payment_id, razorpaySignature: razorpay_signature, paidAt: new Date() };
  order.statusHistory.push({ status: 'placed', updatedBy: 'system' });
  await order.save();

  // Notify seller and admin
  const seller = await EptoFreshSeller.findById(order.seller).lean();
  _notifyNewOrder(order, seller).catch(() => {});

  res.json({ success: true, message: 'Payment confirmed! Order placed.', orderId: order.orderId });
};

// ══════════════════════════════════════════════════════════
// MY ORDERS
// ══════════════════════════════════════════════════════════

exports.getMyOrders = async (req, res) => {
  const { status, page = 1, limit = 20 } = req.query;
  const query = { buyer: req.user._id };
  if (status) query.orderStatus = status;

  const orders = await EptoFreshOrder.find(query)
    .select('-shippingAddress.phone -shippingAddress.addressLine1 -shippingAddress.lat -shippingAddress.lng -deliveryOtp -porter.driverPhone')
    .populate('seller', 'shopName shopImage rating')
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(parseInt(limit))
    .lean();

  const total = await EptoFreshOrder.countDocuments(query);
  res.json({ success: true, orders, total, page: parseInt(page), pages: Math.ceil(total / limit) });
};

exports.getOrderDetail = async (req, res) => {
  const order = await EptoFreshOrder.findOne({ _id: req.params.orderId, buyer: req.user._id })
    .populate('seller', 'shopName shopImage rating address.city')
    .populate('items.product', 'name images')
    .lean();

  if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

  // Mask sensitive porter driver phone
  if (order.porter) delete order.porter.driverPhone;

  res.json({ success: true, order });
};

/**
 * POST /eptofresh/orders/:orderId/confirm-delivery
 * Customer confirms OTP — triggers payout
 */
exports.confirmDelivery = async (req, res) => {
  const { otp } = req.body;
  const order = await EptoFreshOrder.findOne({ _id: req.params.orderId, buyer: req.user._id });
  if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

  if (order.deliveryOtp !== otp) {
    return res.status(400).json({ success: false, message: 'Incorrect OTP. Please check the code shown by the delivery person.' });
  }

  order.orderStatus = 'delivered';
  order.deliveryOtpVerified = true;
  order.deliveredAt = new Date();
  order.statusHistory.push({ status: 'delivered', updatedBy: 'customer' });
  await order.save();

  // Trigger payout
  _triggerPayout(order).catch(() => {});

  // Prompt for rating
  notifyUser(req.user._id, {
    title: '✅ Order Delivered!',
    body:  `How was your order? Rate your experience.`,
    url:   `/eptofresh/orders/${order._id}/rate`,
  }).catch(() => {});

  res.json({ success: true, message: 'Delivery confirmed! Payout is being processed.' });
};

/**
 * POST /eptofresh/orders/:orderId/cancel
 */
exports.cancelOrder = async (req, res) => {
  const order = await EptoFreshOrder.findOne({ _id: req.params.orderId, buyer: req.user._id });
  if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

  const cancellable = ['payment_pending', 'placed', 'accepted'];
  if (!cancellable.includes(order.orderStatus)) {
    return res.status(400).json({ success: false, message: 'Order cannot be cancelled at this stage' });
  }

  order.orderStatus = 'cancelled';
  order.cancelReason = req.body.reason || 'Cancelled by customer';
  order.cancelledBy  = 'customer';
  order.cancelledAt  = new Date();
  order.statusHistory.push({ status: 'cancelled', updatedBy: 'customer', note: order.cancelReason });
  await order.save();

  // Refund if paid
  if (order.paymentStatus === 'paid') {
    order.refund = { status: 'initiated', amount: order.pricing.total, reason: order.cancelReason, initiatedAt: new Date() };
    await order.save();
    // Admin handles actual refund
  }

  res.json({ success: true, message: 'Order cancelled.' });
};

// ══════════════════════════════════════════════════════════
// REVIEWS
// ══════════════════════════════════════════════════════════

exports.submitReview = async (req, res) => {
  const { productRating, storeRating, deliveryRating, comment } = req.body;
  const order = await EptoFreshOrder.findOne({ _id: req.params.orderId, buyer: req.user._id });
  if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
  if (order.orderStatus !== 'delivered') return res.status(400).json({ success: false, message: 'Can only review delivered orders' });
  if (order.rated) return res.status(400).json({ success: false, message: 'Already reviewed' });

  const review = new EptoFreshReview({
    order: order._id, buyer: req.user._id, seller: order.seller,
    product: order.items[0]?.product,
    productRating, storeRating, deliveryRating, comment,
  });
  await review.save();

  order.rated = true; order.ratedAt = new Date();
  await order.save();

  // Update seller rating
  const sellerReviews = await EptoFreshReview.find({ seller: order.seller, storeRating: { $exists: true } });
  const avgRating = sellerReviews.reduce((s, r) => s + r.storeRating, 0) / sellerReviews.length;
  await EptoFreshSeller.findByIdAndUpdate(order.seller, { rating: avgRating.toFixed(1), ratingCount: sellerReviews.length });

  res.json({ success: true, message: 'Thank you for your review!' });
};

// ══════════════════════════════════════════════════════════
// WALLET
// ══════════════════════════════════════════════════════════

exports.getWallet = async (req, res) => {
  let wallet = await EptoFreshWallet.findOne({ user: req.user._id }).lean();
  if (!wallet) wallet = { balance: 0, transactions: [] };
  res.json({ success: true, wallet });
};

// ══════════════════════════════════════════════════════════
// COUPON VALIDATION
// ══════════════════════════════════════════════════════════

exports.validateCoupon = async (req, res) => {
  const { code, orderAmount } = req.body;
  const coupon = await EptoFreshCoupon.findOne({
    code: code.toUpperCase(), isActive: true,
    validFrom: { $lte: new Date() }, validTo: { $gte: new Date() },
  });
  if (!coupon) return res.status(404).json({ success: false, message: 'Invalid or expired coupon' });
  if (orderAmount < coupon.minOrderValue) {
    return res.status(400).json({ success: false, message: `Minimum order ₹${coupon.minOrderValue} required` });
  }

  let discount = 0;
  if (coupon.discountType === 'flat') {
    discount = Math.min(coupon.discountValue, orderAmount);
  } else {
    discount = Math.min((orderAmount * coupon.discountValue) / 100, coupon.maxDiscount || Infinity);
  }

  res.json({ success: true, discount, coupon: { code: coupon.code, description: coupon.description } });
};

// ══════════════════════════════════════════════════════════
// LIVE TRACKING (customer)
// ══════════════════════════════════════════════════════════

exports.getTracking = async (req, res) => {
  const order = await EptoFreshOrder.findOne({ _id: req.params.orderId, buyer: req.user._id })
    .select('orderStatus porter statusHistory distanceKm deliveryOtp seller pricing')
    .populate('seller', 'shopName')
    .lean();

  if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

  // Customer sees tracking URL and driver location — NOT driver phone
  const tracking = {
    orderStatus: order.orderStatus,
    statusHistory: order.statusHistory,
    porter: order.porter ? {
      status:            order.porter.status,
      driverName:        order.porter.driverName,
      driverLat:         order.porter.driverLat,
      driverLng:         order.porter.driverLng,
      trackingUrl:       order.porter.trackingUrl,
      estimatedDelivery: order.porter.estimatedDelivery,
    } : null,
    // Show OTP only when driver is near / out for delivery
    deliveryOtp: ['out_for_delivery', 'porter_assigned', 'picked_up'].includes(order.orderStatus)
      ? order.deliveryOtp : null,
  };

  res.json({ success: true, tracking });
};

// ══════════════════════════════════════════════════════════
// INTERNAL HELPERS
// ══════════════════════════════════════════════════════════

async function _notifyNewOrder(order, seller) {
  try {
    // Push to admin
    notifyUser(null, {
      title: `🛒 New EptoFresh Order #${order.orderId}`,
      body:  `From ${seller?.shopName || 'seller'}. Total ₹${order.pricing.total}`,
      url:   '/admin/eptofresh',
      tag:   `epf-order-${order.orderId}`,
    }, { adminOnly: true }).catch(() => {});

    // WhatsApp to seller
    if (seller?.contact?.phone && seller.notifyWhatsApp) {
      const itemsSummary = order.items.map(i => `${i.productName} x${i.quantity}`).join(', ');
      sendWhatsApp(seller.contact.phone, `EptoFresh New Order #${order.orderId}\nItems: ${itemsSummary}\nTotal: ₹${order.pricing.total}\nPlease accept or reject in your seller panel.`).catch(() => {});
    }
  } catch (e) { /* non-critical */ }
}

async function _triggerPayout(order) {
  try {
    const payout = new EptoFreshPayout({
      seller:          order.seller,
      order:           order._id,
      orderId:         order.orderId,
      orderTotal:      order.pricing.subtotal,
      platformFee:     order.pricing.platformFee,
      gstOnFee:        order.pricing.gstOnFee,
      totalDeduction:  order.pricing.platformFee + order.pricing.gstOnFee,
      sellerReceives:  order.pricing.sellerReceives,
      triggeredAt:     new Date(),
      status:          'pending',
    });
    await payout.save();

    // Update seller pending payout balance
    await EptoFreshSeller.findByIdAndUpdate(order.seller, {
      $inc: { pendingPayout: order.pricing.sellerReceives, totalEarnings: order.pricing.sellerReceives },
    });
  } catch (e) {
    console.error('[EptoFresh Payout] trigger failed:', e.message);
  }
}
