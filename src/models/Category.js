// ============================================
// CATEGORY (DEPARTMENT) MODEL
// ============================================
const mongoose = require('mongoose');

const categorySchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Category name is required'],
    trim: true,
    unique: true,
    maxlength: [50, 'Category name too long'],
  },
  slug: {
    type: String,
    unique: true,
    lowercase: true,
  },
  description: {
    type: String,
    maxlength: [200, 'Description too long'],
  },
  image: {
    url: String,
    publicId: String,
  },
  icon: String, // Emoji or icon class
  parentCategory: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category',
    default: null, // null = top-level category
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  requiresFSSAI: {
    type: Boolean,
    default: false,  // set true for food, beverage, dairy, bakery, etc.
  },
  sortOrder: {
    type: Number,
    default: 0,
  },
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});

// Auto-generate slug from name
categorySchema.pre('save', function (next) {
  if (this.isModified('name')) {
    this.slug = this.name
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, '')
      .replace(/\s+/g, '-')
      .trim();
  }
  next();
});

// Virtual: subcategories
categorySchema.virtual('subcategories', {
  ref: 'Category',
  localField: '_id',
  foreignField: 'parentCategory',
});

// slug index created automatically via unique: true
categorySchema.index({ parentCategory: 1 });

module.exports = mongoose.model('Category', categorySchema);
