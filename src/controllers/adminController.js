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
      .populate('user', 'name email phone'),
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

module.exports = { getDashboard, getUsers, getUserLoginHistory, toggleUserStatus, getAllOrders, updateOrderStatus };
