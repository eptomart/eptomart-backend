// ============================================
// ADMIN CONTROLLER — Dashboard, Users, Orders
// ============================================
const User = require('../models/User');
const Product = require('../models/Product');
const Order = require('../models/Order');
const Analytics = require('../models/Analytics');

/**
 * @route   GET /api/admin/dashboard
 * @desc    Admin dashboard stats
 * @access  Admin
 */
const getDashboard = async (req, res) => {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
  const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);

  const [
    totalUsers,
    newUsersToday,
    totalProducts,
    outOfStock,
    totalOrders,
    ordersToday,
    pendingOrders,
    revenueData,
    revenueToday,
    revenueThisMonth,
    totalVisitors,
    visitorsToday,
    recentOrders,
    topProducts,
  ] = await Promise.all([
    User.countDocuments({ role: 'user' }),
    User.countDocuments({ role: 'user', createdAt: { $gte: today } }),
    Product.countDocuments({ isActive: true }),
    Product.countDocuments({ stock: 0, isActive: true }),
    Order.countDocuments(),
    Order.countDocuments({ createdAt: { $gte: today } }),
    Order.countDocuments({ orderStatus: { $in: ['placed', 'confirmed', 'processing'] } }),
    Order.aggregate([
      { $match: { paymentStatus: 'paid' } },
      { $group: { _id: null, total: { $sum: '$pricing.total' } } }
    ]),
    Order.aggregate([
      { $match: { paymentStatus: 'paid', createdAt: { $gte: today } } },
      { $group: { _id: null, total: { $sum: '$pricing.total' } } }
    ]),
    Order.aggregate([
      { $match: { paymentStatus: 'paid', createdAt: { $gte: thisMonth } } },
      { $group: { _id: null, total: { $sum: '$pricing.total' } } }
    ]),
    Analytics.distinct('ip', { isBot: false }),
    Analytics.distinct('ip', { isBot: false, timestamp: { $gte: today } }),
    Order.find().sort('-createdAt').limit(5).populate('user', 'name email'),
    Product.find({ isActive: true }).sort('-soldCount').limit(5).select('name soldCount price images'),
  ]);

  // Sales trend (last 7 days)
  const salesTrend = await Order.aggregate([
    {
      $match: {
        paymentStatus: 'paid',
        createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
      }
    },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
        revenue: { $sum: '$pricing.total' },
        orders: { $sum: 1 },
      }
    },
    { $sort: { _id: 1 } }
  ]);

  res.json({
    success: true,
    stats: {
      users: { total: totalUsers, newToday: newUsersToday },
      products: { total: totalProducts, outOfStock },
      orders: { total: totalOrders, today: ordersToday, pending: pendingOrders },
      revenue: {
        total: revenueData[0]?.total || 0,
        today: revenueToday[0]?.total || 0,
        thisMonth: revenueThisMonth[0]?.total || 0,
      },
      visitors: { total: totalVisitors.length, today: visitorsToday.length },
    },
    salesTrend,
    recentOrders,
    topProducts,
  });
};

/**
 * @route   GET /api/admin/users
 * @desc    Get all users
 * @access  Admin
 */
const getUsers = async (req, res) => {
  const { page = 1, limit = 20, search, role } = req.query;
  const filter = {};
  if (role) filter.role = role;
  if (search) {
    filter.$or = [
      { name: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
      { phone: { $regex: search, $options: 'i' } },
    ];
  }

  const skip = (Number(page) - 1) * Number(limit);
  const [users, total] = await Promise.all([
    User.find(filter).sort('-createdAt').skip(skip).limit(Number(limit)),
    User.countDocuments(filter),
  ]);

  res.json({ success: true, users, total, totalPages: Math.ceil(total / Number(limit)) });
};

/**
 * @route   GET /api/admin/users/:id/login-history
 * @desc    Get user login history
 * @access  Admin
 */
const getUserLoginHistory = async (req, res) => {
  const user = await User.findById(req.params.id).select('+loginHistory name email phone');
  if (!user) return res.status(404).json({ success: false, message: 'User not found' });

  res.json({ success: true, user: { name: user.name, email: user.email, phone: user.phone }, loginHistory: user.loginHistory || [] });
};

/**
 * @route   PUT /api/admin/users/:id/status
 * @desc    Toggle user active status
 * @access  Admin
 */
const toggleUserStatus = async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ success: false, message: 'User not found' });
  if (user.role === 'admin') return res.status(400).json({ success: false, message: 'Cannot modify admin account' });

  user.isActive = !user.isActive;
  await user.save();

  res.json({ success: true, message: `User ${user.isActive ? 'activated' : 'suspended'}`, user });
};

/**
 * @route   PUT /api/admin/users/:id
 * @desc    Edit user name / email / phone
 * @access  SuperAdmin
 */
const updateUser = async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ success: false, message: 'User not found' });
  if (user.role === 'admin' || user.role === 'superAdmin')
    return res.status(400).json({ success: false, message: 'Cannot edit admin accounts here' });

  const { name, email, phone } = req.body;
  if (name  !== undefined) user.name  = name.trim();
  if (email !== undefined) user.email = email.trim().toLowerCase();
  if (phone !== undefined) user.phone = phone.trim();

  await user.save();
  res.json({ success: true, message: 'User updated', user });
};

/**
 * @route   DELETE /api/admin/users/:id
 * @desc    Delete a user permanently (cannot delete admins or sellers)
 * @access  SuperAdmin
 */
const deleteUser = async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ success: false, message: 'User not found' });
  if (user.role === 'admin' || user.role === 'superAdmin')
    return res.status(400).json({ success: false, message: 'Cannot delete admin accounts' });
  if (user.role === 'seller')
    return res.status(400).json({ success: false, message: 'Delete via Sellers management instead' });

  await user.deleteOne();
  res.json({ success: true, message: 'User deleted permanently' });
};

/**
 * @route   GET /api/admin/orders
 * @desc    Get all orders
 * @access  Admin
 */
const getAllOrders = async (req, res) => {
  const { page = 1, limit = 20, status, paymentStatus } = req.query;
  const filter = {};
  if (status) filter.orderStatus = status;
  if (paymentStatus) filter.paymentStatus = paymentStatus;

  const skip = (Number(page) - 1) * Number(limit);
  const [orders, total] = await Promise.all([
    Order.find(filter)
      .sort('-createdAt')
      .skip(skip)
      .limit(Number(limit))
      .populate('user', 'name email phone')
      .populate({ path: 'items.product', select: 'seller name images', populate: { path: 'seller', model: 'Seller', select: 'businessName _id' } }),
    Order.countDocuments(filter),
  ]);

  res.json({ success: true, orders, total, totalPages: Math.ceil(total / Number(limit)) });
};

/**
 * @route   PUT /api/admin/orders/:id/status
 * @desc    Update order status
 * @access  Admin
 */
const updateOrderStatus = async (req, res) => {
  const { status, paymentStatus, trackingNumber, note } = req.body;
  const order = await Order.findById(req.params.id);
  if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

  if (status) order.orderStatus = status;
  if (paymentStatus) order.paymentStatus = paymentStatus;
  if (trackingNumber) order.trackingNumber = trackingNumber;

  order.statusHistory.push({
    status: status || order.orderStatus,
    note: note || `Updated by admin`,
    updatedBy: 'admin',
  });

  await order.save();
  res.json({ success: true, message: 'Order updated', order });
};

/**
 * @route   POST /api/admin/orders/:id/cancel-refund
 * @desc    Admin cancels an order and triggers automatic refund
 * @access  Admin
 */
const adminCancelWithRefund = async (req, res) => {
  const { note } = req.body;
  const order = await Order.findById(req.params.id);
  if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

  if (order.orderStatus === 'cancelled') {
    return res.status(400).json({ success: false, message: 'Order is already cancelled' });
  }
  if (['delivered', 'returned'].includes(order.orderStatus)) {
    return res.status(400).json({ success: false, message: 'Cannot cancel a delivered or returned order from here' });
  }

  const reason = note || 'Cancelled by admin';
  order.orderStatus = 'cancelled';
  order.statusHistory.push({ status: 'cancelled', note: reason, updatedBy: 'admin' });

  // Restore stock
  const Product = require('../models/Product');
  for (const item of order.items) {
    await Product.findByIdAndUpdate(item.product, { $inc: { stock: item.quantity, soldCount: -item.quantity } });
  }

  // Process refund using shared helper from orderController
  const { processRefundForOrder } = require('./orderController');
  await processRefundForOrder(order);
  await order.save();

  res.json({ success: true, message: 'Order cancelled', order, refund: order.refund });
};

// ── Admin Account Management (superAdmin only) ───────────
const VALID_PERMISSIONS = ['orders', 'products', 'approvals', 'sellers', 'users', 'analytics', 'categories', 'expenses', 'settlements', 'admins'];

const listAdmins = async (req, res) => {
  const admins = await User.find({ role: { $in: ['admin', 'superAdmin'] } })
    .select('name email phone role isActive permissions createdAt lastLogin')
    .sort({ createdAt: -1 })
    .lean();
  res.json({ success: true, admins });
};

const createAdmin = async (req, res) => {
  const { name, email, phone, permissions } = req.body;
  if (!name || (!email && !phone)) {
    return res.status(400).json({ success: false, message: 'Name and email or phone required' });
  }

  // Validate and sanitise permissions list; default to orders-only
  const cleanPerms = Array.isArray(permissions)
    ? permissions.filter(p => VALID_PERMISSIONS.includes(p))
    : ['orders'];

  const query = email ? { email } : { phone };
  const existing = await User.findOne(query);
  if (existing) {
    return res.status(400).json({ success: false, message: 'User already exists with this email/phone' });
  }

  const tempPassword = Math.random().toString(36).slice(-8) + 'A1!';
  const admin = await User.create({
    name, email: email || undefined, phone: phone || undefined,
    role: 'admin', isVerified: true, password: tempPassword,
    permissions: cleanPerms,
  });

  // Send credentials by email if provided
  if (email) {
    const { sendOtpEmail } = require('../utils/sendEmail');
    await sendOtpEmail(email, null, 'seller_welcome', {
      businessName: name,
      loginEmail: email,
      tempPassword,
    }).catch(() => {});
  }

  res.status(201).json({
    success: true,
    message: 'Admin account created',
    admin: { _id: admin._id, name: admin.name, email: admin.email, phone: admin.phone, role: admin.role },
    tempPassword, // Show once so superAdmin can share it
  });
};

const deleteAdmin = async (req, res) => {
  const admin = await User.findById(req.params.id);
  if (!admin) return res.status(404).json({ success: false, message: 'Admin not found' });
  if (admin.role === 'superAdmin') {
    return res.status(403).json({ success: false, message: 'Cannot remove a Super Admin account' });
  }
  admin.isActive = false;
  admin.role = 'user';
  await admin.save();
  res.json({ success: true, message: 'Admin access revoked' });
};

// SuperAdmin: update which modules an admin can access
const updateAdminPermissions = async (req, res) => {
  const admin = await User.findById(req.params.id);
  if (!admin) return res.status(404).json({ success: false, message: 'Admin not found' });
  if (admin.role === 'superAdmin') return res.status(400).json({ success: false, message: 'SuperAdmin always has full access' });
  const cleanPerms = Array.isArray(req.body.permissions)
    ? req.body.permissions.filter(p => VALID_PERMISSIONS.includes(p))
    : admin.permissions;
  admin.permissions = cleanPerms;
  await admin.save();
  res.json({ success: true, message: 'Permissions updated', permissions: admin.permissions });
};

/**
 * @route   POST /api/admin/orders/:id/ship
 * @desc    Manually create a Shiprocket shipment for an order with a chosen pickup address
 * @access  Admin
 */
const createManualShipment = async (req, res) => {
  const { pickupAddressId } = req.body; // 'main' or a pickupAddresses subdoc _id
  const order = await Order.findById(req.params.id)
    .populate({ path: 'items.product', select: 'seller name hsnCode', populate: { path: 'seller', model: 'Seller', select: 'businessName address pickupAddresses contact' } })
    .lean();

  if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

  const { createShipment } = require('../utils/shiprocket');
  const Seller = require('../models/Seller');

  // Determine seller from first item
  const sellerDoc = order.items?.[0]?.product?.seller || null;
  let pickupAddress = null;

  if (sellerDoc && pickupAddressId && pickupAddressId !== 'main') {
    // Use the chosen pickup address
    const fullSeller = await Seller.findById(sellerDoc._id).lean();
    pickupAddress = fullSeller?.pickupAddresses?.find(a => a._id.toString() === pickupAddressId);
    if (!pickupAddress) {
      return res.status(400).json({ success: false, message: 'Pickup address not found on seller' });
    }
    // Build a seller-like object with the chosen address
    pickupAddress = {
      ...sellerDoc,
      address: { street: pickupAddress.street, city: pickupAddress.city, state: pickupAddress.state, pincode: pickupAddress.pincode, country: 'India' },
      businessName: sellerDoc.businessName,
      _pickupLabel: pickupAddress.label,
      shiprocketLocationName: pickupAddress.shiprocketLocationName,
    };
  } else {
    // Use the seller's main address
    pickupAddress = sellerDoc;
  }

  try {
    const result = await createShipment(order, order.shippingAddress, pickupAddress);
    const srOrderId   = result?.order_id   || result?.data?.order_id;
    const srShipId    = result?.shipment_id || result?.data?.shipment_id;
    const awb         = result?.awb_code    || result?.data?.awb_code   || '';
    const courier     = result?.courier_name|| result?.data?.courier_name|| '';
    const trackingUrl = awb ? `https://shiprocket.co/tracking/${awb}` : '';

    if (srOrderId) {
      await Order.findByIdAndUpdate(req.params.id, {
        shiprocket:       { orderId: String(srOrderId), shipmentId: String(srShipId || ''), awb, courier, trackingUrl, status: 'created', createdAt: new Date() },
        trackingNumber:   awb,
        deliveryPartner:  courier,
        orderStatus:      'shipped',
      });
    }

    res.json({ success: true, shiprocket: { orderId: srOrderId, shipmentId: srShipId, awb, courier, trackingUrl } });
  } catch (err) {
    console.error('[Admin Ship] Shiprocket error:', err.message);
    res.status(500).json({ success: false, message: err.message || 'Failed to create Shiprocket shipment' });
  }
};

// ── Refresh AWB for an existing shipment ─────
// Called from admin panel when AWB shows as blank after shipment creation.
// Shiprocket assigns couriers asynchronously — this polls and saves the AWB.
const refreshShiprocketAWB = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate('user', 'email phone name');
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    const sr = order.shiprocket;
    if (!sr?.shipmentId) {
      return res.status(400).json({ success: false, message: 'No Shiprocket shipment linked to this order' });
    }

    if (sr.awb) {
      return res.json({ success: true, awb: sr.awb, courier: sr.courier, message: 'AWB already assigned' });
    }

    const { assignAWB } = require('../utils/shiprocket');
    const result = await assignAWB(sr.shipmentId);

    if (!result.awb) {
      return res.status(400).json({
        success: false,
        message: 'Courier not assigned yet by Shiprocket. Please try again in a few seconds, or assign manually from the Shiprocket dashboard.',
      });
    }

    const trackingUrl = `https://shiprocket.co/tracking/${result.awb}`;
    await Order.findByIdAndUpdate(order._id, {
      'shiprocket.awb':        result.awb,
      'shiprocket.courier':    result.courier,
      'shiprocket.trackingUrl': trackingUrl,
      trackingNumber:          result.awb,
    });

    res.json({ success: true, awb: result.awb, courier: result.courier, trackingUrl });
  } catch (err) {
    console.error('[Admin refreshAWB]', err.message);
    res.status(500).json({ success: false, message: err.message || 'Failed to refresh AWB' });
  }
};

module.exports = { getDashboard, getUsers, getUserLoginHistory, toggleUserStatus, updateUser, deleteUser, getAllOrders, updateOrderStatus, adminCancelWithRefund, listAdmins, createAdmin, deleteAdmin, updateAdminPermissions, createManualShipment, refreshShiprocketAWB };
