// ============================================
// ADMIN CONTROLLER — Dashboard, Users, Orders
// ============================================
const User = require('../models/User');
const Product = require('../models/Product');
const Order = require('../models/Order');
const Seller = require('../models/Seller');
const Analytics = require('../models/Analytics');
const { logActivity } = require('../utils/activityLogger');

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

  const prevStatus = user.isActive;
  user.isActive = !user.isActive;
  await user.save();

  // ── Activity logging ────────────────────────
  logActivity(
    req,
    'user.status_toggled',
    'user',
    user._id.toString(),
    user.name || user.email,
    { from: prevStatus ? 'active' : 'suspended', to: user.isActive ? 'active' : 'suspended' }
  );

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
  const { page = 1, limit = 20, status, paymentStatus, seller: sellerFilter } = req.query;
  // Exclude unpaid online orders from admin view (buyer can still see their own)
  const filter = {
    $or: [{ paymentStatus: 'paid' }, { paymentMethod: 'cod' }],
  };
  if (status) filter.orderStatus = status;
  if (paymentStatus) filter.paymentStatus = paymentStatus;

  // Filter by seller: find all products belonging to that seller, then filter orders containing them
  if (sellerFilter) {
    const sellerProducts = await Product.find({ seller: sellerFilter }).select('_id').lean();
    const productIds = sellerProducts.map(p => p._id);
    filter['items.product'] = { $in: productIds };
  }

  const skip = (Number(page) - 1) * Number(limit);
  const [orders, total] = await Promise.all([
    Order.find(filter)
      .sort('-createdAt')
      .skip(skip)
      .limit(Number(limit))
      .populate('user', 'name email phone')
      .populate({ path: 'items.product', select: 'seller name images productCode', populate: { path: 'seller', model: 'Seller', select: 'businessName sellerId _id' } }),
    Order.countDocuments(filter),
  ]);

  res.json({ success: true, orders, total, totalPages: Math.ceil(total / Number(limit)) });
};

/**
 * @route   PUT /api/admin/orders/:id/status
 * @desc    Update order status — triggers payout calculation when status → delivered
 * @access  Admin
 */
const updateOrderStatus = async (req, res) => {
  const { status, paymentStatus, trackingNumber, note } = req.body;
  const order = await Order.findById(req.params.id);
  if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

  const prevStatus = order.orderStatus;

  if (status) order.orderStatus = status;
  if (paymentStatus) order.paymentStatus = paymentStatus;
  if (trackingNumber) order.trackingNumber = trackingNumber;

  order.statusHistory.push({
    status: status || order.orderStatus,
    note:   note || 'Updated by admin',
    updatedBy: 'admin',
  });

  await order.save();

  // ── Activity logging ────────────────────────
  if (status && status !== prevStatus) {
    logActivity(
      req,
      'order.status_updated',
      'order',
      order._id.toString(),
      `Order #${order.orderId}`,
      { from: prevStatus, to: status, note: note || 'Updated by admin' }
    );
  }

  // ── Payout + WhatsApp billing: triggered when order transitions to 'delivered' ──
  if (status === 'delivered' && prevStatus !== 'delivered') {
    try {
      const { calculateOrderPayout, creditSellerSettlement } = require('../utils/payoutCalculator');
      const payoutData = await calculateOrderPayout(order);

      // Only credit if payout hasn't been calculated yet (avoid double-credit)
      if (order.payout?.status !== 'calculated' && order.payout?.status !== 'paid') {
        await Order.findByIdAndUpdate(order._id, { payout: payoutData });

        if (payoutData.netPayout > 0 && payoutData.sellerId) {
          await creditSellerSettlement(payoutData.sellerId, payoutData.netPayout);
        }
        console.log(`[Payout] Order ${order.orderId} — net payout ₹${payoutData.netPayout} → seller ${payoutData.sellerName}`);
      }
    } catch (payoutErr) {
      // Payout failure must NOT block the status update response
      console.error('[Payout] Failed to calculate payout for order', order.orderId, ':', payoutErr.message);
    }

    // ── Send billing summary to customer via WhatsApp ───────
    setImmediate(async () => {
      try {
        const { sendOrderDeliveredWhatsApp } = require('../utils/sendWhatsApp');
        const phone = order.shippingAddress?.phone;
        if (phone) {
          await sendOrderDeliveredWhatsApp(phone, {
            name:          order.shippingAddress?.fullName,
            orderId:       order.orderId,
            items:         order.items || [],
            pricing:       order.pricing || {},
            paymentMethod: order.paymentMethod,
            deliveredAt:   new Date(),
          });
          console.log(`[WhatsApp] Delivery billing sent for order ${order.orderId} → ${phone}`);
        }
      } catch (waErr) {
        console.error('[WhatsApp] Delivery billing failed for order', order.orderId, ':', waErr.message);
      }
    });
  }

  // ── Notify seller when order is cancelled ──────────────────
  if (status === 'cancelled' && prevStatus !== 'cancelled') {
    setImmediate(async () => {
      try {
        const { notifyUser } = require('../utils/pushNotification');
        if (order.sellerPickup?.sellerId) {
          const sellerDoc = await Seller.findById(order.sellerPickup.sellerId).select('user').lean();
          if (sellerDoc?.user) {
            await notifyUser(sellerDoc.user, {
              title: `❌ Order #${order.orderId} Cancelled`,
              body:  note ? `Reason: ${note}` : 'This order has been cancelled by admin. Stock has been restored.',
              url:   '/seller/orders',
              tag:   `order-cancel-${order.orderId}`,
            });
          }
        }
      } catch (e) { console.error('[Notify] Seller cancel notify failed:', e.message); }
    });
  }

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

  // ── Notify seller about cancellation ──────────────────────
  setImmediate(async () => {
    try {
      const { notifyUser } = require('../utils/pushNotification');
      if (order.sellerPickup?.sellerId) {
        const sellerDoc = await Seller.findById(order.sellerPickup.sellerId).select('user').lean();
        if (sellerDoc?.user) {
          await notifyUser(sellerDoc.user, {
            title: `❌ Order #${order.orderId} Cancelled`,
            body:  reason !== 'Cancelled by admin'
              ? `Reason: ${reason}. Stock has been restored to your inventory.`
              : 'This order has been cancelled by admin. Stock has been restored to your inventory.',
            url:   '/seller/orders',
            tag:   `order-cancel-${order.orderId}`,
          });
        }
      }
    } catch (e) { console.error('[Notify] Seller cancel notify failed:', e.message); }
  });

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

  // 🔒 Packaging gate: require approved packaging photos before AWB
  const pkgStatus = order.packaging?.status;
  if (pkgStatus && pkgStatus !== 'approved' && pkgStatus !== 'not_submitted') {
    // If seller has submitted (pending_review or rejected) but not yet approved, block
    if (pkgStatus === 'pending_review') {
      return res.status(400).json({ success: false, message: 'Packaging images are pending review. Approve them first before generating AWB.' });
    }
    if (pkgStatus === 'rejected') {
      return res.status(400).json({ success: false, message: 'Packaging was rejected. Seller must re-upload photos before AWB can be generated.' });
    }
  }

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
      const shippingCharge = result?.shippingCharge || 0;
      await Order.findByIdAndUpdate(req.params.id, {
        shiprocket: {
          orderId: String(srOrderId),
          shipmentId: String(srShipId || ''),
          awb,
          courier,
          trackingUrl,
          shippingCharge,
          status: 'created',
          createdAt: new Date(),
        },
        trackingNumber:  awb,
        deliveryPartner: courier,
        orderStatus:     'shipped',
      });

      // ── Activity logging ────────────────────────
      logActivity(
        req,
        'order.shipment_created',
        'order',
        order._id.toString(),
        `Order #${order.orderId}`,
        { awb, courier, shippingCharge: result?.shippingCharge || 0 }
      );
    }

    res.json({ success: true, shiprocket: { orderId: srOrderId, shipmentId: srShipId, awb, courier, trackingUrl, shippingCharge: result?.shippingCharge || 0 } });
  } catch (err) {
    console.error('[Admin Ship] Shiprocket error:', err.message);
    res.status(500).json({ success: false, message: err.message || 'Failed to create Shiprocket shipment' });
  }
};

// ── Refresh AWB for an existing shipment ─────
// Called from admin panel when AWB is blank OR when courier was changed in Shiprocket dashboard.
// Always re-fetches from Shiprocket to catch courier reassignments (which change the AWB).
const refreshShiprocketAWB = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate('user', 'email phone name');
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    const sr = order.shiprocket;
    if (!sr?.shipmentId) {
      return res.status(400).json({ success: false, message: 'No Shiprocket shipment linked to this order' });
    }

    const { getShipmentDetails, assignAWB } = require('../utils/shiprocket');

    // Step 1: Always fetch the latest shipment details from Shiprocket
    // This picks up any courier change that happened in the Shiprocket dashboard.
    let result = await getShipmentDetails(sr.shipmentId);

    // Step 2: If still no AWB (courier not yet assigned), try assigning one
    if (!result.awb) {
      const assigned = await assignAWB(sr.shipmentId);
      if (assigned.awb) result = assigned;
    }

    if (!result.awb) {
      return res.status(400).json({
        success: false,
        message: 'Courier not assigned yet by Shiprocket. Please try again in a few seconds, or assign manually from the Shiprocket dashboard.',
      });
    }

    const trackingUrl = `https://shiprocket.co/tracking/${result.awb}`;
    const updateFields = {
      'shiprocket.awb':         result.awb,
      'shiprocket.courier':     result.courier || sr.courier,
      'shiprocket.trackingUrl': trackingUrl,
      trackingNumber:           result.awb,
    };
    if (result.freightCharge || result.shippingCharge) {
      updateFields['shiprocket.shippingCharge'] = result.freightCharge || result.shippingCharge;
    }
    await Order.findByIdAndUpdate(order._id, updateFields);

    const changed = sr.awb && sr.awb !== result.awb;
    res.json({
      success: true,
      awb:      result.awb,
      courier:  result.courier || sr.courier,
      trackingUrl,
      shippingCharge: result.freightCharge || result.shippingCharge || 0,
      changed,
      message: changed
        ? `AWB updated — courier changed to ${result.courier}`
        : sr.awb === result.awb
          ? 'AWB confirmed (no change)'
          : 'AWB assigned successfully',
    });
  } catch (err) {
    console.error('[Admin refreshAWB]', err.message);
    res.status(500).json({ success: false, message: err.message || 'Failed to refresh AWB' });
  }
};

// ── PATCH /api/admin/orders/:id/packaging-review ──────────
// Admin approves or rejects seller packaging images
const reviewPackaging = async (req, res) => {
  const { action, reason } = req.body; // action: 'approve' | 'reject'
  if (!['approve', 'reject'].includes(action)) {
    return res.status(400).json({ success: false, message: 'action must be approve or reject' });
  }

  const order = await Order.findById(req.params.id);
  if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

  if (order.packaging?.status !== 'pending_review') {
    return res.status(400).json({ success: false, message: 'No packaging submission pending review' });
  }

  // On approval — delete all packaging photos from Cloudinary (no longer needed)
  if (action === 'approve') {
    const { deleteImage } = require('../config/cloudinary');
    const toDelete = (order.packaging.images || []).filter(img => img.publicId);
    // Fire-and-forget deletions (don't block the response)
    Promise.all(toDelete.map(img => deleteImage(img.publicId).catch(() => {}))).catch(() => {});
    // Clear images from the document — keep the status + reviewedAt for audit trail
    order.packaging.images = [];
  }

  order.packaging.status      = action === 'approve' ? 'approved' : 'rejected';
  order.packaging.reviewedAt  = new Date();
  order.packaging.reviewedBy  = req.user._id;
  if (action === 'reject') order.packaging.rejectedReason = reason || 'Please re-upload clearer photos';

  order.statusHistory.push({
    status:    order.orderStatus,
    note:      `Packaging ${action}d by admin${reason ? ': ' + reason : ''}`,
    updatedBy: 'admin',
  });

  await order.save();

  // ── Activity logging ────────────────────────
  logActivity(
    req,
    'order.packaging_reviewed',
    'order',
    order._id.toString(),
    `Order #${order.orderId}`,
    { action, reason: reason || 'No reason provided' }
  );

  // Notify seller
  const { notifyUser } = require('../utils/pushNotification');
  if (order.sellerPickup?.sellerId) {
    notifyUser(order.sellerPickup.sellerId, {
      title: action === 'approve' ? '✅ Packaging Approved!' : '❌ Packaging Rejected',
      body:  action === 'approve'
        ? `Order #${order.orderId} packaging approved. AWB will now be generated.`
        : `Order #${order.orderId} packaging rejected: ${reason || 'Please re-upload'}`,
      url: '/seller/orders',
    }).catch(() => {});
  }

  res.json({ success: true, message: `Packaging ${action}d`, order });
};

/**
 * @route   GET /api/admin/orders/:id/shiprocket-charge
 * @desc    Fetch actual Shiprocket freight charge for an order's shipment
 * @access  Admin
 */
const getShiprocketCharge = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id).lean();
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    const shipmentId = order.shiprocket?.shipmentId;
    if (!shipmentId) {
      return res.status(400).json({ success: false, message: 'No Shiprocket shipment linked to this order' });
    }

    const { getShipmentCharge } = require('../utils/shiprocket');
    const result = await getShipmentCharge(shipmentId);

    res.json({
      success: true,
      shipmentId,
      freightCharge: result.freightCharge,
      current: order.shiprocket?.shippingCharge || 0,
    });
  } catch (err) {
    console.error('[Admin getShiprocketCharge]', err.message);
    res.status(500).json({ success: false, message: err.message || 'Failed to fetch Shiprocket charge' });
  }
};

/**
 * @route   POST /api/admin/orders/:id/recalculate-payout
 * @desc    Admin manually recalculates and finalizes payout with overrides
 * @access  Admin
 *
 * Body:
 *   applyPlatformFee: boolean (default: true) — set false to skip platform fee
 *   packingCharge: number (₹) — deduction for packing
 *   customDeduction: number (₹) — any other deduction
 *   customDeductionNote: string — reason for custom deduction
 */
const recalculatePayout = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate({ path: 'items.product', select: 'seller name price gstRate', populate: { path: 'seller', model: 'Seller', select: 'defaultPlatformMargin businessName' } })
      .lean();

    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    const { applyPlatformFee, packingCharge = 0, customDeduction = 0, customDeductionNote } = req.body;

    // ── Base calculation using existing payout calculator ─────────────
    const { calculateOrderPayout } = require('../utils/payoutCalculator');
    let payoutData = await calculateOrderPayout(order);

    // ── Apply admin overrides ─────────────────────────────────────────
    // NEW-SELLER BONUS ALWAYS WINS: if calculator says bonus applies, fee is always 0
    // regardless of what the admin checkbox says (prevents accidental double-charging)
    if (payoutData.isNewSellerBonus) {
      payoutData.platformFee      = 0;
      payoutData.applyPlatformFee = false;
    } else if (applyPlatformFee === false) {
      // Admin manually waiving fee for a non-bonus seller
      payoutData.platformFee      = 0;
      payoutData.applyPlatformFee = false;
      payoutData.adminFeeWaived   = true;
    } else if (applyPlatformFee === true) {
      // Admin explicitly applying fee
      payoutData.applyPlatformFee = true;
      payoutData.platformFee      = parseFloat(
        (payoutData.baseAmount * (payoutData.platformFeeRate || 10) / 100).toFixed(2)
      );
    }

    // Add packing charge (deduction)
    const packingChargeVal = Math.max(0, parseFloat((packingCharge || 0).toFixed(2)));
    payoutData.packingCharge = packingChargeVal;

    // Add custom deduction (deduction)
    const customDeductionVal = Math.max(0, parseFloat((customDeduction || 0).toFixed(2)));
    payoutData.customDeduction = customDeductionVal;
    if (customDeductionNote) {
      payoutData.customDeductionNote = customDeductionNote;
    }

    // ── Recalculate net payout with all deductions ───────────────────
    const netPayout = parseFloat(
      (payoutData.baseAmount - payoutData.platformFee - payoutData.shippingCost - packingChargeVal - customDeductionVal).toFixed(2)
    );
    payoutData.netPayout = Math.max(0, netPayout);

    // ── Mark as finalized ────────────────────────────────────────────
    payoutData.finalizedBy = req.user._id;
    payoutData.finalizedAt = new Date();
    payoutData.status = 'calculated'; // Mark as manually calculated

    // ── Update the order ────────────────────────────────────────────
    await Order.findByIdAndUpdate(req.params.id, { payout: payoutData });

    // ── Activity logging ────────────────────────────────────────────
    logActivity(
      req,
      'payout.recalculated',
      'order',
      order._id.toString(),
      `Order #${order.orderId}`,
      {
        netPayout: payoutData.netPayout,
        platformFee: payoutData.platformFee,
        packingCharge: packingChargeVal,
        customDeduction: customDeductionVal,
        applyPlatformFee,
      }
    );

    console.log(`[Payout] Order ${order.orderId} — admin finalized payout ₹${payoutData.netPayout}`);

    res.json({
      success: true,
      message: 'Payout recalculated and finalized',
      payout: payoutData,
    });
  } catch (err) {
    console.error('[Admin recalculatePayout]', err.message);
    res.status(500).json({ success: false, message: err.message || 'Failed to recalculate payout' });
  }
};

// ── GET /api/admin/sellers/:id/orders ─────────────────────
// Orders for a specific seller, with filters and settlement summary.
const getSellerOrders = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      status,
      from,        // date range start (ISO string)
      to,          // date range end   (ISO string)
      day,         // single day shortcut (YYYY-MM-DD)
      settled,     // 'true' | 'false' — payout settled filter
      sort = 'newest',
      page = 1,
      limit = 25,
    } = req.query;

    // Verify seller exists
    const seller = await Seller.findById(id).lean();
    if (!seller) return res.status(404).json({ success: false, message: 'Seller not found' });

    // Find all products belonging to this seller
    const products = await Product.find({ seller: id }).select('_id name').lean();
    const productIds = products.map(p => p._id);

    if (!productIds.length) {
      return res.json({ success: true, orders: [], total: 0, stats: { totalRevenue: 0, totalOrders: 0, settled: 0, pending: 0 } });
    }

    // Build match filter — orders containing at least one of seller's products
    const match = { 'items.product': { $in: productIds } };

    if (status)  match.orderStatus = status;

    if (day) {
      const d = new Date(day);
      const next = new Date(d); next.setDate(next.getDate() + 1);
      match.createdAt = { $gte: d, $lt: next };
    } else if (from || to) {
      match.createdAt = {};
      if (from) match.createdAt.$gte = new Date(from);
      if (to)   { const end = new Date(to); end.setHours(23, 59, 59, 999); match.createdAt.$lte = end; }
    }

    if (settled === 'true')  match['payout.status'] = 'paid';
    if (settled === 'false') match['payout.status'] = { $in: ['pending', 'calculated', 'processing', 'on_hold', null] };

    // Sort
    const sortMap = {
      newest:    { createdAt: -1 },
      oldest:    { createdAt: 1  },
      topselling:{ 'pricing.total': -1 },
    };
    const sortObj = sortMap[sort] || { createdAt: -1 };

    const skip = (Number(page) - 1) * Number(limit);

    const [orders, total] = await Promise.all([
      Order.find(match)
        .sort(sortObj)
        .skip(skip)
        .limit(Number(limit))
        .populate('user', 'name email phone')
        .populate('items.product', 'name price sku images')
        .lean(),
      Order.countDocuments(match),
    ]);

    // Stats
    const [stats] = await Order.aggregate([
      { $match: match },
      { $group: {
          _id: null,
          totalRevenue:   { $sum: '$pricing.total' },
          totalOrders:    { $sum: 1 },
          settledCount:   { $sum: { $cond: [{ $eq: ['$payout.status', 'paid'] }, 1, 0] } },
          pendingCount:   { $sum: { $cond: [{ $ne:  ['$payout.status', 'paid'] }, 1, 0] } },
          totalNetPayout: { $sum: { $ifNull: ['$payout.netPayout', 0] } },
      }},
    ]).catch(() => [{}]);

    // Top selling products for this seller
    const topProducts = await Order.aggregate([
      { $match: match },
      { $unwind: '$items' },
      { $match: { 'items.product': { $in: productIds } } },
      { $group: {
          _id: '$items.product',
          name: { $first: '$items.name' },
          totalSold: { $sum: '$items.quantity' },
          revenue:   { $sum: { $multiply: ['$items.price', '$items.quantity'] } },
      }},
      { $sort: { totalSold: -1 } },
      { $limit: 5 },
    ]).catch(() => []);

    res.json({
      success: true,
      seller: {
        _id: seller._id,
        businessName: seller.businessName,
        email: seller.email,
        phone: seller.phone,
        gstNumber: seller.gstNumber,
      },
      orders,
      total,
      page: Number(page),
      pages: Math.ceil(total / Number(limit)),
      stats: {
        totalRevenue:   stats?.totalRevenue   || 0,
        totalOrders:    stats?.totalOrders    || 0,
        settledCount:   stats?.settledCount   || 0,
        pendingCount:   stats?.pendingCount   || 0,
        totalNetPayout: stats?.totalNetPayout || 0,
      },
      topProducts,
    });
  } catch (err) {
    console.error('[Admin getSellerOrders]', err.message);
    res.status(500).json({ success: false, message: err.message || 'Failed to fetch seller orders' });
  }
};

// ── POST /api/admin/sellers/:id/mark-settled ──────────────
// Mark selected orders' payouts as paid/settled.
const markSellerOrdersSettled = async (req, res) => {
  try {
    const { orderIds } = req.body;
    if (!orderIds?.length) return res.status(400).json({ success: false, message: 'No order IDs provided' });

    const result = await Order.updateMany(
      { _id: { $in: orderIds } },
      {
        $set: {
          'payout.status': 'paid',
          'payout.paidAt': new Date(),
          'payout.finalizedBy': req.user._id,
        },
      }
    );

    logActivity(req, 'payout.settled', 'order', null, `Batch settlement — ${result.modifiedCount} orders`, { count: result.modifiedCount });

    res.json({ success: true, message: `${result.modifiedCount} orders marked as settled`, count: result.modifiedCount });
  } catch (err) {
    console.error('[Admin markSettled]', err.message);
    res.status(500).json({ success: false, message: err.message || 'Failed to mark settled' });
  }
};

// ── PATCH /api/admin/orders/:id/shipping-charge ───────────
// Admin sets the actual shipping charge (as billed by Shiprocket).
// This value takes priority over the API-detected charge in payout calculation.
const setAdminShippingCharge = async (req, res) => {
  try {
    const { charge } = req.body;
    const amount = parseFloat(charge);
    if (isNaN(amount) || amount < 0) {
      return res.status(400).json({ success: false, message: 'Invalid shipping charge amount' });
    }

    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    order.set('shiprocket.adminShippingCharge', amount);
    await order.save();

    // If payout already exists, update its shippingCost and recalculate netPayout
    if (order.payout?.baseAmount !== undefined) {
      const payout = order.payout.toObject ? order.payout.toObject() : { ...order.payout };
      payout.shippingCost = amount;
      payout.netPayout = Math.max(
        0,
        parseFloat(
          (payout.baseAmount - (payout.platformFee || 0) - amount - (payout.packingCharge || 0) - (payout.customDeduction || 0)).toFixed(2)
        )
      );
      await Order.findByIdAndUpdate(order._id, { payout });
    }

    logActivity(req, 'order.shipping_charge_set', 'order', order._id.toString(), `Order #${order.orderId}`, { amount });

    res.json({ success: true, message: `Shipping charge set to ₹${amount}`, adminShippingCharge: amount });
  } catch (err) {
    console.error('[Admin setShippingCharge]', err.message);
    res.status(500).json({ success: false, message: err.message || 'Failed to set shipping charge' });
  }
};

// ── POST /api/admin/orders/:id/shiprocket-bill ────────────
// Admin uploads Shiprocket bill (PDF or image) for an order.
// File is stored in Cloudinary under eptomart/shiprocket-bills/
const uploadShiprocketBill = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });

    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    // Delete previous bill from Cloudinary if it exists
    if (order.shiprocket?.bill?.publicId) {
      const { deleteImage } = require('../config/cloudinary');
      const resourceType = order.shiprocket.bill.url?.includes('/raw/') ? 'raw' : 'image';
      await deleteImage(order.shiprocket.bill.publicId, resourceType).catch(() => {});
    }

    const bill = {
      url:        req.file.path,      // Cloudinary URL
      publicId:   req.file.filename,  // Cloudinary public_id
      uploadedAt: new Date(),
      uploadedBy: req.user._id,
    };

    await Order.findByIdAndUpdate(order._id, { 'shiprocket.bill': bill });

    logActivity(req, 'order.bill_uploaded', 'order', order._id.toString(), `Order #${order.orderId}`, { url: bill.url });

    res.json({ success: true, message: 'Bill uploaded successfully', bill });
  } catch (err) {
    console.error('[Admin uploadBill]', err.message);
    res.status(500).json({ success: false, message: err.message || 'Failed to upload bill' });
  }
};

module.exports = {
  getDashboard, getUsers, getUserLoginHistory, toggleUserStatus, updateUser, deleteUser,
  getAllOrders, updateOrderStatus, adminCancelWithRefund,
  listAdmins, createAdmin, deleteAdmin, updateAdminPermissions,
  createManualShipment, refreshShiprocketAWB, reviewPackaging,
  getShiprocketCharge, recalculatePayout,
  getSellerOrders, markSellerOrdersSettled,
  setAdminShippingCharge, uploadShiprocketBill,
};
