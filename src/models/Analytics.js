// ============================================
// ANALYTICS MODEL — Visitor Tracking
// ============================================
const mongoose = require('mongoose');

const analyticsSchema = new mongoose.Schema({
  sessionId: {
    type: String,
    required: true,
  },
  ip: String,
  page: {
    type: String,
    required: true,
  },
  referrer: String,
  userAgent: String,
  browser: String,
  os: String,
  device: String, // mobile, tablet, desktop
  country: String,
  city: String,
  isBot: {
    type: Boolean,
    default: false,
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  duration: Number, // in seconds
  timestamp: {
    type: Date,
    default: Date.now,
    index: true,
  },
}, {
  timestamps: false,
});

analyticsSchema.index({ ip: 1 });
analyticsSchema.index({ page: 1 });
analyticsSchema.index({ sessionId: 1 });
analyticsSchema.index({ timestamp: -1 });
analyticsSchema.index({ userId: 1 });

module.exports = mongoose.model('Analytics', analyticsSchema);
