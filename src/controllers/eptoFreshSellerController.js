// ============================================
// EPTOFRESH SELLER CONTROLLER
// Registration, Products, Orders, Payouts
// ============================================
'use strict';
const EptoFreshSeller  = require('../models/EptoFreshSeller');
const EptoFreshProduct = require('../models/EptoFreshProduct');
const EptoFreshOrder   = require('../models/EptoFreshOrder');
const EptoFreshPayout  = require('../models/EptoFreshPayout');
const { notifyUser }   = require('../utils/pushNotification');
const { createPorterOrder, cancelPorterOrder } = require('../utils/porter');

// ══════════════════════════════════════════════════════════
// REGISTRATION
// ══════════════════════════════════════════════════════════

exports.register = async (req, res) => {
  const existing = await EptoFreshSeller.findOne({ user: req.user._id });
  if (existing) {
    return res.status(400).json({ success: false, message: 'You already have an EptoFresh seller account', seller: existing });
  }

  const {
    shopName, ownerName,
    contactPhone, contactEmail,
    address,
    locationLat, locationLng,
    categories,
    panNumber, aadhaarNumber, gstNumber, fssaiNumber,
    openingTime, closingTime, deliveryRadius,
  } = req.body;

  const sellerCode = 'EPF' + Date.now().toString(36).toUpperCase();

  const seller = new EptoFreshSeller({
    user:        req.user._id,
    shopName,
    ownerName,
    sellerCode,
    contact:     { phone: contactPhone, email: contactEmail },
    address,
    location:    { type: 'Point', coordinates: [parseFloat(locationLng), parseFloat(locationLat)] },
    categories:  Array.isArray(categories) ? categories : [categories],
    kyc: {
      panNumber:     panNumber?.toUpperCase(),
      aadhaarNumber,
      gstNumber,
      fssaiNumber,
      meatLicenseUrl: req.files?.meatLicense?.[0]?.path,
      aadhaarUrl:     req.files?.aadhaar?.[0]?.path,
      panUrl:         req.files?.pan?.[0]?.path,
      fssaiUrl:       req.files?.fssai?.[0]?.path,
    },
    openingTime,
    closingTime,
    deliveryRadius: deliveryRadius || 10,
    status: 'pending_review',
  });

  await seller.save();

  // Notify admin
  notifyUser(null, {
    title: '🏪 New EptoFresh Seller Registration',
    body:  `${shopName} (${ownerName}) — pending review`,
    url:   '/admin/eptofresh/sellers',
  }, { adminOnly: true }).catch(() => {});

  res.status(201).json({
    success: true,
    message: 'Registration submitted successfully. Admin will review within 24 hours.',
    seller: { _id: seller._id, shopName, sellerCode, status: seller.status },
  });
};

exports.getMyProfile = async (req, res) => {
  const seller = await EptoFreshSeller.findOne({ user: req.user._id }).lean();
  if (!seller) return res.status(404).json({ success: false, message: 'Seller account not found' });
  res.json({ success: true, seller });
};

exports.updateProfile = async (req, res) => {
  const seller = await EptoFreshSeller.findOne({ user: req.user._id });
  if (!seller) return res.status(404).json({ success: false, message: 'Seller account not found' });

  const { shopName, ownerName, address, openingTime, closingTime, isOpen, categories, deliveryRadius, locationLat, locationLng } = req.body;

  if (shopName)   seller.shopName   = shopName;
  if (ownerName)  seller.ownerName  = ownerName;
  if (address)    seller.address    = { ...seller.address, ...address };
  if (openingTime)seller.openingTime= openingTime;
  if (closingTime)seller.closingTime= closingTime;
  if (isOpen !== undefined) seller.isOpen = isOpen;
  if (categories) seller.categories  = categories;
  if (deliveryRadius) seller.deliveryRadius = deliveryRadius;
  if (locationLat && locationLng) {
    seller.location = { type: 'Point', coordinates: [parseFloat(locationLng), parseFloat(locationLat)] };
  }
  if (req.files?.shopImage?.[0]?.path) seller.shopImage = req.files.shopImage[0].path;
  if (req.files?.bannerImage?.[0]?.path) seller.bannerImage = req.files.bannerImage[0].path;

  await seller.save();
  res.json({ success: true, seller });
};

// ══════════════════════════════════════════════════════════
// PRODUCTS
// ══════════════════════════════════════════════════════════

exports.getProducts = async (req, res) => {
  const seller = req.epfSeller;
  const products = await EptoFreshProduct.find({ seller: seller._id }).sort({ createdAt: -1 }).lean();
  res.json({ success: true, products });
};

exports.addProduct = async (req, res) => {
  const seller = req.epfSeller;
  if (seller.status !== 'approved') {
    return res.status(403).json({ success: false, message: 'Seller account must be approved to add products' });
  }

  const {
    name, nameLocal, category, subCategory, description,
    cutTypes, variants, basePrice, unit, hsnCode, gstRate,
    tags, stock,
  } = req.body;

  const images = (req.files || []).map((f, idx) => ({
    url: f.path, publicId: f.filename, isPrimary: idx === 0,
  }));

  const product = new EptoFreshProduct({
    seller:      seller._id,
    name, nameLocal, category, subCategory, description,
    cutTypes:    Array.isArray(cutTypes) ? cutTypes : JSON.parse(cutTypes || '[]'),
    variants:    Array.isArray(variants) ? variants : JSON.parse(variants || '[]'),
    basePrice:   parseFloat(basePrice) || 0,
    unit:        unit || 'kg',
    stock:       parseFloat(stock) || 0,
    hsnCode:     hsnCode || '0201',
    gstRate:     parseFloat(gstRate) || 0,
    tags:        tags ? (typeof tags === 'string' ? JSON.parse(tags) : tags) : {},
    images,
    status:      'pending_approval',  // admin must approve
  });

  await product.save();

  res.status(201).json({
    success: true,
    message: 'Product submitted for admin approval.',
    product,
  });
};

exports.updateProduct = async (req, res) => {
  const seller = req.epfSeller;
  const product = await EptoFreshProduct.findOne({ _id: req.params.productId, seller: seller._id });
  if (!product) return res.status(404).json({ success: false, message: 'Product not found' });

  const fields = ['name', 'nameLocal', 'description', 'cutTypes', 'subCategory', 'hsnCode', 'gstRate'];
  fields.forEach(f => { if (req.body[f] !== undefined) product[f] = req.body[f]; });

  if (req.body.variants) {
    product.variants = Array.isArray(req.body.variants) ? req.body.variants : JSON.parse(req.body.variants);
  }
  if (req.body.tags) {
    product.tags = typeof req.body.tags === 'string' ? JSON.parse(req.body.tags) : req.body.tags;
  }

  // Re-submit for approval if name/category changed
  if (req.body.name || req.body.category) product.status = 'pending_approval';

  await product.save();
  res.json({ success: true, product });
};

/**
 * PATCH /eptofresh/seller/products/:productId/daily
 * Update daily stock and pricing
 */
exports.updateDailyStock = async (req, res) => {
  const seller = req.epfSeller;
  const product = await EptoFreshProduct.findOne({ _id: req.params.productId, seller: seller._id });
  if (!product) return res.status(404).json({ success: false, message: 'Product not found' });

  if (req.body.stock !== undefined) {
    product.stock     = parseFloat(req.body.stock);
    product.isInStock = product.stock > 0;
  }
  if (req.body.todayPrice !== undefined) {
    product.todayPrice      = parseFloat(req.body.todayPrice);
    product.priceUpdatedAt  = new Date();
  }
  if (req.body.variants) {
    product.variants = Array.isArray(req.body.variants) ? req.body.variants : JSON.parse(req.body.variants);
  }
  if (req.body.freshToday !== undefined) product.tags.freshToday = req.body.freshToday;

  await product.save();
  res.json({ success: true, message: 'Stock and pricing updated', product });
};

exports.deleteProduct = async (req, res) => {
  const seller = req.epfSeller;
  await EptoFreshProduct.findOneAndUpdate(
    { _id: req.params.productId, seller: seller._id },
    { status: 'inactive' }
  );
  res.json({ success: true, message: 'Product removed' });
};

// ══════════════════════════════════════════════════════════
// ORDERS (Seller view — private customer info masked)
// ══════════════════════════════════════════════════════════

exports.getOrders = async (req, res) => {
  const seller = req.epfSeller;
  const { status, page = 1, limit = 20 } = req.query;
  const query = { seller: seller._id };
  if (status) query.orderStatus = status;

  const orders = await EptoFreshOrder.find(query)
    // Seller NEVER sees: buyer name, phone, exact address
    .select('orderId orderStatus items pricing.total pricing.sellerReceives createdAt distanceKm porter.status porter.driverName statusHistory packedPhotos')
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(parseInt(limit))
    .lean();

  const total = await EptoFreshOrder.countDocuments(query);
  res.json({ success: true, orders, total });
};

exports.getOrderDetail = async (req, res) => {
  const seller = req.epfSeller;
  const order = await EptoFreshOrder.findOne({ _id: req.params.orderId, seller: seller._id })
    .select('-shippingAddress -buyer -buyerLocation -deliveryOtp -porter.driverPhone')
    .populate('items.product', 'name images')
    .lean();

  if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
  res.json({ success: true, order });
};

/**
 * POST /eptofresh/seller/orders/:orderId/accept
 */
exports.acceptOrder = async (req, res) => {
  const seller = req.epfSeller;
  const order = await EptoFreshOrder.findOne({ _id: req.params.orderId, seller: seller._id });
  if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
  if (order.orderStatus !== 'placed') {
    return res.status(400).json({ success: false, message: 'Order already actioned' });
  }

  order.orderStatus = 'accepted';
  order.sellerAction = { accepted: true, acceptedAt: new Date() };
  order.statusHistory.push({ status: 'accepted', updatedBy: 'seller' });
  await order.save();

  // Notify customer
  notifyUser(order.buyer, {
    title: '✅ Order Accepted!',
    body:  `Your EptoFresh order #${order.orderId} has been accepted and is being prepared.`,
    url:   `/eptofresh/orders/${order._id}`,
  }).catch(() => {});

  res.json({ success: true, message: 'Order accepted' });
};

/**
 * POST /eptofresh/seller/orders/:orderId/reject
 */
exports.rejectOrder = async (req, res) => {
  const seller = req.epfSeller;
  const order = await EptoFreshOrder.findOne({ _id: req.params.orderId, seller: seller._id });
  if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
  if (order.orderStatus !== 'placed') {
    return res.status(400).json({ success: false, message: 'Order already actioned' });
  }

  order.orderStatus = 'rejected';
  order.sellerAction = { accepted: false, rejectedAt: new Date(), rejectReason: req.body.reason };
  order.cancelReason = req.body.reason || 'Rejected by seller';
  order.cancelledBy  = 'seller';
  order.statusHistory.push({ status: 'rejected', updatedBy: 'seller', note: order.cancelReason });
  if (order.paymentStatus === 'paid') {
    order.refund = { status: 'initiated', amount: order.pricing.total, reason: order.cancelReason, initiatedAt: new Date() };
  }
  await order.save();

  notifyUser(order.buyer, {
    title: '❌ Order Rejected',
    body:  `Your EptoFresh order #${order.orderId} was rejected. Refund will be processed shortly.`,
    url:   `/eptofresh/orders/${order._id}`,
  }).catch(() => {});

  res.json({ success: true, message: 'Order rejected' });
};

/**
 * POST /eptofresh/seller/orders/:orderId/packed-photos
 * Seller uploads packed product photos for admin verification
 */
exports.uploadPackedPhotos = async (req, res) => {
  const seller = req.epfSeller;
  const order = await EptoFreshOrder.findOne({ _id: req.params.orderId, seller: seller._id });
  if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
  if (!['accepted', 'preparing'].includes(order.orderStatus)) {
    return res.status(400).json({ success: false, message: 'Cannot upload photos at this stage' });
  }

  const photos = (req.files || []).map(f => ({
    url: f.path, publicId: f.filename, approved: false,
  }));

  if (!photos.length) return res.status(400).json({ success: false, message: 'No photos uploaded' });

  order.packedPhotos = [...(order.packedPhotos || []), ...photos];
  order.orderStatus  = 'packed';
  order.statusHistory.push({ status: 'packed', updatedBy: 'seller' });
  await order.save();

  // Notify admin
  notifyUser(null, {
    title: '📦 Packed Photos Uploaded',
    body:  `Order #${order.orderId} — please verify packed product photos.`,
    url:   `/admin/eptofresh/orders/${order._id}`,
  }, { adminOnly: true }).catch(() => {});

  res.json({ success: true, message: 'Photos uploaded. Awaiting admin approval.', photos });
};

// ══════════════════════════════════════════════════════════
// PAYOUTS (Seller view)
// ══════════════════════════════════════════════════════════

exports.getPayouts = async (req, res) => {
  const seller = req.epfSeller;
  const payouts = await EptoFreshPayout.find({ seller: seller._id })
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();

  const summary = {
    totalEarnings: seller.totalEarnings || 0,
    pendingPayout: seller.pendingPayout || 0,
    totalSettled:  seller.totalSettled  || 0,
  };

  res.json({ success: true, payouts, summary });
};

// ══════════════════════════════════════════════════════════
// DASHBOARD
// ══════════════════════════════════════════════════════════

exports.getDashboard = async (req, res) => {
  const seller = req.epfSeller;

  const [totalOrders, pendingOrders, todayOrders, totalProducts] = await Promise.all([
    EptoFreshOrder.countDocuments({ seller: seller._id, orderStatus: { $nin: ['payment_pending'] } }),
    EptoFreshOrder.countDocuments({ seller: seller._id, orderStatus: { $in: ['placed', 'accepted', 'preparing', 'packed'] } }),
    EptoFreshOrder.countDocuments({
      seller: seller._id,
      createdAt: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) },
    }),
    EptoFreshProduct.countDocuments({ seller: seller._id, status: 'approved' }),
  ]);

  const recentOrders = await EptoFreshOrder.find({ seller: seller._id })
    .select('orderId orderStatus pricing.total createdAt')
    .sort({ createdAt: -1 })
    .limit(5)
    .lean();

  res.json({
    success: true,
    stats: {
      totalOrders, pendingOrders, todayOrders, totalProducts,
      rating: seller.rating,
      pendingPayout: seller.pendingPayout,
    },
    recentOrders,
    seller: {
      shopName: seller.shopName,
      status:   seller.status,
      isOpen:   seller.isOpen,
      badges:   seller.badges,
    },
  });
};
