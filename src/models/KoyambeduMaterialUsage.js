// ============================================
// KOYAMBEDU MATERIAL USAGE MODEL
// Links a packing-material (or other non-produce) purchase to the specific
// customer order it was consumed for, so packing cost can be traced order by
// order and rolled into that order's overhead in the profit report. Purely
// additive — a new read/write surface only; does not touch checkout, cart,
// order placement, or the existing per-order adminCosts.packingCharge field
// (that flat field remains available for a quick manual estimate; this model
// is for granular, order-linked, material-level tracking).
// ============================================
const mongoose = require('mongoose');
const { Schema } = mongoose;

const koyambeduMaterialUsageSchema = new Schema({
  order:        { type: Schema.Types.ObjectId, ref: 'KoyambeduOrder', required: true },
  orderIdLabel: { type: String, required: true, trim: true }, // snapshot of order.orderId for display/search

  // Which purchase batch this was drawn from (optional — admin may log usage
  // without tying it to a specific purchase entry, e.g. legacy stock).
  purchase:     { type: Schema.Types.ObjectId, ref: 'KoyambeduPurchase', default: null },
  materialName: { type: String, required: true, trim: true },
  unit:         { type: String, default: 'pcs' },

  quantity:     { type: Number, required: true, min: 0 },
  costPerUnit:  { type: Number, default: 0, min: 0 },
  totalCost:    { type: Number, default: 0, min: 0 }, // = quantity * costPerUnit

  usageDate:    { type: Date, required: true, default: Date.now },
  notes:        { type: String, trim: true },

  enteredBy:    { type: Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });

koyambeduMaterialUsageSchema.index({ order: 1 });
koyambeduMaterialUsageSchema.index({ usageDate: 1 });
koyambeduMaterialUsageSchema.index({ purchase: 1 });

koyambeduMaterialUsageSchema.pre('save', function (next) {
  const qty = Number(this.quantity) || 0;
  const cost = Number(this.costPerUnit) || 0;
  this.totalCost = Math.round(qty * cost * 100) / 100;
  next();
});

module.exports = mongoose.model('KoyambeduMaterialUsage', koyambeduMaterialUsageSchema);
