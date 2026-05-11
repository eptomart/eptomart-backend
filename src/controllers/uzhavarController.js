// ============================================
// UZHAVAR FRESH CONTROLLER
// ============================================
const Farmer             = require('../models/Farmer');
const FarmerProduct      = require('../models/FarmerProduct');
const UzhavarOrder       = require('../models/UzhavarOrder');
const UzhavarSubscription = require('../models/UzhavarSubscription');
const Razorpay           = require('razorpay');
const crypto             = require('crypto');

const getRazorpay = () => {
  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) return null;
  return new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET });
};

// ── Helper: find farmer by user ID, fallback to phone (auto-links) ──
const getFarmerForUser = async (user) => {
  // Primary lookup
  let farmer = await Farmer.findOne({ user: user._id });
  if (farmer) return farmer;

  // Fallback for admin-created farmers (user: null, matched by phone)
  if (user.phone) {
    farmer = await Farmer.findOne({ phone: user.phone, user: null });
    if (farmer) {
      farmer.user = user._id;
      await farmer.save();
    }
  }
  return farmer || null;
};

// ── BUYER: Get all approved farmers (default, no geo filter) ──
exports.getAllFarmers = async (req, res) => {
  const farmers = await Farmer.find({ verificationStatus: 'approved', isActive: true })
    .select('-aadhaarNumber -bankAccount.accountNumber -bankAccount.ifsc')
    .sort({ 'ratings.average': -1, createdAt: -1 })
    .limit(50).lean();
  res.json({ success: true, farmers });
};

// ── BUYER: Get nearby farmers ───────────────────────────────────
exports.getNearbyFarmers = async (req, res) => {
  const { lat, lng, pincode, radius = 10 } = req.query;
  const baseQuery = { verificationStatus: 'approved', isActive: true };
  let farmers = [];

  if (lat && lng) {
    const parsedLat = parseFloat(lat);
    const parsedLng = parseFloat(lng);

    // Try GPS $near first — only if coordinates look valid (not 0,0)
    const hasValidGPS = !(parsedLat === 0 && parsedLng === 0);
    if (hasValidGPS) {
      try {
        farmers = await Farmer.find({
          ...baseQuery,
          gpsLocation: {
            $near: {
              $geometry: { type: 'Point', coordinates: [parsedLng, parsedLat] },
              $maxDistance: parseFloat(radius) * 1000,
            },
          },
        })
        .select('-aadhaarNumber -bankAccount.accountNumber -bankAccount.ifsc')
        .limit(30).lean();
      } catch (_) {
        farmers = [];
      }
    }

    // Fallback: if geo query returned nothing, show all approved farmers
    if (farmers.length === 0) {
      farmers = await Farmer.find(baseQuery)
        .select('-aadhaarNumber -bankAccount.accountNumber -bankAccount.ifsc')
        .sort({ 'ratings.average': -1, createdAt: -1 })
        .limit(50).lean();
    }
  } else if (pincode) {
    // Pincode match — also fallback to all if none found
    farmers = await Farmer.find({ ...baseQuery, 'address.pincode': pincode })
      .select('-aadhaarNumber -bankAccount.accountNumber -bankAccount.ifsc')
      .limit(30).lean();

    if (farmers.length === 0) {
      farmers = await Farmer.find(baseQuery)
        .select('-aadhaarNumber -bankAccount.accountNumber -bankAccount.ifsc')
        .sort({ 'ratings.average': -1, createdAt: -1 })
        .limit(50).lean();
    }
  } else {
    // No location at all — return all
    farmers = await Farmer.find(baseQuery)
      .select('-aadhaarNumber -bankAccount.accountNumber -bankAccount.ifsc')
      .sort({ 'ratings.average': -1, createdAt: -1 })
      .limit(50).lean();
  }

  res.json({ success: true, farmers });
};

// ── BUYER: Get farmer products ──────────────────────────────────
exports.getFarmerProducts = async (req, res) => {
  const { farmerId } = req.params;
  const today = new Date();

  const products = await FarmerProduct.find({
    farmer:    farmerId,
    isActive:  true,
    soldOut:   false,
    expiryDate:{ $gte: today },
    availableQuantity: { $gt: 0 },
  }).sort({ harvestFrom: 1 }).lean();

  res.json({ success: true, products });
};

// ── BUYER: Search products near location ───────────────────────
exports.searchNearbyProducts = async (req, res) => {
  const { lat, lng, pincode, category, radius = 10 } = req.query;
  const today = new Date();
  const baseQ = { verificationStatus: 'approved', isActive: true };

  let farmerIds;

  if (lat && lng) {
    const parsedLat = parseFloat(lat), parsedLng = parseFloat(lng);
    const hasValidGPS = !(parsedLat === 0 && parsedLng === 0);
    let geoFarmers = [];
    if (hasValidGPS) {
      try {
        geoFarmers = await Farmer.find({
          ...baseQ,
          gpsLocation: {
            $near: {
              $geometry: { type: 'Point', coordinates: [parsedLng, parsedLat] },
              $maxDistance: parseFloat(radius) * 1000,
            },
          },
        }).select('_id').limit(50).lean();
      } catch (_) { geoFarmers = []; }
    }
    const fallback = geoFarmers.length === 0
      ? await Farmer.find(baseQ).select('_id').limit(50).lean()
      : geoFarmers;
    farmerIds = fallback.map(f => f._id);
  } else if (pincode) {
    let pinFarmers = await Farmer.find({ ...baseQ, 'address.pincode': pincode }).select('_id').limit(50).lean();
    if (pinFarmers.length === 0) pinFarmers = await Farmer.find(baseQ).select('_id').limit(50).lean();
    farmerIds = pinFarmers.map(f => f._id);
  } else {
    const all = await Farmer.find(baseQ).select('_id').limit(50).lean();
    farmerIds = all.map(f => f._id);
  }

  const productQuery = {
    farmer: { $in: farmerIds },
    isActive: true, soldOut: false,
    expiryDate: { $gte: today },
    availableQuantity: { $gt: 0 },
  };
  if (category) productQuery.category = category;

  const products = await FarmerProduct.find(productQuery)
    .populate('farmer', 'name address ratings deliveryRadius availableNow')
    .sort({ harvestFrom: 1 })
    .limit(100).lean();

  res.json({ success: true, products });
};

// ── BUYER: Cancel a payment_pending order (restores stock) ───────
exports.cancelPaymentPendingOrder = async (req, res) => {
  try {
    const { orderId } = req.params;
    const order = await UzhavarOrder.findOne({ _id: orderId, buyer: req.user._id, status: 'payment_pending' });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found or cannot be cancelled' });

    // Restore stock
    for (const it of order.items) {
      await FarmerProduct.findByIdAndUpdate(it.product, { $inc: { availableQuantity: it.quantity } });
    }

    order.status = 'cancelled';
    order.cancelledAt = new Date();
    order.cancelledBy = 'buyer';
    order.cancellationReason = 'Payment not completed';
    await order.save();

    res.json({ success: true, message: 'Order cancelled and stock restored' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── BUYER: Create order (after payment) ────────────────────────
exports.createOrder = async (req, res) => {
  const { farmerId, items, bookingType, scheduledDate, scheduledSlot,
          deliveryAddress, paymentMethod, subscriptionId } = req.body;
  const buyerId = req.user._id;

  // Validate items + calc subtotal
  let subtotal = 0;
  let totalKg = 0;
  const enrichedItems = [];
  for (const it of items) {
    const prod = await FarmerProduct.findById(it.productId);
    if (!prod || !prod.isActive || prod.soldOut) {
      return res.status(400).json({ success: false, message: `Product ${it.productId} unavailable` });
    }
    if (it.quantity <= 0) {
      return res.status(400).json({ success: false, message: `Invalid quantity for ${prod.name}` });
    }
    if (it.quantity > prod.availableQuantity) {
      return res.status(400).json({ success: false, message: `Only ${prod.availableQuantity} ${prod.unit} available for ${prod.name}` });
    }
    // Count kg-unit items for minimum order validation
    if (prod.unit === 'kg') totalKg += it.quantity;
    const line = parseFloat((prod.pricePerUnit * it.quantity).toFixed(2));
    subtotal += line;
    enrichedItems.push({
      product: prod._id, name: prod.name, nameTa: prod.nameTa,
      unit: prod.unit, quantity: it.quantity,
      pricePerUnit: prod.pricePerUnit, lineTotal: line,
    });
  }

  // Minimum order: 5 kg total for Uzhavar Fresh
  const UZHAVAR_MIN_KG = 5;
  if (totalKg > 0 && totalKg < UZHAVAR_MIN_KG) {
    return res.status(400).json({
      success: false,
      message: `Minimum order quantity for Uzhavar Fresh is ${UZHAVAR_MIN_KG} kg. You have ${totalKg} kg in your cart.`,
    });
  }

  // Booking fee
  const bookingFee = { base: 21, gst: parseFloat((21 * 0.18).toFixed(2)), total: parseFloat((21 * 1.18).toFixed(2)) };
  const grandTotal = parseFloat((subtotal + (paymentMethod === 'subscription' ? 0 : bookingFee.total)).toFixed(2));

  // Validate subscription if used
  if (paymentMethod === 'subscription') {
    const sub = await UzhavarSubscription.findOne({ _id: subscriptionId, buyer: buyerId, isActive: true });
    if (!sub || new Date() > sub.endDate) {
      return res.status(400).json({ success: false, message: 'Subscription expired or invalid' });
    }
  }

  const order = await UzhavarOrder.create({
    buyer: buyerId, farmer: farmerId,
    items: enrichedItems,
    bookingType,
    scheduledDate: scheduledDate ? new Date(scheduledDate) : null,
    scheduledSlot,
    deliveryAddress,
    bookingFee,
    subtotal: parseFloat(subtotal.toFixed(2)),
    grandTotal,
    paymentMethod,
    subscriptionId: paymentMethod === 'subscription' ? subscriptionId : null,
    status: paymentMethod === 'subscription' ? 'pending_farmer' : 'payment_pending',
  });

  // Deduct stock
  for (const it of enrichedItems) {
    await FarmerProduct.findByIdAndUpdate(it.product, {
      $inc: { availableQuantity: -it.quantity },
    });
  }

  // If subscription — mark sub usage
  if (paymentMethod === 'subscription') {
    await UzhavarSubscription.findByIdAndUpdate(subscriptionId, { $inc: { ordersUsed: 1 } });
  }

  res.status(201).json({ success: true, order });
};

// ── BUYER: Create Razorpay payment order ───────────────────────
exports.createPaymentOrder = async (req, res) => {
  const { uzhavarOrderId } = req.body;
  const rzp = getRazorpay();
  if (!rzp) return res.status(503).json({ success: false, message: 'Payment not configured' });

  const order = await UzhavarOrder.findOne({ _id: uzhavarOrderId, buyer: req.user._id });
  if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

  const rzpOrder = await rzp.orders.create({
    amount:   Math.round(order.grandTotal * 100),
    currency: 'INR',
    receipt:  order.orderNumber,
    notes:    { type: 'uzhavar_fresh', orderId: order._id.toString() },
  });

  order.razorpayOrderId = rzpOrder.id;
  await order.save();

  res.json({ success: true, rzpOrderId: rzpOrder.id, amount: rzpOrder.amount, currency: rzpOrder.currency, orderNumber: order.orderNumber });
};

// ── BUYER: Verify payment + activate order ─────────────────────
exports.verifyPayment = async (req, res) => {
  const { uzhavarOrderId, razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;

  const expected = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || '')
    .update(`${razorpayOrderId}|${razorpayPaymentId}`)
    .digest('hex');

  if (expected !== razorpaySignature) {
    return res.status(400).json({ success: false, message: 'Payment verification failed' });
  }

  const order = await UzhavarOrder.findByIdAndUpdate(uzhavarOrderId, {
    razorpayOrderId, razorpayPaymentId,
    paymentStatus: 'paid',
    status: 'pending_farmer',
  }, { new: true });

  res.json({ success: true, order });
};

// ── BUYER: Confirm order after farmer accepts ──────────────────
exports.buyerConfirmOrder = async (req, res) => {
  const { orderId } = req.params;
  const order = await UzhavarOrder.findOne({ _id: orderId, buyer: req.user._id, status: 'farmer_accepted' });
  if (!order) return res.status(404).json({ success: false, message: 'Order not found or not in farmer_accepted state' });

  if (new Date() > order.buyerConfirmDeadline) {
    // Restore stock on auto-cancel
    for (const it of order.items) {
      await FarmerProduct.findByIdAndUpdate(it.product, { $inc: { availableQuantity: it.quantity } });
    }
    order.status = 'auto_cancelled';
    order.cancelledAt = new Date();
    order.cancelledBy = 'system';
    order.cancellationReason = 'Buyer did not confirm within 15 minutes';
    await order.save();
    return res.status(400).json({ success: false, message: 'Confirmation window expired. Order auto-cancelled.' });
  }

  order.status = 'buyer_confirmed';
  order.buyerConfirmedAt = new Date();
  await order.save();

  res.json({ success: true, order });
};

// ── FARMER: Accept order ───────────────────────────────────────
exports.farmerAcceptOrder = async (req, res) => {
  const { orderId } = req.params;
  const farmer = await getFarmerForUser(req.user);
  if (!farmer) return res.status(403).json({ success: false, message: 'Not a farmer account' });

  const order = await UzhavarOrder.findOne({ _id: orderId, farmer: farmer._id, status: 'pending_farmer' });
  if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

  const deadline = new Date();
  deadline.setMinutes(deadline.getMinutes() + 15);

  order.status = 'farmer_accepted';
  order.farmerAcceptedAt = new Date();
  order.buyerConfirmDeadline = deadline;
  await order.save();

  res.json({ success: true, order, confirmDeadline: deadline });
};

// ── FARMER: Reject order ───────────────────────────────────────
exports.farmerRejectOrder = async (req, res) => {
  const { orderId } = req.params;
  const { reason } = req.body;
  const farmer = await getFarmerForUser(req.user);
  if (!farmer) return res.status(403).json({ success: false, message: 'Not a farmer account' });

  const order = await UzhavarOrder.findOne({ _id: orderId, farmer: farmer._id, status: 'pending_farmer' });
  if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

  // Restore stock
  for (const it of order.items) {
    await FarmerProduct.findByIdAndUpdate(it.product, { $inc: { availableQuantity: it.quantity } });
  }

  order.status = 'cancelled';
  order.cancelledAt = new Date();
  order.cancelledBy = 'farmer';
  order.cancellationReason = reason || 'Farmer rejected';
  await order.save();

  res.json({ success: true, order });
};

// ── BUYER: Rate order ──────────────────────────────────────────
exports.rateOrder = async (req, res) => {
  const { orderId } = req.params;
  const { freshness, quality, delivery, behaviour, comment } = req.body;

  const order = await UzhavarOrder.findOne({ _id: orderId, buyer: req.user._id, status: 'delivered' });
  if (!order) return res.status(404).json({ success: false, message: 'Order not found or not delivered' });
  if (order.rating?.ratedAt) return res.status(400).json({ success: false, message: 'Already rated' });

  order.rating = { freshness, quality, delivery, behaviour, comment, ratedAt: new Date() };
  await order.save();

  // Update farmer aggregate ratings
  const farmer = await Farmer.findById(order.farmer);
  if (farmer) {
    const r = farmer.ratings;
    ['freshness', 'quality', 'delivery', 'behaviour'].forEach(k => {
      r[k].total += req.body[k] || 0;
      r[k].count += 1;
    });
    r.count += 1;
    r.average = parseFloat((
      (r.freshness.total / r.freshness.count +
       r.quality.total   / r.quality.count +
       r.delivery.total  / r.delivery.count +
       r.behaviour.total / r.behaviour.count) / 4
    ).toFixed(2));
    await farmer.save();
  }

  res.json({ success: true });
};

// ── SUBSCRIPTION: Create ───────────────────────────────────────
exports.createSubscription = async (req, res) => {
  const { plan } = req.body;
  const pricing = UzhavarSubscription.calcPricing(plan);
  if (!pricing) return res.status(400).json({ success: false, message: 'Invalid plan' });

  const rzp = getRazorpay();
  if (!rzp) return res.status(503).json({ success: false, message: 'Payment not configured' });

  const rzpOrder = await rzp.orders.create({
    amount:   Math.round(pricing.total * 100),
    currency: 'INR',
    receipt:  `sub_${req.user._id}_${Date.now()}`,
    notes:    { type: 'uzhavar_subscription', plan },
  });

  const sub = await UzhavarSubscription.create({
    buyer: req.user._id, plan, pricing,
    razorpayOrderId: rzpOrder.id,
  });

  res.json({ success: true, subscriptionId: sub._id, rzpOrderId: rzpOrder.id, amount: rzpOrder.amount, pricing });
};

// ── SUBSCRIPTION: Verify + activate ───────────────────────────
exports.verifySubscription = async (req, res) => {
  const { subscriptionId, razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;

  const expected = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || '')
    .update(`${razorpayOrderId}|${razorpayPaymentId}`)
    .digest('hex');

  if (expected !== razorpaySignature) {
    return res.status(400).json({ success: false, message: 'Payment verification failed' });
  }

  const sub = await UzhavarSubscription.findOne({ _id: subscriptionId, buyer: req.user._id });
  if (!sub) return res.status(404).json({ success: false, message: 'Subscription not found' });

  const start = new Date();
  const end   = new Date();
  end.setMonth(end.getMonth() + (sub.plan === 'quarterly' ? 3 : 1));

  sub.razorpayPaymentId = razorpayPaymentId;
  sub.paymentStatus = 'paid';
  sub.isActive  = true;
  sub.startDate = start;
  sub.endDate   = end;
  await sub.save();

  res.json({ success: true, subscription: sub });
};

// ── FARMER: Register / onboard ─────────────────────────────────
exports.registerFarmer = async (req, res) => {
  const existing = await Farmer.findOne({ phone: req.body.phone });
  if (existing) return res.status(409).json({ success: false, message: 'Phone already registered' });

  const farmer = await Farmer.create({
    ...req.body,
    user: req.user?._id || null,
    verificationStatus: 'pending',
    isActive: false,
  });

  res.status(201).json({ success: true, farmer });
};

// ── FARMER: Update product listing ────────────────────────────
exports.addFarmerProduct = async (req, res) => {
  const farmer = await getFarmerForUser(req.user);
  if (!farmer) return res.status(403).json({ success: false, message: 'Not a farmer' });
  if (farmer.verificationStatus !== 'approved') {
    return res.status(403).json({ success: false, message: 'Farmer not approved yet' });
  }

  const product = await FarmerProduct.create({
    ...req.body,
    farmer: farmer._id,
    gpsLocation: farmer.gpsLocation,
  });

  res.status(201).json({ success: true, product });
};

exports.updateFarmerProduct = async (req, res) => {
  const farmer = await getFarmerForUser(req.user);
  if (!farmer) return res.status(403).json({ success: false, message: 'Not a farmer' });

  const product = await FarmerProduct.findOneAndUpdate(
    { _id: req.params.productId, farmer: farmer._id },
    req.body,
    { new: true }
  );
  if (!product) return res.status(404).json({ success: false, message: 'Product not found' });

  res.json({ success: true, product });
};

exports.deleteFarmerProduct = async (req, res) => {
  const farmer = await getFarmerForUser(req.user);
  if (!farmer) return res.status(403).json({ success: false, message: 'Not a farmer' });

  await FarmerProduct.findOneAndUpdate(
    { _id: req.params.productId, farmer: farmer._id },
    { isActive: false }
  );

  res.json({ success: true });
};

exports.toggleAvailability = async (req, res) => {
  const existing = await getFarmerForUser(req.user);
  if (!existing) return res.status(403).json({ success: false, message: 'Not a farmer' });
  const farmer = await Farmer.findByIdAndUpdate(
    existing._id,
    [{ $set: { availableNow: { $not: '$availableNow' } } }],
    { new: true }
  );
  res.json({ success: true, availableNow: farmer.availableNow });
};

// ── FARMER: Get my orders ──────────────────────────────────────
exports.getFarmerOrders = async (req, res) => {
  const farmer = await getFarmerForUser(req.user);
  if (!farmer) return res.status(403).json({ success: false, message: 'Not a farmer' });

  const { status, page = 1 } = req.query;
  const filter = { farmer: farmer._id };
  if (status) filter.status = status;

  const orders = await UzhavarOrder.find(filter)
    .populate('buyer', 'name')
    .sort({ createdAt: -1 })
    .skip((page - 1) * 20).limit(20).lean();

  res.json({ success: true, orders });
};

// ── ADMIN: Get all farmers ────────────────────────────────────
exports.adminGetFarmers = async (req, res) => {
  const { status, page = 1 } = req.query;
  const filter = {};
  if (status) filter.verificationStatus = status;

  const [farmers, total] = await Promise.all([
    Farmer.find(filter).sort({ createdAt: -1 }).skip((page - 1) * 20).limit(20).lean(),
    Farmer.countDocuments(filter),
  ]);

  res.json({ success: true, farmers, total });
};

exports.adminApproveFarmer = async (req, res) => {
  const { farmerId } = req.params;
  const { action, reason } = req.body; // action: approve | reject | suspend

  const update = { verificationStatus: action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'suspended' };
  if (action === 'approve') update.isActive = true;
  if (reason) update.rejectionReason = reason;

  const farmer = await Farmer.findByIdAndUpdate(farmerId, update, { new: true });
  if (!farmer) return res.status(404).json({ success: false, message: 'Farmer not found' });

  res.json({ success: true, farmer });
};

exports.adminGetOrders = async (req, res) => {
  const { status, page = 1 } = req.query;
  const filter = {};
  if (status) filter.status = status;

  const [orders, total] = await Promise.all([
    UzhavarOrder.find(filter)
      .populate('buyer', 'name email')
      .populate('farmer', 'name phone')
      .sort({ createdAt: -1 })
      .skip((page - 1) * 20).limit(20).lean(),
    UzhavarOrder.countDocuments(filter),
  ]);

  res.json({ success: true, orders, total });
};

exports.adminGetSubscriptions = async (req, res) => {
  const { page = 1 } = req.query;
  const [subs, total] = await Promise.all([
    UzhavarSubscription.find({ paymentStatus: 'paid' })
      .populate('buyer', 'name email')
      .sort({ createdAt: -1 })
      .skip((page - 1) * 20).limit(20).lean(),
    UzhavarSubscription.countDocuments({ paymentStatus: 'paid' }),
  ]);

  res.json({ success: true, subscriptions: subs, total });
};

exports.adminGetStats = async (req, res) => {
  const [
    totalFarmers, pendingFarmers, totalOrders,
    activeSubscriptions, todayOrders,
  ] = await Promise.all([
    Farmer.countDocuments({ verificationStatus: 'approved' }),
    Farmer.countDocuments({ verificationStatus: 'pending' }),
    UzhavarOrder.countDocuments({ paymentStatus: 'paid' }),
    UzhavarSubscription.countDocuments({ isActive: true }),
    UzhavarOrder.countDocuments({
      createdAt: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) },
      paymentStatus: 'paid',
    }),
  ]);

  res.json({ success: true, stats: { totalFarmers, pendingFarmers, totalOrders, activeSubscriptions, todayOrders } });
};

// ── ADMIN: Create farmer directly ────────────────────────────
exports.adminCreateFarmer = async (req, res) => {
  try {
    const {
      name, phone, languagePreference,
      village, taluk, district, pincode,
      lat, lng, deliveryRadius,
      bankName, accountHolderName, accountNumber, ifsc,
      notes,
    } = req.body;

    if (!name || !phone || !district || !pincode) {
      return res.status(400).json({ success: false, message: 'Name, phone, district and pincode are required' });
    }

    const existing = await Farmer.findOne({ phone });
    if (existing) return res.status(409).json({ success: false, message: 'Phone already registered' });

    // Auto-link to an existing user account with this phone number
    const User = require('../models/User');
    const linkedUser = await User.findOne({ phone }).select('_id').lean();

    const langMap = { tamil: 'ta', english: 'en' };
    const farmerData = {
      name,
      phone,
      language: langMap[languagePreference] || 'ta',
      user: linkedUser ? linkedUser._id : null,
      address: { village: village || '', taluk: taluk || '', district, pincode },
      deliveryRadius: parseInt(deliveryRadius) || 5,
      verificationStatus: 'approved',
      isActive: true,
    };

    if (lat && lng) {
      farmerData.gpsLocation = {
        type: 'Point',
        coordinates: [parseFloat(lng), parseFloat(lat)],
      };
    }

    if (accountNumber && ifsc) {
      farmerData.bankAccount = {
        bankName:      bankName || '',
        accountName:   accountHolderName || '',
        accountNumber,
        ifsc,
      };
    }

    const farmer = await Farmer.create(farmerData);
    res.status(201).json({ success: true, farmer, linkedUser: !!linkedUser });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── CRON: Auto-cancel expired confirmations ───────────────────
exports.autoCancelExpired = async () => {
  const expired = await UzhavarOrder.find({
    status: 'farmer_accepted',
    buyerConfirmDeadline: { $lt: new Date() },
  });

  for (const order of expired) {
    // Restore stock
    for (const it of order.items) {
      await FarmerProduct.findByIdAndUpdate(it.product, { $inc: { availableQuantity: it.quantity } });
    }
    order.status = 'auto_cancelled';
    order.cancelledAt = new Date();
    order.cancelledBy = 'system';
    order.cancellationReason = 'Buyer did not confirm within 15 minutes';
    order.adminNotified = false;
    await order.save();
  }

  if (expired.length > 0) console.log(`[Uzhavar] Auto-cancelled ${expired.length} expired orders`);
};
