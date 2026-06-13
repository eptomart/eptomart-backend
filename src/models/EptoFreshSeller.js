// ============================================
// EPTOFRESH SELLER MODEL
// Hyperlocal meat/poultry/seafood seller
// Status flow: pending_review → approved | rejected | suspended
// ============================================
const mongoose = require('mongoose');
const { Schema } = mongoose;

const eptoFreshSellerSchema = new Schema({
  // Linked Eptomart user account
  user: { type: Schema.Types.ObjectId, ref: 'User', default: null, sparse: true },

  // Business identity
  shopName:    { type: String, required: true, trim: true },
  ownerName:   { type: String, required: true, trim: true },
  sellerCode:  { type: String, unique: true, sparse: true },

  // Contact (PRIVATE — never exposed to customers)
  contact: {
    phone:    { type: String, trim: true },
    email:    { type: String, lowercase: true, trim: true },
    altPhone: { type: String, trim: true },
  },

  // Shop address & GPS location
  address: {
    addressLine1: String,
    addressLine2: String,
    city:         { type: String, default: 'Chennai' },
    state:        { type: String, default: 'Tamil Nadu' },
    pincode:      String,
    landmark:     String,
  },

  // GPS location for proximity search
  location: {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], default: [0, 0] }, // [lng, lat]
  },

  // Categories handled
  categories: [{
    type: String,
    enum: ['chicken', 'mutton', 'fish', 'seafood', 'beef', 'pork', 'ready_to_cook'],
  }],

  // KYC / Compliance
  kyc: {
    panNumber:      { type: String, trim: true },
    panVerified:    { type: Boolean, default: false },
    aadhaarNumber:  { type: String, trim: true },
    aadhaarVerified:{ type: Boolean, default: false },
    gstNumber:      { type: String, trim: true },       // optional
    fssaiNumber:    { type: String, trim: true },        // mandatory
    meatLicenseUrl: String,                              // Cloudinary URL
    aadhaarUrl:     String,
    panUrl:         String,
    fssaiUrl:       String,
  },

  // Bank account for payouts
  bankDetails: {
    accountName:   String,
    accountNumber: String,
    ifsc:          String,
    bankName:      String,
    upiId:         String,
    cancelledChequeUrl: String,
    isVerified:    { type: Boolean, default: false },
  },

  // Approval status
  status: {
    type: String,
    enum: ['pending_review', 'approved', 'rejected', 'suspended', 'deleted'],
    default: 'pending_review',
  },
  isActive:       { type: Boolean, default: true },
  approvedBy:     { type: Schema.Types.ObjectId, ref: 'User' },
  approvedAt:     Date,
  rejectedReason: String,
  suspendReason:  String,

  // Shop status
  isOpen:         { type: Boolean, default: true },    // seller can toggle open/closed
  openingTime:    { type: String, default: '06:00' },
  closingTime:    { type: String, default: '21:00' },

  // Commission
  commissionRate: { type: Number, default: 10 }, // % platform fee
  gstOnCommission:{ type: Number, default: 18 }, // % GST on platform fee

  // Financials
  totalEarnings:  { type: Number, default: 0 },
  pendingPayout:  { type: Number, default: 0 },
  totalSettled:   { type: Number, default: 0 },

  // Ratings
  rating:         { type: Number, default: 0, min: 0, max: 5 },
  ratingCount:    { type: Number, default: 0 },

  // Badges
  badges: {
    verified:     { type: Boolean, default: false },
    topRated:     { type: Boolean, default: false },
    fastDelivery: { type: Boolean, default: false },
  },

  // Media
  shopImage:      String,
  bannerImage:    String,

  // Notification preferences
  notifyWhatsApp: { type: Boolean, default: true },
  notifySMS:      { type: Boolean, default: true },

  // Delivery radius (km) seller is willing to serve
  deliveryRadius: { type: Number, default: 10 },

}, { timestamps: true });

// 2dsphere index for geospatial proximity queries
eptoFreshSellerSchema.index({ location: '2dsphere' });
eptoFreshSellerSchema.index({ status: 1, isActive: 1 });
eptoFreshSellerSchema.index({ categories: 1 });
eptoFreshSellerSchema.index({ user: 1 });

// Virtual
eptoFreshSellerSchema.virtual('isApproved').get(function () {
  return this.status === 'approved';
});

module.exports = mongoose.model('EptoFreshSeller', eptoFreshSellerSchema);
