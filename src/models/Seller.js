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
}, { timestamps: true });

sellerSchema.index({ status: 1 });
sellerSchema.index({ 'address.pincode': 1 });
// user index created automatically via unique: true in schema

module.exports = mongoose.model('Seller', sellerSchema);
