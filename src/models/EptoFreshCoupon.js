// ============================================
// EPTOFRESH COUPON MODEL
// ============================================
const mongoose = require('mongoose');
const { Schema } = mongoose;

const eptoFreshCouponSchema = new Schema({
  code:         { type: String, required: true, unique: true, uppercase: true, trim: true },
  description:  String,

  discountType: { type: String, enum: ['flat', 'percent'], required: true },
  discountValue:{ type: Number, required: true },
  maxDiscount:  { type: Number }, // cap for percent type

  minOrderValue:{ type: Number, default: 0 },
  maxUsage:     { type: Number, default: 100 },
  usedCount:    { type: Number, default: 0 },
  maxPerUser:   { type: Number, default: 1 },

  validFrom:    { type: Date, required: true },
  validTo:      { type: Date, required: true },

  isActive:     { type: Boolean, default: true },

  // Restrict to specific categories or sellers (EptoFresh legacy)
  categories:   [String],
  sellers:      [{ type: Schema.Types.ObjectId, ref: 'EptoFreshSeller' }],

  // ── Universal platform + seller restriction ─────────────
  // Which sub-app this coupon applies to ('all' = all platforms)
  platformRestriction: {
    type: String,
    enum: ['all', 'main', 'koyambedu', 'uzhavar', 'eptofresh'],
    default: 'all',
  },
  // Optional: restrict to one specific seller within the platform
  // Stores the ObjectId (as string) of KoyambeduSeller / Farmer / EptoFreshSeller
  assignedSellerId:   { type: String, default: null },
  assignedSellerName: { type: String, default: null }, // human-readable, for admin display

  createdBy:    { type: Schema.Types.ObjectId, ref: 'User' },

  // Seller promo request fields
  requestedBy:    { type: Schema.Types.ObjectId, ref: 'EptoFreshSeller' },
  requestStatus:  { type: String, enum: ['admin_created', 'pending', 'approved', 'rejected'], default: 'admin_created' },
  requestReason:  String,
  rejectReason:   String,

}, { timestamps: true });

eptoFreshCouponSchema.index({ code: 1 });
eptoFreshCouponSchema.index({ isActive: 1, validTo: 1 });

module.exports = mongoose.model('EptoFreshCoupon', eptoFreshCouponSchema);
