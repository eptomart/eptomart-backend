// ============================================
// KOYAMBEDU SELLER MODEL
// ============================================
const mongoose = require('mongoose');
const { Schema } = mongoose;

const koyambeduSellerSchema = new Schema({
  // Linked Eptomart user account
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },

  // Business identity
  businessName:   { type: String, required: true, trim: true },
  ownerName:      { type: String, required: true, trim: true },
  stallNumber:    { type: String, trim: true },
  marketSection:  { type: String, trim: true }, // e.g. "Vegetable Block A", "Flower Wing"

  // Contact (PRIVATE — never exposed to buyers)
  contact: {
    phone:   { type: String, trim: true },
    email:   { type: String, lowercase: true, trim: true },
    altPhone:{ type: String, trim: true },
  },

  // Categories this seller deals in
  productTypes: [{
    type: String,
    enum: ['vegetables','fruits','flowers','greens','coconut','banana_leaves','pooja_items','seasonal','bulk'],
  }],

  // Approval & status
  isApproved:  { type: Boolean, default: false },
  isActive:    { type: Boolean, default: true },
  approvedBy:  { type: Schema.Types.ObjectId, ref: 'User' },
  approvedAt:  Date,
  rejectedReason: String,

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
  totalEarnings:    { type: Number, default: 0 },
  pendingPayout:    { type: Number, default: 0 },
  totalSettled:     { type: Number, default: 0 },

  // Delivery availability
  offersSameDay:    { type: Boolean, default: true },
  offersNextDay:    { type: Boolean, default: true },
  sameDayCutoff:    { type: String, default: '10:00' }, // HH:MM 24h

  // Ratings
  rating:        { type: Number, default: 0, min: 0, max: 5 },
  ratingCount:   { type: Number, default: 0 },

  // Description / about
  description:   String,
  profileImage:  String,

  // WhatsApp notification preference
  notifyWhatsApp: { type: Boolean, default: true },

  createdAt:    { type: Date, default: Date.now },
  updatedAt:    { type: Date, default: Date.now },
}, { timestamps: true });

koyambeduSellerSchema.index({ user: 1 });
koyambeduSellerSchema.index({ isApproved: 1, isActive: 1 });
koyambeduSellerSchema.index({ productTypes: 1 });

module.exports = mongoose.model('KoyambeduSeller', koyambeduSellerSchema);
