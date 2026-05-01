const mongoose = require('mongoose');

const sellerSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },

  businessName: { type: String, required: true, trim: true, maxlength: 100 },
  displayName:  { type: String, trim: true },
  description:  { type: String, maxlength: 1000 },
  logo:         { url: String, publicId: String },

  contact: {
    email:   { type: String, lowercase: true, trim: true },
    phone:   String,
    website: String,
  },

  address: {
    street:  { type: String, required: true },
    city:    { type: String, required: true },
    state:   { type: String, required: true },
    pincode: { type: String, required: true },
    country: { type: String, default: 'India' },
    lat:     Number,
    lng:     Number,
    geocodedAt: Date,
  },

  gstNumber:           { type: String, required: [true, 'GST number is required'], uppercase: true, trim: true },
  panNumber:           { type: String, uppercase: true, trim: true },
  fssaiLicenseNumber:  { type: String, trim: true },  // mandatory for food/beverage sellers

  bankDetails: {
    accountNumber: String,
    ifscCode:      String,
    bankName:      String,
    accountHolder: String,
  },

  // KYC documents
  cancelledCheque: { url: String, publicId: String, uploadedAt: Date },
  agreementFile:   { url: String, publicId: String, uploadedAt: Date },   // signed onboarding agreement
  idProof: {
    url: String, publicId: String, uploadedAt: Date,
    docType: { type: String, enum: ['aadhaar', 'pan', 'passport', 'driving_license'], default: 'aadhaar' },
  },
  addressProof: {
    url: String, publicId: String, uploadedAt: Date,
    docType: { type: String, enum: ['utility_bill', 'rental_agreement', 'bank_statement', 'aadhaar', 'passport'], default: 'utility_bill' },
  },
  kycStatus: {
    bankDetailsComplete:  { type: Boolean, default: false },
    chequeUploaded:       { type: Boolean, default: false },
    agreementUploaded:    { type: Boolean, default: false },
    idProofUploaded:      { type: Boolean, default: false },
    addressProofUploaded: { type: Boolean, default: false },
  },

  status: {
    type: String,
    enum: ['active', 'inactive', 'suspended'],
    default: 'inactive',
  },

  rating: {
    average: { type: Number, default: 0, min: 0, max: 5 },
    count:   { type: Number, default: 0 },
  },
  totalSales:  { type: Number, default: 0 },
  totalOrders: { type: Number, default: 0 },

  // Human-readable seller code — auto-assigned on creation
  // Format: EPT-S-0001, EPT-S-0002, …
  sellerId:    { type: String, unique: true, sparse: true },

  notes:       String,
  createdBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  activatedAt: Date,
  suspendedAt: Date,

  // Multiple pickup / warehouse addresses
  pickupAddresses: [
    {
      label:                  { type: String, default: 'Warehouse' }, // e.g. "Main Warehouse", "Outlet 2"
      street:                 { type: String, required: true },
      city:                   { type: String, required: true },
      state:                  { type: String, required: true },
      pincode:                { type: String, required: true },
      country:                { type: String, default: 'India' },
      phone:                  String,
      isDefault:              { type: Boolean, default: false },
      shiprocketLocationName: String,  // cached Shiprocket pickup location name
      // Admin approval flow
      status:                 { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
      adminNote:              String,  // reason if rejected
      reviewedAt:             Date,
      reviewedBy:             { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    }
  ],

  // Shipping configuration
  shipping: {
    freeAbove:      { type: Number, default: 499 },  // free shipping when order ≥ this (₹)
    defaultCharge:  { type: Number, default: 49 },   // flat charge below threshold
  },

  // Commission & margin defaults for this seller
  // (individual products can override these)
  defaultPlatformMargin: { type: Number, default: 10, min: 0, max: 100 }, // % Eptomart takes
  defaultSellerMargin:   { type: Number, default: 20, min: 0, max: 100 }, // % seller targets

  // Payment settlement
  settlement: {
    status:       { type: String, enum: ['pending', 'processing', 'settled'], default: 'pending' },
    lastSettledAt: Date,
    pendingAmount: { type: Number, default: 0 },   // amount due to seller
    heldAmount:    { type: Number, default: 0 },   // on-hold (COD not yet delivered)
  },
}, { timestamps: true });

sellerSchema.index({ status: 1 });
sellerSchema.index({ 'address.pincode': 1 });
// user index created automatically via unique: true in schema

module.exports = mongoose.model('Seller', sellerSchema);
