const User    = require('../models/User');
const Seller  = require('../models/Seller');
const Product = require('../models/Product');
const { geocode } = require('../utils/deliveryEstimator');
const { sendSellerWelcomeEmail, sendSellerActivatedEmail } = require('../utils/sendEmail');
const { sendOtpSms }   = require('../utils/sendSMS');
const { sendSellerWelcomeWhatsApp, sendSellerActivatedWhatsApp } = require('../utils/sendWhatsApp');

// Send plain welcome SMS (not OTP)
const sendWelcomeSms = async (phone, message) => {
  const apiKey = process.env.TWOFACTOR_API_KEY || process.env.FAST2SMS_API_KEY;
  if (!apiKey) return;
  const https = require('https');
  const encoded = encodeURIComponent(message);
  const url = `https://2factor.in/API/V1/${apiKey}/ADDON_SERVICES/SEND/TSMS?From=EPTOMT&To=${phone}&Msg=${encoded}`;
  return new Promise(resolve => {
    https.get(url, (res) => { res.resume(); resolve(); }).on('error', () => resolve());
  });
};

// ── Admin: list all sellers ──────────────────────────────
const listSellers = async (req, res) => {
  const { status, search, page = 1, limit = 20, includeDeleted } = req.query;
  const filter = {};

  if (status) {
    filter.status = status;
  } else if (includeDeleted === 'true') {
    // show only deleted sellers
    filter.status = 'deleted';
  } else {
    // default: exclude deleted sellers from the main list
    filter.status = { $ne: 'deleted' };
  }

  if (search) {
    filter.$or = [
      { businessName: { $regex: search, $options: 'i' } },
      { 'contact.email': { $regex: search, $options: 'i' } },
      { 'contact.phone': { $regex: search, $options: 'i' } },
    ];
  }

  const [sellers, total] = await Promise.all([
    Seller.find(filter)
      .populate('user', 'name email phone role isActive')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .lean(),
    Seller.countDocuments(filter),
  ]);

  res.json({ success: true, sellers, total, page: Number(page), pages: Math.ceil(total / limit) });
};

// ── Admin: create seller + user account ─────────────────
const createSeller = async (req, res) => {
  const { businessName, email, phone, address, gstNumber, panNumber, notes } = req.body;

  if (!businessName || !address?.pincode || (!email && !phone)) {
    return res.status(400).json({ success: false, message: 'businessName, address.pincode, and email or phone required' });
  }

  // Create user account with seller role
  const tempPassword = Math.random().toString(36).slice(-8) + 'A1!';
  const user = await User.create({
    name:      businessName,
    email:     email || undefined,
    phone:     phone || undefined,
    role:      'seller',
    isVerified: true,
    password:  tempPassword,
  });

  // Geocode seller location
  const coords = await geocode(address.pincode);

  const seller = await Seller.create({
    user:         user._id,
    businessName,
    contact:      { email, phone },
    address: {
      ...address,
      lat: coords?.lat,
      lng: coords?.lng,
      geocodedAt: coords ? new Date() : undefined,
    },
    gstNumber:    gstNumber || undefined,
    panNumber:    panNumber || undefined,
    notes:        notes || undefined,
    status:       'inactive',
    createdBy:    req.user._id,
  });

  // Link seller profile to user
  await User.findByIdAndUpdate(user._id, { sellerProfile: seller._id });

  const loginId = email || phone;

  // Welcome email with proper template (not OTP template)
  if (email) {
    sendSellerWelcomeEmail(email, { businessName, loginId }).catch(() => {});
  }

  // Welcome SMS (via existing 2Factor/Fast2SMS integration)
  if (phone) {
    const welcomeMsg = `Welcome to Eptomart! Your seller account for "${businessName}" is ready. Login at eptomart.com/login using your mobile OTP — no password needed.`;
    sendWelcomeSms(phone, welcomeMsg).catch(() => {});
  }

  // Welcome WhatsApp (Meta Cloud API — free tier)
  if (phone || email) {
    sendSellerWelcomeWhatsApp(phone || '', { businessName, loginId, tempPassword }).catch(() => {});
  }

  res.status(201).json({ success: true, seller, user: { _id: user._id, name: user.name, email: user.email, phone: user.phone } });
};

// ── Admin: get seller detail ─────────────────────────────
const getSeller = async (req, res) => {
  const seller = await Seller.findById(req.params.id).populate('user', 'name email phone isActive createdAt').lean();
  if (!seller) return res.status(404).json({ success: false, message: 'Seller not found' });
  res.json({ success: true, seller });
};

// ── Admin: update seller ─────────────────────────────────
const updateSeller = async (req, res) => {
  const seller = await Seller.findById(req.params.id);
  if (!seller) return res.status(404).json({ success: false, message: 'Seller not found' });

  const allowed = ['businessName','displayName','description','contact','address','gstNumber','panNumber','bankDetails','notes'];
  allowed.forEach(k => { if (req.body[k] !== undefined) seller[k] = req.body[k]; });

  // Re-geocode if pincode changed
  if (req.body.address?.pincode && req.body.address.pincode !== seller.address.pincode) {
    const coords = await geocode(req.body.address.pincode);
    if (coords) { seller.address.lat = coords.lat; seller.address.lng = coords.lng; seller.address.geocodedAt = new Date(); }
  }

  await seller.save();
  res.json({ success: true, seller });
};

// ── Admin: change seller status ──────────────────────────
const setSellerStatus = async (req, res) => {
  const { status } = req.body;
  if (!['active', 'inactive', 'suspended'].includes(status)) {
    return res.status(400).json({ success: false, message: 'Invalid status' });
  }

  const seller = await Seller.findById(req.params.id);
  if (!seller) return res.status(404).json({ success: false, message: 'Seller not found' });

  const wasAlreadyActive = seller.status === 'active';
  seller.status = status;
  if (status === 'active' && !seller.activatedAt) seller.activatedAt = new Date();
  if (status === 'suspended') seller.suspendedAt = new Date();
  await seller.save();

  // Activate/deactivate user account
  await User.findByIdAndUpdate(seller.user, { isActive: status === 'active' });

  // Activate/deactivate ALL seller products so they grey out (or come back live)
  await Product.updateMany(
    { seller: seller._id },
    { $set: { isActive: status === 'active' } }
  );

  // Send activation notifications (only on first activation, not every toggle)
  if (status === 'active' && !wasAlreadyActive) {
    const sellerEmail = seller.contact?.email;
    const sellerPhone = seller.contact?.phone;
    const businessName = seller.businessName;

    if (sellerEmail) {
      sendSellerActivatedEmail(sellerEmail, { businessName }).catch(() => {});
    }
    if (sellerPhone) {
      sendSellerActivatedWhatsApp(sellerPhone, { businessName }).catch(() => {});
    }
  }

  res.json({ success: true, seller });
};

// ── Admin: delete seller (soft — marks as 'deleted', preserved for audit) ────
const deleteSeller = async (req, res) => {
  const seller = await Seller.findById(req.params.id);
  if (!seller) return res.status(404).json({ success: false, message: 'Seller not found' });

  // Deactivate all seller products so they vanish from storefront
  await Product.updateMany({ seller: seller._id }, { $set: { isActive: false } });

  // Demote the linked user back to a plain customer
  await User.findByIdAndUpdate(seller.user, { isActive: false, sellerProfile: null, role: 'user' });

  // Soft-delete: mark as 'deleted' so it disappears from the active list
  // but is still visible in the Deleted Sellers section for super admin audit
  seller.status = 'deleted';
  seller.deletedAt = new Date();
  await seller.save();

  res.json({ success: true, message: 'Seller deleted' });
};

// ── Admin: restore a soft-deleted seller ─────────────────
const restoreSeller = async (req, res) => {
  const seller = await Seller.findById(req.params.id);
  if (!seller) return res.status(404).json({ success: false, message: 'Seller not found' });
  if (seller.status !== 'deleted') return res.status(400).json({ success: false, message: 'Seller is not deleted' });

  seller.status   = 'inactive'; // needs re-activation
  seller.deletedAt = undefined;
  await seller.save();

  // Re-link user as seller
  await User.findByIdAndUpdate(seller.user, { isActive: true, sellerProfile: seller._id, role: 'seller' });

  res.json({ success: true, message: 'Seller restored. Set status to active to re-enable.', seller });
};

// ── Seller: get own profile ──────────────────────────────
const getMyProfile = async (req, res) => {
  const seller = await Seller.findOne({ user: req.user._id }).populate('user', 'name email phone').lean();
  if (!seller) return res.status(404).json({ success: false, message: 'Seller profile not found' });
  res.json({ success: true, seller });
};

// ── Seller: update own profile ───────────────────────────
const updateMyProfile = async (req, res) => {
  const seller = await Seller.findOne({ user: req.user._id });
  if (!seller) return res.status(404).json({ success: false, message: 'Seller profile not found' });

  const allowed = ['displayName', 'description', 'contact', 'bankDetails'];
  allowed.forEach(k => { if (req.body[k] !== undefined) seller[k] = req.body[k]; });
  await seller.save();
  res.json({ success: true, seller });
};

// ── Seller: stats ────────────────────────────────────────
const getSellerStats = async (req, res) => {
  const sellerId = req.params.id || req.seller?._id;
  const seller   = await Seller.findById(sellerId).lean();
  if (!seller) return res.status(404).json({ success: false, message: 'Not found' });

  const Product = require('../models/Product');
  const Order   = require('../models/Order');

  const [productStats, orderStats] = await Promise.all([
    Product.aggregate([
      { $match: { seller: seller._id } },
      { $group: { _id: '$approvalStatus', count: { $sum: 1 } } },
    ]),
    Order.aggregate([
      { $match: { 'sellerBreakdown.seller': seller._id } },
      { $group: { _id: null, totalOrders: { $sum: 1 }, totalRevenue: { $sum: '$pricing.total' } } },
    ]),
  ]);

  const products = {};
  productStats.forEach(s => { products[s._id] = s.count; });
  const orders = orderStats[0] || { totalOrders: 0, totalRevenue: 0 };

  res.json({ success: true, stats: { products, orders } });
};

module.exports = { listSellers, createSeller, getSeller, updateSeller, setSellerStatus, deleteSeller, restoreSeller, getMyProfile, updateMyProfile, getSellerStats };
