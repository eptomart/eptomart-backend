// ============================================
// KOYAMBEDU SELLER MODEL
// Status flow: pending_review → approved | rejected | suspended
// Only SuperAdmin can approve/reject sellers.
// SellerAdmin can create sellers (status starts pending_review).
// ============================================
const mongoose = require('mongoose');
const { Schema } = mongoose;

const koyambeduSellerSchema = new Schema({
  // Linked Eptomart user account (optional — seller may not have an Eptomart account yet)
  user: { type: Schema.Types.ObjectId, ref: 'User', default: null, sparse: true },

  // Business identity
  businessName:   { type: String, required: true, trim: true },
  ownerName:      { type: String, required: true, trim: true },
  stallNumber:    { type: String, trim: true },
  marketSection:  { type: String, trim: true },

  // Contact (PRIVATE — never exposed to buyers or SellerAdmin)
  contact: {
    phone:    { type: String, trim: true },
    email:    { type: String, lowercase: true, trim: true },
    altPhone: { type: String, trim: true },
  },

  // Categories this seller deals in
  productTypes: [{
    type: String,
    enum: ['vegetables','fruits','flowers','greens','coconut','banana_leaves','pooja_items','seasonal','bulk'],
  }],

  // ── 4-state status (replaces isApproved boolean) ──────────
  status: {
    type: String,
    enum: ['pending_review', 'approved', 'rejected', 'suspended'],
    default: 'pending_review',
  },
  isActive:       { type: Boolean, default: true }, // soft enable/disable without changing status
  approvedBy:     { type: Schema.Types.ObjectId, ref: 'User' },
  approvedAt:     Date,
  rejectedReason: String,

  // ── Seller hierarchy ──────────────────────────────────────
  // If a SellerAdmin created this seller, store the ref
  createdBySellerAdmin: { type: Schema.Types.ObjectId, ref: 'KoyambeduSellerAdmin' },

  // Financial
  commissionRate:  { type: Number, default: 8 },  // %
  bankDetails: {
    accountName:   String,
    accountNumber: String,
    ifsc:          String,
    bankName:      String,
    upiId:         String,
    isVerified:    { type: Boolean, default: false },
  },
  totalEarnings:  { type: Number, default: 0 },
  pendingPayout:  { type: Number, default: 0 },
  totalSettled:   { type: Number, default: 0 },

  // Delivery availability
  offersSameDay:  { type: Boolean, default: true },
  offersNextDay:  { type: Boolean, default: true },
  sameDayCutoff:  { type: String, default: '10:00' },

  // Ratings
  rating:      { type: Number, default: 0, min: 0, max: 5 },
  ratingCount: { type: Number, default: 0 },

  // Description / about
  description:  String,
  profileImage: String,

  // WhatsApp notification preference
  notifyWhatsApp: { type: Boolean, default: true },

  // ── Pending edit submitted by SellerAdmin ─────────────────
  // SellerAdmin proposes changes; SuperAdmin approves/rejects before going live
  pendingEdit: {
    ownerName:     String,
    businessName:  String,
    stallNumber:   String,
    marketSection: String,
    description:   String,
    contact: {
      phone:    String,
      email:    String,
      altPhone: String,
    },
    submittedAt: Date,
    submittedBy: { type: Schema.Types.ObjectId, ref: 'KoyambeduSellerAdmin' },
  },

}, { timestamps: true });

// Convenience virtual — allows `seller.isApproved` in non-lean code
koyambeduSellerSchema.virtual('isApproved').get(function () {
  return this.status === 'approved';
});

koyambeduSellerSchema.index({ user: 1 });
koyambeduSellerSchema.index({ status: 1, isActive: 1 });
koyambeduSellerSchema.index({ productTypes: 1 });
koyambeduSellerSchema.index({ createdBySellerAdmin: 1 });

module.exports = mongoose.model('KoyambeduSeller', koyambeduSellerSchema);
