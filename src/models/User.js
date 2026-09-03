// ============================================
// USER MODEL
// ============================================
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const loginHistorySchema = new mongoose.Schema({
  ip: String,
  userAgent: String,
  browser: String,
  os: String,
  device: String,
  timestamp: { type: Date, default: Date.now },
}, { _id: false });

const addressSchema = new mongoose.Schema({
  label: { type: String, default: 'Home' }, // Home, Work, Other
  fullName: String,
  phone: String,
  addressLine1: String,
  addressLine2: String,
  city: String,
  state: String,
  pincode: String,
  isDefault: { type: Boolean, default: false },
  // Optional geo-coordinates — populated when an address is captured via a
  // map-pin flow (e.g. Eptomart Express's location picker, which needs
  // precise lat/lng to find the nearest store). Addresses added the
  // traditional text-only way simply leave these null.
  lat: { type: Number, default: null },
  lng: { type: Number, default: null },
}, { _id: true });

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Name is required'],
    trim: true,
    minlength: [2, 'Name must be at least 2 characters'],
    maxlength: [50, 'Name cannot exceed 50 characters'],
  },
  firstName: { type: String, trim: true, maxlength: 50 },
  lastName:  { type: String, trim: true, maxlength: 50 },
  email: {
    type: String,
    unique: true,
    sparse: true, // allows null values to be unique
    lowercase: true,
    trim: true,
    match: [/^\S+@\S+\.\S+$/, 'Invalid email address'],
  },
  phone: {
    type: String,
    unique: true,
    sparse: true,
    match: [/^[6-9]\d{9}$/, 'Invalid Indian mobile number'],
  },
  password: {
    type: String,
    minlength: [6, 'Password must be at least 6 characters'],
    select: false, // Never return password in queries
  },
  role: {
    type: String,
    // superAdmin: full access, can create sellers/admins
    // admin: can only view & confirm orders, coordinate with sellers
    // seller: manages own products & orders
    // user: regular customer
    enum: ['user', 'seller', 'admin', 'superAdmin'],
    default: 'user',
  },
  sellerProfile: { type: mongoose.Schema.Types.ObjectId, ref: 'Seller' },
  // RBAC: which admin modules this user can access (superAdmin ignores this — has all)
  permissions: {
    type: [String],
    enum: ['orders', 'products', 'approvals', 'sellers', 'users', 'analytics', 'categories', 'expenses', 'settlements', 'admins', 'uzhavar', 'koyambedu'],
    default: ['orders'],
  },
  isVerified: {
    type: Boolean,
    default: false,
  },
  phoneVerified: {
    type: Boolean,
    default: false,   // true once user verifies via OTP
  },
  // Fixed test/review account (email eptosicare@gmail.com or phone
  // 9999999999 — see authController.js's DEMO_EMAIL/DEMO_PHONE). Lets
  // checkout across every vertical skip the real Razorpay gateway and
  // marks resulting orders as isDemoOrder so they're excluded from
  // revenue reports. Never set for a real customer account.
  isDemoAccount: {
    type: Boolean,
    default: false,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  avatar: {
    url: String,
    publicId: String,
  },
  addresses: [addressSchema],
  wishlist: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],
  loginHistory: {
    type: [loginHistorySchema],
    select: false, // Only load when explicitly needed
  },
  lastLogin: Date,
  registrationIp: String,
}, {
  timestamps: true,
});

// ─── Indexes for fast queries ─────────────────
// email and phone indexes created automatically via unique: true in schema
userSchema.index({ role: 1 });
userSchema.index({ createdAt: -1 });

// ─── Hash password before save ────────────────
userSchema.pre('save', async function (next) {
  if (!this.isModified('password') || !this.password) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

// ─── Compare password ─────────────────────────
userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

// ─── Add login history entry ──────────────────
userSchema.methods.addLoginHistory = async function (loginData) {
  // Keep only last 20 logins
  if (this.loginHistory && this.loginHistory.length >= 20) {
    this.loginHistory = this.loginHistory.slice(-19);
  }
  this.loginHistory = this.loginHistory || [];
  this.loginHistory.push(loginData);
  this.lastLogin = new Date();
  await this.save();
};

module.exports = mongoose.model('User', userSchema);
