// ============================================
// KOYAMBEDU PROCUREMENT CHECKLIST
// One document per (cutoffCycle date + product/grade) line item in the
// SuperAdmin's Procurement Report. Lets SuperAdmin mark an aggregated
// product line as "purchased" and leave a comment, without touching any
// order or product data. Purely additive — no other feature reads or
// depends on this collection.
// ============================================
const mongoose = require('mongoose');
const { Schema } = mongoose;

const koyambeduProcurementChecklistSchema = new Schema({
  // Procurement cycle date, "YYYY-MM-DD" (same convention as getProcurementCycle)
  cycle:       { type: String, required: true },

  // Composite identity of the aggregated report row this checklist entry belongs to.
  // productKey mirrors the report's grouping key: productId (or name fallback),
  // optionally suffixed with __<gradeKey> for graded products.
  productKey:  { type: String, required: true },
  productName: { type: String },
  gradeKey:    { type: String, default: null },
  gradeName:   { type: String, default: null },

  purchased:      { type: Boolean, default: false },
  purchasedBy:    { type: Schema.Types.ObjectId, ref: 'User' },
  purchasedByName:{ type: String },
  purchasedAt:    { type: Date },

  comment:        { type: String, default: '' },
  commentBy:      { type: Schema.Types.ObjectId, ref: 'User' },
  commentByName:  { type: String },
  commentAt:      { type: Date },
}, { timestamps: true });

koyambeduProcurementChecklistSchema.index({ cycle: 1, productKey: 1 }, { unique: true });

module.exports = mongoose.model('KoyambeduProcurementChecklist', koyambeduProcurementChecklistSchema);
