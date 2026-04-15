// ============================================
// PUSH SUBSCRIPTION MODEL
// Stores Web Push notification subscriptions
// ============================================
const mongoose = require('mongoose');

const pushSubscriptionSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  endpoint: {
    type: String,
    required: true,
    unique: true,
  },
  keys: {
    p256dh: { type: String, required: true },
    auth: { type: String, required: true },
  },
  userAgent: String,
  isActive: {
    type: Boolean,
    default: true,
  },
  lastUsed: {
    type: Date,
    default: Date.now,
  },
}, {
  timestamps: true,
});

pushSubscriptionSchema.index({ user: 1 });
// endpoint index created automatically via unique: true

module.exports = mongoose.model('PushSubscription', pushSubscriptionSchema);
