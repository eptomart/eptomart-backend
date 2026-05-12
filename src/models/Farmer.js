// ============================================
// FARMER MODEL — Uzhavar Fresh
// ============================================
const mongoose = require('mongoose');

const pickupSlotSchema = new mongoose.Schema({
  day:   { type: String, enum: ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'] },
  start: String, // "06:00"
  end:   String, // "10:00"
}, { _id: false });

const farmerSchema = new mongoose.Schema({
  // Auth — linked to User account OR standalone OTP login
  user:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  name:        { type: String, required: true, trim: true },
  phone:       { type: String, required: true, unique: true },
  language:    { type: String, enum: ['ta', 'en', 'both'], default: 'ta' },

  // Location
  gpsLocation: {
    type:        { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], default: [0, 0] }, // [lng, lat]
  },
  address: {
    village:  String,
    taluk:    String,
    district: String,
    state:    { type: String, default: 'Tamil Nadu' },
    pincode:  String,
  },
  deliveryRadius: { type: Number, enum: [3, 5, 10], default: 5 }, // km

  // Verification docs
  aadhaarNumber:   { type: String, select: false }, // masked in reads
  aadhaarDoc:      String, // Cloudinary URL
  farmProofDoc:    String, // Cloudinary URL
  bankAccount: {
    accountNumber: { type: String, select: false },
    ifsc:          { type: String, select: false },
    bankName:      String,
    accountName:   String,
    verified:      { type: Boolean, default: false },
    bankDoc:       String, // Cloudinary URL — passbook or cancelled cheque (mandatory from registration)
  },

  // Status
  verificationStatus: {
    type:    String,
    enum:    ['pending', 'approved', 'rejected', 'suspended'],
    default: 'pending',
  },
  rejectionReason: String,
  isActive:        { type: Boolean, default: false },
  availableNow:    { type: Boolean, default: false }, // toggle

  // Delivery slots
  deliverySlots: [pickupSlotSchema],

  // Ratings
  ratings: {
    freshness: { total: { type: Number, default: 0 }, count: { type: Number, default: 0 } },
    quality:   { total: { type: Number, default: 0 }, count: { type: Number, default: 0 } },
    delivery:  { total: { type: Number, default: 0 }, count: { type: Number, default: 0 } },
    behaviour: { total: { type: Number, default: 0 }, count: { type: Number, default: 0 } },
    average:   { type: Number, default: 0 },
    count:     { type: Number, default: 0 },
  },

  // Stats
  totalOrders:     { type: Number, default: 0 },
  totalEarnings:   { type: Number, default: 0 },
  acceptanceRate:  { type: Number, default: 100 }, // %

  // FCM push token for notifications
  fcmToken: String,

  createdAt: { type: Date, default: Date.now },
}, { timestamps: true });

// Geo index for nearby farmer queries
farmerSchema.index({ gpsLocation: '2dsphere' });
farmerSchema.index({ 'address.pincode': 1 });
farmerSchema.index({ verificationStatus: 1, isActive: 1 });

module.exports = mongoose.model('Farmer', farmerSchema);
