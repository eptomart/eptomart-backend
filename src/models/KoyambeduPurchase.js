// ============================================
// KOYAMBEDU PURCHASE MODEL
// Records what the business actually bought at the Koyambedu market (or from
// a registered seller/vendor) for a given day — quantity + cost price.
// This is the COGS (cost of goods sold) source of truth, completely separate
// from KoyambeduProduct's customer-facing sell price. Purely additive — does
// NOT touch checkout, cart, order placement, or stock-validation logic.
// ============================================
const mongoose = require('mongoose');
const { Schema } = mongoose;

const koyambeduPurchaseSchema = new Schema({
  // Purchase/business date this stock belongs to (admin-set, defaults to entry day)
  purchaseDate: { type: Date, required: true, default: Date.now },

  // Product being purchased. Kept as a reference for joins, but name/unit/category
  // are snapshotted below so historical purchase records stay accurate even if the
  // product is later renamed, re-categorized, or deleted.
  product:      { type: Schema.Types.ObjectId, ref: 'KoyambeduProduct', required: true },
  productName:  { type: String, required: true, trim: true },
  category:     { type: String, enum: ['fruit', 'vegetable', 'other'], default: 'vegetable' },
  unit:         { type: String, default: 'kg' },

  // Vendor purchased from — optional registered KoyambeduSeller, or a free-text
  // name for open-market/mandi purchases not tied to a system seller account.
  seller:       { type: Schema.Types.ObjectId, ref: 'KoyambeduSeller', default: null },
  sellerName:   { type: String, trim: true }, // snapshot / free-text fallback

  // Quantity + cost
  quantity:          { type: Number, required: true, min: 0 },
  costPricePerUnit:  { type: Number, required: true, min: 0 },
  totalCost:         { type: Number, required: true, min: 0 }, // = quantity * costPricePerUnit

  // Optional trip-level charges attributable to this specific purchase line
  // (kept separate from per-order transport/packing charges in KoyambeduOrder.adminCosts).
  transportCharge:   { type: Number, default: 0 },
  loadingCharge:      { type: Number, default: 0 },

  notes:        { type: String, trim: true },

  enteredBy:    { type: Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });

koyambeduPurchaseSchema.index({ product: 1, purchaseDate: 1 });
koyambeduPurchaseSchema.index({ purchaseDate: 1 });
koyambeduPurchaseSchema.index({ seller: 1, purchaseDate: 1 });

// Keep totalCost in sync even if a caller forgets to compute it.
koyambeduPurchaseSchema.pre('save', function (next) {
  const qty = Number(this.quantity) || 0;
  const cost = Number(this.costPricePerUnit) || 0;
  this.totalCost = Math.round(qty * cost * 100) / 100;
  next();
});

module.exports = mongoose.model('KoyambeduPurchase', koyambeduPurchaseSchema);
