// ============================================
// EPTOFRESH PRODUCT MODEL
// Meat / Poultry / Seafood products
// ============================================
const mongoose = require('mongoose');
const { Schema } = mongoose;

const weightVariantSchema = new Schema({
  weight:    { type: Number, required: true },   // in grams
  label:     { type: String, required: true },   // '500g', '1kg'
  price:     { type: Number, required: true },
  mrp:       { type: Number },
  stock:     { type: Number, default: 0 },
  isAvailable:{ type: Boolean, default: true },
}, { _id: true });

const eptoFreshProductSchema = new Schema({
  seller:     { type: Schema.Types.ObjectId, ref: 'EptoFreshSeller', required: true },

  name:       { type: String, required: true, trim: true },
  nameLocal:  { type: String, trim: true },   // Tamil / local name
  slug:       { type: String, lowercase: true, trim: true },

  category: {
    type: String,
    enum: ['chicken', 'mutton', 'fish', 'seafood', 'beef', 'pork', 'ready_to_cook'],
    required: true,
  },

  subCategory: { type: String, trim: true },   // e.g. 'whole', 'boneless', 'liver'
  description: { type: String, trim: true },

  // Cut types (seller selects applicable)
  cutTypes: [{
    type: String,
    enum: ['whole', 'curry_cut', 'boneless', 'keema', 'half', 'quarter', 'leg', 'breast', 'liver', 'gizzard', 'other'],
  }],

  // Weight variants (each has its own price and stock)
  variants: [weightVariantSchema],

  // Base price (for display; actual price is from variants)
  basePrice:  { type: Number, default: 0 },
  unit:       { type: String, default: 'kg' },

  // Today's live pricing (seller updates daily)
  todayPrice: { type: Number },
  priceUpdatedAt: Date,

  // Stock
  stock:       { type: Number, default: 0 },
  unit2:       { type: String, default: 'kg' }, // stock unit
  isInStock:   { type: Boolean, default: true },
  lowStockThreshold: { type: Number, default: 0.5 }, // kg

  // Images
  images: [{ url: String, publicId: String, isPrimary: { type: Boolean, default: false } }],

  // Freshness tags
  tags: {
    cutToOrder:   { type: Boolean, default: false },
    freshToday:   { type: Boolean, default: false },
    fastDelivery: { type: Boolean, default: false },
  },

  // Status — new products require admin approval
  status: {
    type: String,
    enum: ['pending_approval', 'approved', 'rejected', 'inactive'],
    default: 'pending_approval',
  },
  approvedBy:     { type: Schema.Types.ObjectId, ref: 'User' },
  approvedAt:     Date,
  rejectedReason: String,

  // Ratings
  rating:      { type: Number, default: 0, min: 0, max: 5 },
  ratingCount: { type: Number, default: 0 },

  // HSN code for GST
  hsnCode:    { type: String, default: '0201' },
  gstRate:    { type: Number, default: 0 },   // Most fresh meat is 0% GST

  // Sort order / featured
  sortOrder:  { type: Number, default: 0 },
  isFeatured: { type: Boolean, default: false },

}, { timestamps: true });

// Auto-generate slug
eptoFreshProductSchema.pre('save', function (next) {
  if (this.isModified('name') && !this.slug) {
    this.slug = this.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + Date.now();
  }
  // Auto-update isInStock based on stock
  this.isInStock = this.stock > 0;
  next();
});

eptoFreshProductSchema.index({ seller: 1, status: 1 });
eptoFreshProductSchema.index({ category: 1, status: 1 });
eptoFreshProductSchema.index({ slug: 1 });
eptoFreshProductSchema.index({ 'tags.freshToday': 1 });

module.exports = mongoose.model('EptoFreshProduct', eptoFreshProductSchema);
