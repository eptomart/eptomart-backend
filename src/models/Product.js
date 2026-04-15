// ============================================
// PRODUCT MODEL
// ============================================
const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name: String,
  rating: { type: Number, required: true, min: 1, max: 5 },
  comment: { type: String, maxlength: 500 },
}, { timestamps: true });

const productSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Product name is required'],
    trim: true,
    maxlength: [150, 'Product name too long'],
  },
  slug: {
    type: String,
    unique: true,
    lowercase: true,
  },
  description: {
    type: String,
    required: [true, 'Product description is required'],
    maxlength: [2000, 'Description too long'],
  },
  shortDescription: {
    type: String,
    maxlength: [300, 'Short description too long'],
  },
  price: {
    type: Number,
    required: [true, 'Product price is required'],
    min: [0, 'Price cannot be negative'],
  },
  discountPrice: {
    type: Number,
    min: [0, 'Discount price cannot be negative'],
  },
  currency: {
    type: String,
    default: 'INR',
  },
  stock: {
    type: Number,
    required: [true, 'Stock quantity is required'],
    min: [0, 'Stock cannot be negative'],
    default: 0,
  },
  images: [{
    url: { type: String, required: true },
    publicId: String,
    isDefault: { type: Boolean, default: false },
  }],
  category: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category',
    required: [true, 'Category is required'],
  },
  tags: [String],
  brand: String,
  sku: {
    type: String,
    unique: true,
    sparse: true,
  },
  weight: Number, // in grams
  dimensions: {
    length: Number,
    width: Number,
    height: Number,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  isFeatured: {
    type: Boolean,
    default: false,
  },
  codAvailable: {
    type: Boolean,
    default: true,
  },

  // Multi-vendor fields
  seller:        { type: mongoose.Schema.Types.ObjectId, ref: 'Seller' },
  masterProduct: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },

  // GST
  gstRate:         { type: Number, default: 18, enum: [0, 5, 12, 18, 28] },
  hsnCode:         String,
  priceIncludesGst: { type: Boolean, default: true },

  // Location (for delivery estimation)
  location: {
    city:    String,
    state:   String,
    pincode: String,
    lat:     Number,
    lng:     Number,
  },

  // Approval workflow
  approvalStatus: {
    type: String,
    enum: ['draft', 'pending', 'approved', 'rejected', 'correction_needed'],
    default: 'approved',
  },
  approvalNote:  String,
  approvedBy:    { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  approvedAt:    Date,
  submittedAt:   Date,

  // Insights
  likeCount:        { type: Number, default: 0 },
  repeatBuyerCount: { type: Number, default: 0 },

  reviews: [reviewSchema],
  ratings: {
    average: { type: Number, default: 0 },
    count: { type: Number, default: 0 },
  },
  soldCount: {
    type: Number,
    default: 0,
  },
  metaTitle: String,
  metaDescription: String,
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});

// ─── Virtual: discount percentage ────────────
productSchema.virtual('discountPercent').get(function () {
  if (this.discountPrice && this.price > 0) {
    return Math.round(((this.price - this.discountPrice) / this.price) * 100);
  }
  return 0;
});

// ─── Virtual: effective price ─────────────────
productSchema.virtual('effectivePrice').get(function () {
  return this.discountPrice || this.price;
});

// ─── Auto-generate slug ───────────────────────
productSchema.pre('save', function (next) {
  if (this.isModified('name')) {
    this.slug = this.name
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, '')
      .replace(/\s+/g, '-')
      .trim() + '-' + Date.now().toString().slice(-5);
  }
  next();
});

// ─── Update ratings after review ─────────────
productSchema.methods.updateRatings = function () {
  if (this.reviews.length === 0) {
    this.ratings = { average: 0, count: 0 };
    return;
  }
  const total = this.reviews.reduce((sum, r) => sum + r.rating, 0);
  this.ratings = {
    average: Math.round((total / this.reviews.length) * 10) / 10,
    count: this.reviews.length,
  };
};

// ─── Indexes ─────────────────────────────────
productSchema.index({ name: 'text', description: 'text', tags: 'text' });
productSchema.index({ category: 1 });
// slug index created automatically via unique: true
productSchema.index({ price: 1 });
productSchema.index({ isActive: 1 });
productSchema.index({ isFeatured: 1 });
productSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Product', productSchema);
