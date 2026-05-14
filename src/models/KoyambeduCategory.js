// ============================================
// KOYAMBEDU CATEGORY MODEL
// ============================================
const mongoose = require('mongoose');
const { Schema } = mongoose;

const koyambeduCategorySchema = new Schema({
  name:     { type: String, required: true, trim: true },
  nameTamil:{ type: String, trim: true },
  slug:     { type: String, lowercase: true, trim: true },
  icon:     { type: String, default: '🌿' },
  image:    String,
  description: String,

  // Hierarchy
  parent:   { type: Schema.Types.ObjectId, ref: 'KoyambeduCategory', default: null },
  isRoot:   { type: Boolean, default: true },

  // Approval flow: seller creates → admin approves
  createdBy:  { type: Schema.Types.ObjectId, ref: 'KoyambeduSeller' },
  status:     { type: String, enum: ['pending','approved','rejected'], default: 'approved' },
  approvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  approvedAt: Date,
  rejectedReason: String,

  isActive:   { type: Boolean, default: true },
  sortOrder:  { type: Number, default: 0 },
  productCount:{ type: Number, default: 0 },
}, { timestamps: true });

// Auto-slug from name
koyambeduCategorySchema.pre('save', function(next) {
  if (!this.slug) {
    this.slug = this.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }
  if (this.parent) this.isRoot = false;
  next();
});

koyambeduCategorySchema.index({ status: 1, isActive: 1 });
koyambeduCategorySchema.index({ parent: 1 });
koyambeduCategorySchema.index({ slug: 1 });

module.exports = mongoose.model('KoyambeduCategory', koyambeduCategorySchema);
