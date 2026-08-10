// ============================================
// KOYAMBEDU PURCHASE MODEL
// Records what the business actually bought — either fresh produce (linked to
// a live KoyambeduProduct, for COGS/profit accounting) or a non-produce item
// like packing materials/consumables (free-text name, tracked for stock +
// cost but excluded from item-wise produce profit). Purely additive — does
// NOT touch checkout, cart, order placement, or stock-validation logic.
// ============================================
const mongoose = require('mongoose');
const { Schema } = mongoose;

const koyambeduPurchaseSchema = new Schema({
  // Purchase/business date this stock belongs to (admin-set, defaults to entry day)
  purchaseDate: { type: Date, required: true, default: Date.now },

  // 'produce'          → product ref required, name/category auto-populated from it
  // 'packing_material' → free-text itemName (bags, boxes, tape, labels, etc.)
  // 'other'            → free-text itemName (anything else worth costing)
  itemType: { type: String, enum: ['produce', 'packing_material', 'other'], default: 'produce' },

  // Product being purchased (produce only). Kept as a reference for joins, but
  // name/category are snapshotted below so historical purchase records stay
  // accurate even if the product is later renamed, re-categorized, or deleted.
  product:      { type: Schema.Types.ObjectId, ref: 'KoyambeduProduct', default: null },
  // Display name — for produce this mirrors the product's name (auto-filled
  // server-side); for packing_material/other, admin enters it directly.
  itemName:     { type: String, required: true, trim: true },
  // Snapshot of the real KoyambeduCategory name for produce (auto-populated);
  // 'Packing Material' / 'Other' for non-produce entries.
  category:     { type: String, default: '' },
  unit:         { type: String, default: 'kg' },

  // Vendor purchased from — optional registered KoyambeduSeller, or a free-text
  // name for open-market/mandi/shop purchases not tied to a system seller account.
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

  // Optional bill/receipt photo or PDF — purely optional, admin can attach later.
  billUrl:      { type: String, default: '' },
  billPublicId: { type: String, default: '' },

  notes:        { type: String, trim: true },

  enteredBy:    { type: Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });

koyambeduPurchaseSchema.index({ product: 1, purchaseDate: 1 });
koyambeduPurchaseSchema.index({ purchaseDate: 1 });
koyambeduPurchaseSchema.index({ seller: 1, purchaseDate: 1 });
koyambeduPurchaseSchema.index({ itemType: 1, purchaseDate: 1 });

// Keep totalCost in sync even if a caller forgets to compute it.
koyambeduPurchaseSchema.pre('save', function (next) {
  const qty = Number(this.quantity) || 0;
  const cost = Number(this.costPricePerUnit) || 0;
  this.totalCost = Math.round(qty * cost * 100) / 100;
  next();
});

module.exports = mongoose.model('KoyambeduPurchase', koyambeduPurchaseSchema);
