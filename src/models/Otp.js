// ============================================
// OTP MODEL — For email/phone verification
// ============================================
const mongoose = require('mongoose');

const otpSchema = new mongoose.Schema({
  contact: {
    type: String,
    required: true, // email or phone
  },
  type: {
    type: String,
    enum: ['email', 'phone'],
    required: true,
  },
  purpose: {
    type: String,
    enum: ['register', 'login', 'reset-password'],
    default: 'login',
  },
  code: {
    type: String,
    required: true,
  },
  attempts: {
    type: Number,
    default: 0,
  },
  used: {
    type: Boolean,
    default: false,
  },
  expiresAt: {
    type: Date,
    required: true,
    default: () => new Date(Date.now() + (parseInt(process.env.OTP_EXPIRY_MINUTES || 10)) * 60 * 1000),
  },
}, {
  timestamps: true,
});

// Auto-delete expired OTPs
otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
otpSchema.index({ contact: 1, type: 1 });

module.exports = mongoose.model('Otp', otpSchema);
