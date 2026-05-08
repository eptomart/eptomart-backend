// ============================================
// FARMER PRODUCT MODEL — Uzhavar Fresh
// Harvest listings valid for up to 10 days
// ============================================
const mongoose = require('mongoose');

const farmerProductSchema = new mongoose.Schema({
  farmer: { type: mongoose.Schema.Types.ObjectId, ref: 'Farmer', required: true },

  // Product info
  name:      { type: String, required: true, trim: true }, // English
  nameTa:    { type: String, trim: true },                 // Tamil
  category:  { type: String, enum: ['vegetable', 'fruit', 'grain', 'herb', 'other'], default: 'vegetable' },
  unit:      { type: String, enum: ['kg', 'gram', 'bunch', 'piece', 'litre'], default: 'kg' },
  image:     String, // Cloudinary URL

  // Pricing & stock
  pricePerUnit:      { type: Number, required: true, min: 0 },
  availableQuantity: { type: Number, required: true, min: 0 },
  minOrderQuantity:  { type: Number, default: 0.5 },
  maxOrderQuantity:  { type: Number, default: 50 },

  // Harvest window
  harvestDate:  { type: Date, required: true },
  expiryDate:   { type: Date }, // auto: harvestDate + 3 days
  deliveryType: { type: String, enum: ['instant', 'scheduled', 'both'], default: 'both' },

  // Delivery slots (day-level: "morning", "evening")
  deliverySlots: [{
    date:  Date,
    slot:  { type: String, enum: ['morning', 'afternoon', 'evening'] },
    limit: { type: Number, default: 20 }, // max orders per slot
    booked:{ type: Number, default: 0 },
  }],

  // Farmer location copy (for geo queries on product level)
  gpsLocation: {
    type:        { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], default: [0, 0] },
  },

  isActive:   { type: Boolean, default: true },
  soldOut:    { type: Boolean, default: false },
}, { timestamps: true });

// Auto-set expiry = harvestDate + 3 days
farmerProductSchema.pre('save', function(next) {
  if (this.isModified('harvestDate') || !this.expiryDate) {
    const d = new Date(this.harvestDate);
    d.setDate(d.getDate() + 3);
    this.expiryDate = d;
  }
  next();
});

farmerProductSchema.index({ gpsLocation: '2dsphere' });
farmerProductSchema.index({ farmer: 1, isActive: 1 });
farmerProductSchema.index({ harvestDate: 1, expiryDate: 1 });
farmerProductSchema.index({ category: 1, isActive: 1 });

module.exports = mongoose.model('FarmerProduct', farmerProductSchema);
