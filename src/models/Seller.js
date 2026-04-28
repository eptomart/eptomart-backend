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

  gstNumber: { type: String, uppercase: true, trim: true },
  panNumber: { type: String, uppercase: true, trim: true },

  bankDetails: {
    accountNumber: String,
    ifscCode:      String,
    bankName:      String,
    accountHolder: String,
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
