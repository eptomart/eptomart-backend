// ============================================
// SUPPLIER / MANUFACTURER REPOSITORY MODEL
// Tracks manufacturers and suppliers for sourcing
// ============================================
const mongoose = require('mongoose');

const supplierSchema = new mongoose.Schema({
  // Basic info
  name:         { type: String, required: true, trim: true },
  company:      { type: String, trim: true },
  contactName:  { type: String, trim: true },
  phone:        { type: String, trim: true },
  email:        { type: String, trim: true, lowercase: true },
  location:     { type: String, trim: true },  // city / state

  // Social / reference links
  instagramUrl:  { type: String, trim: true },
  youtubeUrl:    { type: String, trim: true },
  websiteUrl:    { type: String, trim: true },
  otherRefUrl:   { type: String, trim: true },  // any other reference link

  // Product / category focus
  productCategories: [String],   // e.g. ['Vegetables', 'Spices']
  productsDescription: String,   // AI-generated or manually entered description

  // CRM status
  status: {
    type: String,
    enum: ['interested', 'not_interested', 'follow_up', 'onboarded', 'rejected'],
    default: 'follow_up',
  },
  followUpDate: Date,

  // Notes / comments
  comments: { type: String, trim: true },
  internalNotes: { type: String, trim: true },  // admin-only notes

  // Who added this entry
  addedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

  // If this supplier is onboarded as a seller
  sellerRef: { type: mongoose.Schema.Types.ObjectId, ref: 'Seller' },

  tags: [String],    // quick filter tags, e.g. ['organic', 'bulk', 'export']
  priority: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },

}, { timestamps: true });

supplierSchema.index({ status: 1 });
supplierSchema.index({ name: 'text', company: 'text', productsDescription: 'text' });

module.exports = mongoose.model('Supplier', supplierSchema);
