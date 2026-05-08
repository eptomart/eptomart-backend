// ============================================
// UZHAVAR SUBSCRIPTION MODEL
// ============================================
const mongoose = require('mongoose');

const uzhavarSubscriptionSchema = new mongoose.Schema({
  buyer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

  plan: {
    type:  String,
    enum:  ['monthly', 'quarterly'],
    required: true,
  },

  pricing: {
    base:  Number, // 299 or 499
    gst:   Number, // 18%
    total: Number,
  },

  // Payment
  razorpayOrderId:   String,
  razorpayPaymentId: String,
  paymentStatus:     { type: String, enum: ['pending', 'paid', 'failed'], default: 'pending' },

  // Validity
  startDate:  Date,
  endDate:    Date,
  isActive:   { type: Boolean, default: false },

  // Usage
  ordersUsed:   { type: Number, default: 0 },
  ordersLimit:  { type: Number, default: 9999 }, // unlimited per plan

  // Renewal
  autoRenew:    { type: Boolean, default: false },
  renewedFrom:  { type: mongoose.Schema.Types.ObjectId, ref: 'UzhavarSubscription' },
}, { timestamps: true });

// Pricing map
uzhavarSubscriptionSchema.statics.PLANS = {
  monthly:   { base: 299, months: 1 },
  quarterly: { base: 499, months: 3 },
};

uzhavarSubscriptionSchema.statics.calcPricing = function(plan) {
  const p = this.PLANS[plan];
  if (!p) return null;
  const gst   = parseFloat((p.base * 0.18).toFixed(2));
  const total = parseFloat((p.base + gst).toFixed(2));
  return { base: p.base, gst, total };
};

uzhavarSubscriptionSchema.index({ buyer: 1, isActive: 1 });
uzhavarSubscriptionSchema.index({ endDate: 1, isActive: 1 });

module.exports = mongoose.model('UzhavarSubscription', uzhavarSubscriptionSchema);
