// ============================================
// EPTOFRESH ADMIN CONTROLLER
// Full control: sellers, products, orders, payouts, analytics
// ============================================
'use strict';
const EptoFreshSeller  = require('../models/EptoFreshSeller');
const EptoFreshProduct = require('../models/EptoFreshProduct');
const EptoFreshOrder   = require('../models/EptoFreshOrder');
const EptoFreshPayout  = require('../models/EptoFreshPayout');
const EptoFreshCoupon  = require('../models/EptoFreshCoupon');
const User             = require('../models/User');
const EptoFreshWallet         = require('../models/EptoFreshWallet');
const EptoFreshDeliveryConfig = require('../models/EptoFreshDeliveryConfig');
const { notifyUser }   = require('../utils/pushNotification');
const { createPorterOrder } = require('../utils/porter');

// ══════════════════════════════════════════════════════════
// DASHBOARD
// ══════════════════════════════════════════════════════════

exports.getDashboard = async (req, res) => {
  const today = new Date(new Date().setHours(0, 0, 0, 0));

  const [
    totalSellers, pendingSellers, activeSellers,
    totalOrders, todayOrders, pendingPackedApprovals,
    totalRevenue, pendingPayouts,
  ] = await Promise.all([
    EptoFreshSeller.countDocuments(),
    EptoFreshSeller.countDocuments({ status: 'pending_review' }),
    EptoFreshSeller.countDocuments({ status: 'approved', isActive: true }),
    EptoFreshOrder.countDocuments({ orderStatus: { $nin: ['payment_pending'] } }),
    EptoFreshOrder.countDocuments({ createdAt: { $gte: today }, orderStatus: { $nin: ['payment_pending'] } }),
    EptoFreshOrder.countDocuments({ orderStatus: 'packed' }),
    EptoFreshOrder.aggregate([
      { $match: { paymentStatus: 'paid' } },
      { $group: { _id: null, total: { $sum: '$pricing.total' } } },
    ]).then(r => r[0]?.total || 0),
    EptoFreshPayout.aggregate([
      { $match: { status: 'pending' } },
      { $group: { _id: null, total: { $sum: '$sellerReceives' } } },
    ]).then(r => r[0]?.total || 0),
  ]);

  const recentOrders = await EptoFreshOrder.find({ orderStatus: { $nin: ['payment_pending'] } })
    .select('orderId orderStatus pricing.total createdAt seller')
    .populate('seller', 'shopName')
    .sort({ createdAt: -1 })
    .limit(10)
    .lean();

  const pendingApprovalProducts = await EptoFreshProduct.countDocuments({ status: 'pending_approval' });

  res.json({
    success: true,
    stats: {
      totalSellers, pendingSellers, activeSellers,
      totalOrders, todayOrders, pendingPackedApprovals,
      totalRevenue, pendingPayouts, pendingApprovalProducts,
    },
    recentOrders,
  });
};

// ══════════════════════════════════════════════════════════
// SELLER MANAGEMENT
// ══════════════════════════════════════════════════════════

exports.getSellers = async (req, res) => {
  const { status, page = 1, limit = 20 } = req.query;
  const query = status ? { status } : {};

  const sellers = await EptoFreshSeller.find(query)
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(parseInt(limit))
    .lean();

  const total = await EptoFreshSeller.countDocuments(query);
  res.json({ success: true, sellers, total });
};

exports.getSellerDetail = async (req, res) => {
  const seller = await EptoFreshSeller.findById(req.params.sellerId).lean();
  if (!seller) return res.status(404).json({ success: false, message: 'Seller not found' });

  const [orderCount, productCount, recentOrders] = await Promise.all([
    EptoFreshOrder.countDocuments({ seller: seller._id }),
    EptoFreshProduct.countDocuments({ seller: seller._id }),
    EptoFreshOrder.find({ seller: seller._id }).select('orderId orderStatus pricing.total createdAt').sort({ createdAt: -1 }).limit(5).lean(),
  ]);

  res.json({ success: true, seller, orderCount, productCount, recentOrders });
};

exports.approveSeller = async (req, res) => {
  const seller = await EptoFreshSeller.findById(req.params.sellerId);
  if (!seller) return res.status(404).json({ success: false, message: 'Seller not found' });

  seller.status     = 'approved';
  seller.approvedBy = req.user._id;
  seller.approvedAt = new Date();
  await seller.save();

  notifyUser(seller.user, {
    title: '🎉 EptoFresh Seller Approved!',
    body:  `Your shop "${seller.shopName}" is now live on EptoFresh. Start adding products!`,
    url:   '/eptofresh/seller/dashboard',
  }).catch(() => {});

  res.json({ success: true, message: 'Seller approved' });
};

exports.rejectSeller = async (req, res) => {
  const seller = await EptoFreshSeller.findById(req.params.sellerId);
  if (!seller) return res.status(404).json({ success: false, message: 'Seller not found' });

  seller.status         = 'rejected';
  seller.rejectedReason = req.body.reason || 'Does not meet requirements';
  await seller.save();

  notifyUser(seller.user, {
    title: 'EptoFresh Application Update',
    body:  `Your application was not approved. Reason: ${seller.rejectedReason}`,
  }).catch(() => {});

  res.json({ success: true, message: 'Seller rejected' });
};

exports.suspendSeller = async (req, res) => {
  const seller = await EptoFreshSeller.findById(req.params.sellerId);
  if (!seller) return res.status(404).json({ success: false, message: 'Seller not found' });

  seller.status        = 'suspended';
  seller.suspendReason = req.body.reason;
  seller.isActive      = false;
  await seller.save();

  res.json({ success: true, message: 'Seller suspended' });
};

exports.adjustCommission = async (req, res) => {
  const { commissionRate } = req.body;
  const seller = await EptoFreshSeller.findByIdAndUpdate(
    req.params.sellerId,
    { commissionRate: parseFloat(commissionRate) },
    { new: true }
  );
  res.json({ success: true, seller });
};

// ══════════════════════════════════════════════════════════
// PRODUCT APPROVALS
// ══════════════════════════════════════════════════════════

exports.getPendingProducts = async (req, res) => {
  const products = await EptoFreshProduct.find({ status: 'pending_approval' })
    .populate('seller', 'shopName')
    .sort({ createdAt: 1 })
    .lean();
  res.json({ success: true, products });
};

exports.approveProduct = async (req, res) => {
  const product = await EptoFreshProduct.findByIdAndUpdate(
    req.params.productId,
    { status: 'approved', approvedBy: req.user._id, approvedAt: new Date() },
    { new: true }
  ).populate('seller', 'user shopName');

  if (!product) return res.status(404).json({ success: false, message: 'Product not found' });

  notifyUser(product.seller?.user, {
    title: '✅ Product Approved',
    body:  `"${product.name}" is now live on EptoFresh.`,
    url:   '/eptofresh/seller/products',
  }).catch(() => {});

  res.json({ success: true, product });
};

exports.rejectProduct = async (req, res) => {
  const product = await EptoFreshProduct.findByIdAndUpdate(
    req.params.productId,
    { status: 'rejected', rejectedReason: req.body.reason || 'Does not meet quality standards' },
    { new: true }
  ).populate('seller', 'user');

  if (!product) return res.status(404).json({ success: false, message: 'Product not found' });

  notifyUser(product.seller?.user, {
    title: 'Product Not Approved',
    body:  `"${product.name}" was not approved. Reason: ${product.rejectedReason}`,
    url:   '/eptofresh/seller/products',
  }).catch(() => {});

  res.json({ success: true, product });
};

// ══════════════════════════════════════════════════════════
// ORDER MANAGEMENT
// ══════════════════════════════════════════════════════════

exports.getOrders = async (req, res) => {
  const { status, sellerId, page = 1, limit = 30 } = req.query;
  const query = {};
  if (status)   query.orderStatus = status;
  if (sellerId) query.seller = sellerId;
  // Exclude payment_pending by default
  if (!status) query.orderStatus = { $ne: 'payment_pending' };

  const orders = await EptoFreshOrder.find(query)
    .populate('seller', 'shopName')
    .select('orderId orderStatus pricing buyer shippingAddress.city shippingAddress.pincode createdAt distanceKm porter.status')
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(parseInt(limit))
    .lean();

  const total = await EptoFreshOrder.countDocuments(query);
  res.json({ success: true, orders, total });
};

exports.getOrderDetail = async (req, res) => {
  const order = await EptoFreshOrder.findById(req.params.orderId)
    .populate('seller', 'shopName contact address location')
    .populate('buyer', 'name email phone')
    .populate('items.product', 'name images')
    .lean();

  if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
  res.json({ success: true, order });
};

/**
 * POST /admin/eptofresh/orders/:orderId/approve-packed
 * Admin verifies packed product photos and triggers Porter delivery
 */
exports.approvePackedPhotos = async (req, res) => {
  const order = await EptoFreshOrder.findById(req.params.orderId)
    .populate('seller', 'shopName contact address location');

  if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
  if (order.orderStatus !== 'packed') {
    return res.status(400).json({ success: false, message: 'Order is not in packed status' });
  }

  // Mark photos approved
  order.packedPhotos.forEach(p => { p.approved = true; p.approvedBy = req.user._id; p.approvedAt = new Date(); });
  order.orderStatus = 'admin_approved';
  order.statusHistory.push({ status: 'admin_approved', updatedBy: 'admin', note: req.body.note });
  await order.save();

  // Create Porter delivery
  try {
    const porterResult = await createPorterOrder(order, order.seller);
    if (porterResult) {
      order.porter = {
        ...order.porter,
        requestId:        porterResult.order_id || porterResult.request_id,
        orderId:          porterResult.order_id,
        status:           'requested',
        estimatedPickup:  porterResult.estimated_pickup_time ? new Date(porterResult.estimated_pickup_time) : null,
        estimatedDelivery:porterResult.estimated_delivery_time ? new Date(porterResult.estimated_delivery_time) : null,
        fareEstimate:     porterResult.fare_details?.estimated_fare_minor_units
          ? porterResult.fare_details.estimated_fare_minor_units / 100 : null,
      };
      order.orderStatus = 'porter_assigned';
      order.statusHistory.push({ status: 'porter_assigned', updatedBy: 'system' });
      await order.save();
    }
  } catch (err) {
    console.error('[Admin] Porter order creation failed:', err.message);
    // Don't fail the API — admin sees the order as admin_approved and can retry
  }

  // Notify customer
  notifyUser(order.buyer, {
    title: '🚗 Driver Assigned!',
    body:  `Your EptoFresh order #${order.orderId} has been picked up by a driver.`,
    url:   `/eptofresh/orders/${order._id}/tracking`,
  }).catch(() => {});

  // Notify seller
  notifyUser(order.seller.user, {
    title: '🚗 Driver On The Way',
    body:  `Order #${order.orderId} — driver assigned for pickup.`,
  }).catch(() => {});

  res.json({ success: true, message: 'Photos approved and delivery triggered.', order });
};

exports.rejectPackedPhotos = async (req, res) => {
  const order = await EptoFreshOrder.findById(req.params.orderId);
  if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

  order.orderStatus = 'accepted'; // Revert to accepted — seller must re-pack
  order.packedPhotos = [];
  order.statusHistory.push({ status: 'accepted', updatedBy: 'admin', note: `Photos rejected: ${req.body.reason}` });
  await order.save();

  notifyUser(order.seller.user, {
    title: '⚠️ Packed Photos Rejected',
    body:  `Order #${order.orderId} — ${req.body.reason || 'Please re-pack and upload photos.'}`,
    url:   `/eptofresh/seller/orders/${order._id}`,
  }).catch(() => {});

  res.json({ success: true, message: 'Photos rejected, seller notified' });
};

/**
 * POST /admin/eptofresh/orders/:orderId/override-delivery
 * Override delivery charge
 */
exports.overrideDelivery = async (req, res) => {
  const { deliveryCharge, reason } = req.body;
  const order = await EptoFreshOrder.findById(req.params.orderId);
  if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

  order.pricing.deliveryCharge = parseFloat(deliveryCharge);
  order.pricing.total = order.pricing.subtotal - (order.pricing.couponDiscount || 0) +
    parseFloat(deliveryCharge) - (order.pricing.walletApplied || 0);
  order.adminNotes = (order.adminNotes || '') + `\nDelivery charge overridden: ₹${deliveryCharge} — ${reason}`;
  await order.save();

  res.json({ success: true, order });
};

/**
 * POST /admin/eptofresh/orders/:orderId/cancel
 */
exports.cancelOrder = async (req, res) => {
  const order = await EptoFreshOrder.findById(req.params.orderId);
  if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

  order.orderStatus  = 'cancelled';
  order.cancelReason = req.body.reason;
  order.cancelledBy  = 'admin';
  order.cancelledAt  = new Date();
  if (order.paymentStatus === 'paid') {
    order.refund = { status: 'initiated', amount: order.pricing.total, reason: req.body.reason, initiatedAt: new Date() };
  }
  order.statusHistory.push({ status: 'cancelled', updatedBy: 'admin' });
  await order.save();

  notifyUser(order.buyer, {
    title: 'Order Cancelled',
    body:  `Order #${order.orderId} has been cancelled. Refund will be processed.`,
    url:   `/eptofresh/orders/${order._id}`,
  }).catch(() => {});

  res.json({ success: true, message: 'Order cancelled' });
};

// ══════════════════════════════════════════════════════════
// PORTER WEBHOOK
// ══════════════════════════════════════════════════════════

exports.porterWebhook = async (req, res) => {
  // Porter sends events to /api/eptofresh/porter/webhook
  const event = req.body;
  console.log('[Porter Webhook]', event?.event_type, event?.order_id);

  if (!event?.order_id) return res.status(200).json({ received: true });

  const order = await EptoFreshOrder.findOne({ 'porter.orderId': event.order_id });
  if (!order) return res.status(200).json({ received: true }); // Not our order

  // Map Porter status → our status
  let newStatus = null;
  const porterStatus = event.event_type?.toLowerCase();

  if (porterStatus?.includes('driver_assigned') || porterStatus?.includes('partner_assigned')) {
    newStatus = 'porter_assigned';
    order.porter.driverName  = event.driver?.name;
    order.porter.driverPhone = event.driver?.phone; // PRIVATE — admin only
    order.porter.driverVehicle = event.driver?.vehicle;
  } else if (porterStatus?.includes('order_picked_up') || porterStatus?.includes('pickup_done')) {
    newStatus = 'picked_up';
  } else if (porterStatus?.includes('out_for_delivery') || porterStatus?.includes('en_route')) {
    newStatus = 'out_for_delivery';
  } else if (porterStatus?.includes('delivered')) {
    newStatus = 'out_for_delivery'; // OTP still needs to be verified
  } else if (porterStatus?.includes('cancelled')) {
    order.porter.status = 'cancelled';
  }

  // Update driver coordinates if present
  if (event.driver?.location?.lat) {
    order.porter.driverLat = event.driver.location.lat;
    order.porter.driverLng = event.driver.location.lng;
  }

  order.porter.status = event.event_type;
  order.porter.webhookEvents = [...(order.porter.webhookEvents || []), {
    event: event.event_type, timestamp: new Date(), data: event,
  }];

  if (newStatus && newStatus !== order.orderStatus) {
    order.orderStatus = newStatus;
    order.statusHistory.push({ status: newStatus, updatedBy: 'porter' });

    // Notify customer on key updates
    if (newStatus === 'picked_up' || newStatus === 'out_for_delivery') {
      notifyUser(order.buyer, {
        title: newStatus === 'picked_up' ? '📦 Order Picked Up!' : '🛵 Driver On The Way!',
        body:  `Your EptoFresh order #${order.orderId} is en route. Check your OTP.`,
        url:   `/eptofresh/orders/${order._id}/tracking`,
      }).catch(() => {});
    }
  }

  await order.save();
  res.status(200).json({ received: true });
};

// ══════════════════════════════════════════════════════════
// PAYOUTS
// ══════════════════════════════════════════════════════════

exports.getPayouts = async (req, res) => {
  const { status, sellerId, page = 1, limit = 30 } = req.query;
  const query = {};
  if (status)   query.status = status;
  if (sellerId) query.seller = sellerId;

  const payouts = await EptoFreshPayout.find(query)
    .populate('seller', 'shopName bankDetails')
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(parseInt(limit))
    .lean();

  const total = await EptoFreshPayout.countDocuments(query);
  res.json({ success: true, payouts, total });
};

exports.settlePayout = async (req, res) => {
  const { payoutIds, transferRef, transferMode } = req.body;

  await EptoFreshPayout.updateMany(
    { _id: { $in: payoutIds }, status: 'pending' },
    {
      status:       'settled',
      settledAt:    new Date(),
      transferRef,
      transferMode: transferMode || 'bank',
      processedBy:  req.user._id,
    }
  );

  // Update seller balances
  const payouts = await EptoFreshPayout.find({ _id: { $in: payoutIds } }).lean();
  const sellerTotals = {};
  payouts.forEach(p => {
    sellerTotals[p.seller] = (sellerTotals[p.seller] || 0) + p.sellerReceives;
  });

  for (const [sellerId, amount] of Object.entries(sellerTotals)) {
    await EptoFreshSeller.findByIdAndUpdate(sellerId, {
      $inc: { pendingPayout: -amount, totalSettled: amount },
    });
  }

  res.json({ success: true, message: `${payoutIds.length} payout(s) settled` });
};

// ══════════════════════════════════════════════════════════
// REFUNDS
// ══════════════════════════════════════════════════════════

exports.processRefund = async (req, res) => {
  const { orderId, amount, note } = req.body;
  const order = await EptoFreshOrder.findById(orderId);
  if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

  // Credit wallet
  const refundAmount = parseFloat(amount) || order.pricing.total;
  let wallet = await EptoFreshWallet.findOne({ user: order.buyer });
  if (!wallet) wallet = new EptoFreshWallet({ user: order.buyer, balance: 0 });

  wallet.balance += refundAmount;
  wallet.transactions.push({
    type: 'credit', amount: refundAmount,
    description: `Refund for order #${order.orderId}`,
    order: order._id, balance: wallet.balance,
  });
  await wallet.save();

  order.refund = { status: 'completed', amount: refundAmount, completedAt: new Date(), reason: note };
  await order.save();

  notifyUser(order.buyer, {
    title: '💰 Refund Credited',
    body:  `₹${refundAmount} has been added to your EptoFresh wallet.`,
    url:   '/eptofresh/wallet',
  }).catch(() => {});

  res.json({ success: true, message: `₹${refundAmount} refunded to customer wallet` });
};

// ══════════════════════════════════════════════════════════
// COUPONS
// ══════════════════════════════════════════════════════════

exports.createCoupon = async (req, res) => {
  const {
    code, description, discountType, discountValue, maxDiscount,
    minOrderValue, maxUsage, validFrom, validTo,
    platformRestriction, assignedSellerId, assignedSellerName,
  } = req.body;
  const coupon = new EptoFreshCoupon({
    code, description, discountType, discountValue, maxDiscount,
    minOrderValue, maxUsage, validFrom, validTo,
    isActive:           true,
    requestStatus:      'admin_created',
    platformRestriction: platformRestriction || 'all',
    assignedSellerId:   assignedSellerId   || null,
    assignedSellerName: assignedSellerName || null,
    createdBy:          req.user._id,
  });
  await coupon.save();
  res.status(201).json({ success: true, coupon });
};

exports.getCoupons = async (req, res) => {
  const coupons = await EptoFreshCoupon.find().sort({ createdAt: -1 }).lean();
  res.json({ success: true, coupons });
};

exports.toggleCoupon = async (req, res) => {
  const coupon = await EptoFreshCoupon.findById(req.params.couponId);
  if (!coupon) return res.status(404).json({ success: false, message: 'Coupon not found' });
  coupon.isActive = !coupon.isActive;
  await coupon.save();
  res.json({ success: true, coupon });
};

exports.getPromoRequests = async (req, res) => {
  const { status = 'pending' } = req.query;
  const coupons = await EptoFreshCoupon.find({ requestStatus: status })
    .populate('requestedBy', 'shopName sellerCode')
    .sort({ createdAt: -1 })
    .lean();
  res.json({ success: true, coupons });
};

exports.approvePromoRequest = async (req, res) => {
  const coupon = await EptoFreshCoupon.findById(req.params.couponId);
  if (!coupon) return res.status(404).json({ success: false, message: 'Coupon not found' });
  if (coupon.requestStatus !== 'pending') return res.status(400).json({ success: false, message: 'Request already processed' });
  coupon.requestStatus = 'approved';
  coupon.isActive = true;
  coupon.createdBy = req.user._id;
  await coupon.save();
  res.json({ success: true, coupon });
};

exports.rejectPromoRequest = async (req, res) => {
  const coupon = await EptoFreshCoupon.findById(req.params.couponId);
  if (!coupon) return res.status(404).json({ success: false, message: 'Coupon not found' });
  if (coupon.requestStatus !== 'pending') return res.status(400).json({ success: false, message: 'Request already processed' });
  coupon.requestStatus = 'rejected';
  coupon.isActive = false;
  coupon.rejectReason = req.body.reason || '';
  await coupon.save();
  res.json({ success: true, coupon });
};

// ══════════════════════════════════════════════════════════
// ANALYTICS
// ══════════════════════════════════════════════════════════

exports.getAnalytics = async (req, res) => {
  const { period = '7d' } = req.query;
  const days = period === '30d' ? 30 : period === '90d' ? 90 : 7;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const [ordersByCategory, revenueByDay, topSellers, cancellationRate] = await Promise.all([
    EptoFreshOrder.aggregate([
      { $match: { createdAt: { $gte: since }, paymentStatus: 'paid' } },
      { $unwind: '$items' },
      { $group: { _id: '$items.category', count: { $sum: 1 }, revenue: { $sum: '$items.totalPrice' } } },
      { $sort: { revenue: -1 } },
    ]),
    EptoFreshOrder.aggregate([
      { $match: { createdAt: { $gte: since }, paymentStatus: 'paid' } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, revenue: { $sum: '$pricing.total' }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    EptoFreshOrder.aggregate([
      { $match: { createdAt: { $gte: since }, paymentStatus: 'paid' } },
      { $group: { _id: '$seller', revenue: { $sum: '$pricing.total' }, orders: { $sum: 1 } } },
      { $sort: { revenue: -1 } },
      { $limit: 10 },
      { $lookup: { from: 'eptofreshsellers', localField: '_id', foreignField: '_id', as: 'seller' } },
      { $unwind: '$seller' },
      { $project: { 'seller.shopName': 1, revenue: 1, orders: 1 } },
    ]),
    EptoFreshOrder.aggregate([
      { $match: { createdAt: { $gte: since } } },
      { $group: { _id: null, total: { $sum: 1 }, cancelled: { $sum: { $cond: [{ $eq: ['$orderStatus', 'cancelled'] }, 1, 0] } } } },
    ]).then(r => r[0] ? ((r[0].cancelled / r[0].total) * 100).toFixed(1) : 0),
  ]);

  res.json({ success: true, analytics: { ordersByCategory, revenueByDay, topSellers, cancellationRate, period } });
};

// ══════════════════════════════════════════════════════════
// DELIVERY CONFIG
// ══════════════════════════════════════════════════════════

exports.getDeliveryConfig = async (req, res) => {
  let config = await EptoFreshDeliveryConfig.findOne({ key: 'global' }).lean();
  if (!config) {
    // Return defaults if not configured yet
    config = new EptoFreshDeliveryConfig().toObject();
  }
  res.json({ success: true, config });
};

exports.createSeller = async (req, res) => {
  try {
    const {
      shopName, ownerName, phone, email,
      addressLine1, addressLine2, city, state, pincode, landmark,
      lat, lng,
      categories,
      fssaiNumber, panNumber, gstNumber,
    } = req.body;

    if (!shopName || !ownerName || !phone) {
      return res.status(400).json({ success: false, message: 'shopName, ownerName, and phone are required' });
    }

    // Look up the user account by phone so the seller record is linked —
    // this is what protectEpfSeller uses to identify the seller after login.
    const phoneDigits = String(phone).replace(/\D/g, '').slice(-10);
    const linkedUser  = await User.findOne({ phone: { $regex: phoneDigits + '$' } }).lean();

    const seller = new EptoFreshSeller({
      shopName,
      ownerName,
      user: linkedUser?._id || undefined,   // ← critical: links seller to their login
      contact: { phone, email },
      address: {
        addressLine1,
        addressLine2,
        city:     city     || 'Chennai',
        state:    state    || 'Tamil Nadu',
        pincode,
        landmark,
      },
      location: {
        type: 'Point',
        coordinates: [parseFloat(lng) || 0, parseFloat(lat) || 0],
      },
      categories: Array.isArray(categories) ? categories : [],
      kyc: { fssaiNumber, panNumber, gstNumber },
      status:     'approved',
      approvedBy: req.user._id,
      approvedAt: new Date(),
    });

    await seller.save();
    res.json({ success: true, seller, userLinked: !!linkedUser });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
};

/**
 * POST /admin/sellers/:sellerId/link-user
 * Links an existing seller record to a user account by phone number.
 * Needed when admin created a seller but the user field was not set.
 * Body: { phone }  — the seller's login phone number
 */
exports.linkSellerUser = async (req, res) => {
  try {
    const { sellerId } = req.params;
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ success: false, message: 'phone is required' });

    // Strip to last 10 digits and try exact match first, then suffix regex
    const phoneDigits = String(phone).replace(/\D/g, '').slice(-10);
    let user = await User.findOne({ phone: phoneDigits }).lean();
    if (!user) {
      // Fallback: some users may have stored with country code prefix
      user = await User.findOne({ phone: { $regex: phoneDigits + '$' } }).lean();
    }
    if (!user) {
      return res.status(404).json({
        success: false,
        message: `No Eptomart account found for phone ${phoneDigits}. Ask the seller to sign up on Eptomart first, then link here.`,
      });
    }

    // Check if this user is already linked to another seller
    const existing = await EptoFreshSeller.findOne({ user: user._id, _id: { $ne: sellerId } }).lean();
    if (existing) {
      return res.status(400).json({
        success: false,
        message: `This phone is already linked to seller "${existing.shopName}". Cannot link to two sellers.`,
      });
    }

    const seller = await EptoFreshSeller.findByIdAndUpdate(
      sellerId,
      { $set: { user: user._id } },
      { new: true }
    ).lean();
    if (!seller) return res.status(404).json({ success: false, message: 'Seller not found' });

    res.json({ success: true, message: `✓ Linked to ${user.name || user.phone}. Seller can now access the portal.`, seller });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

exports.updateDeliveryConfig = async (req, res) => {
  const allowed = [
    'freeDeliveryThreshold', 'freeDeliveryDistanceLimit',
    'highValueSurchargePerSlab', 'highValueSlabSizeKm',
    'standardSurchargePerSlab', 'standardSlabSizeKm',
    'standardBaseBeyond12km', 'maxServiceableDistance', 'cityRules',
  ];
  const update = {};
  allowed.forEach(k => { if (req.body[k] !== undefined) update[k] = req.body[k]; });
  update.updatedBy = req.user._id;

  const config = await EptoFreshDeliveryConfig.findOneAndUpdate(
    { key: 'global' },
    { $set: update },
    { new: true, upsert: true }
  );
  res.json({ success: true, config });
};
