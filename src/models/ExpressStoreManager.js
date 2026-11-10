// ============================================
// EPTOMART EXPRESS — Store Manager Model
// Deliberately its OWN collection/login system, separate from the main
// User model, so Express staff accounts can never collide with or affect
// customer accounts, seller accounts, or the existing admin/superAdmin
// roles used across the rest of Eptomart.
// ============================================
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const expressStoreManagerSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  phone: {
    type: String,
    required: true,
    unique: true,
    match: [/^[6-9]\d{9}$/, 'Invalid Indian mobile number'],
  },
  password: { type: String, required: true, minlength: 6, select: false },
  store: { type: mongoose.Schema.Types.ObjectId, ref: 'ExpressStore', required: true },
  // The normal Eptomart account (mobile-OTP login) that owns this store. When
  // set, that user can open the store dashboard straight from their Profile
  // with their regular login — no separate owner password needed.
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  isActive: { type: Boolean, default: true }, // Admin can suspend a manager account
  lastLogin: Date,
}, { timestamps: true });

expressStoreManagerSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

expressStoreManagerSchema.methods.comparePassword = async function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

module.exports = mongoose.model('ExpressStoreManager', expressStoreManagerSchema);
