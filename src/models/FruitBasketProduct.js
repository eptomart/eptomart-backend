// ============================================
// FRUIT BASKETS & HAMPERS — Basket/Hamper Listing
// Single-vendor catalog managed entirely by Super Admin (no seller
// marketplace here, unlike Koyambedu) — each document is one purchasable
// basket/hamper design.
// ============================================
const mongoose = require('mongoose');

const contentLineSchema = new mongoose.Schema({
  item: { type: String, required: true },  // e.g. "Apple (Premium)"
  qty:  { type: String, required: true },  // free-text, e.g. "4 pcs", "500 g"
}, { _id: false });

const fruitBasketProductSchema = new mongoose.Schema({
  name:        { type: String, required: true, trim: true },
  slug:        { type: String, unique: true, sparse: true, index: true },
  description: { type: String, default: '' },
  images:      { type: [String], default: [] },

  price:          { type: Number, required: true, min: 0 },
  compareAtPrice: { type: Number, default: null }, // optional strikethrough MRP

  contents: { type: [contentLineSchema], default: [] }, // "what's inside" list shown to customer

  occasion: {
    type: String,
    enum: ['birthday', 'anniversary', 'get-well', 'festival', 'congratulations', 'condolence', 'general'],
    default: 'general',
  },

  weightKg: { type: Number, default: null }, // approx gross weight, informational only

  stock:       { type: Number, default: null }, // null = unlimited/made-to-order
  isActive:    { type: Boolean, default: true }, // admin can hide without deleting
  isAvailable: { type: Boolean, default: true }, // temporary out-of-stock toggle

  displayOrder: { type: Number, default: 0 }, // lower = shown first

  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

fruitBasketProductSchema.index({ isActive: 1, isAvailable: 1, displayOrder: 1 });

/** Slugify the name if no slug was provided. Not guaranteed unique on its
 *  own — a numeric suffix is appended by the controller on collision. */
fruitBasketProductSchema.pre('validate', function(next) {
  if (!this.slug && this.name) {
    this.slug = this.name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
  }
  next();
});

module.exports = mongoose.model('FruitBasketProduct', fruitBasketProductSchema);
