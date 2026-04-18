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
}, { _id: true });

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Name is required'],
    trim: true,
    minlength: [2, 'Name must be at least 2 characters'],
    maxlength: [50, 'Name cannot exceed 50 characters'],
  },
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
    enum: ['orders', 'products', 'approvals', 'sellers', 'users', 'analytics', 'categories', 'expenses', 'settlements', 'admins'],
    default: ['orders'],
  },
  isVerified: {
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
