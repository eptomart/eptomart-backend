// ============================================
// KOYAMBEDU WASTAGE MODEL
// Records spoilage/damage/rejected stock so it can be deducted from the
// inventory balance and costed into the profit & loss report. Purely
// additive — a new read/write surface only; does not touch checkout, cart,
// order placement, or existing stock-validation logic.
// ============================================
const mongoose = require('mongoose');
const { Schema } = mongoose;

const koyambeduWastageSchema = new Schema({
  wastageDate: { type: Date, required: true, default: Date.now },

  product:     { type: Schema.Types.ObjectId, ref: 'KoyambeduProduct', required: true },
  productName: { type: String, required: true, trim: true },
  category:    { type: String, enum: ['fruit', 'vegetable', 'other'], default: 'vegetable' },
  unit:        { type: String, default: 'kg' },

  quantity:    { type: Number, required: true, min: 0 },

  reason: {
    type: String,
    enum: ['spoilage', 'damage', 'quality_reject', 'expired', 'excess_unsold', 'other'],
    default: 'spoilage',
  },
  notes:       { type: String, trim: true },

  // Cost impact is snapshotted at entry time using the weighted-average purchase
  // cost then in effect for this product, so later purchases never retroactively
  // change a historical wastage entry's reported cost.
  costPerUnitAtEntry: { type: Number, default: 0 },
  totalCostImpact:    { type: Number, default: 0 }, // = quantity * costPerUnitAtEntry

  enteredBy:   { type: Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });

koyambeduWastageSchema.index({ product: 1, wastageDate: 1 });
koyambeduWastageSchema.index({ wastageDate: 1 });

koyambeduWastageSchema.pre('save', function (next) {
  const qty = Number(this.quantity) || 0;
  const cost = Number(this.costPerUnitAtEntry) || 0;
  this.totalCostImpact = Math.round(qty * cost * 100) / 100;
  next();
});

module.exports = mongoose.model('KoyambeduWastage', koyambeduWastageSchema);
