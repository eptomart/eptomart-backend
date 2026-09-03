// ============================================
// EPTOMART EXPRESS — POS User Model
// Billing-counter staff. Very limited permissions by design (see section 6
// of the spec): can only create/hold/resume/complete bills for their own
// session at their assigned store. Separate collection/login from
// ExpressStoreManager and the main User model.
// ============================================
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const expressPOSUserSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  // POS staff log in with a short username + PIN at the counter, not a phone/OTP flow
  username: { type: String, required: true, unique: true, trim: true, lowercase: true },
  pin: { type: String, required: true, minlength: 4, select: false }, // hashed
  store: { type: mongoose.Schema.Types.ObjectId, ref: 'ExpressStore', required: true },
  isActive: { type: Boolean, default: true },
  lastLogin: Date,
}, { timestamps: true });

expressPOSUserSchema.pre('save', async function (next) {
  if (!this.isModified('pin')) return next();
  this.pin = await bcrypt.hash(this.pin, 10);
  next();
});

expressPOSUserSchema.methods.comparePin = async function (candidate) {
  return bcrypt.compare(candidate, this.pin);
};

module.exports = mongoose.model('ExpressPOSUser', expressPOSUserSchema);
