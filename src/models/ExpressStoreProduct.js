// ============================================
// EPTOMART EXPRESS — Store Product (per-store availability + stock) Model
// Links a master ExpressProduct to one ExpressStore with its own ON/OFF
// toggle and stock balance. One document per (store, product) pair.
// ============================================
const mongoose = require('mongoose');

const expressStoreProductSchema = new mongoose.Schema({
  store: { type: mongoose.Schema.Types.ObjectId, ref: 'ExpressStore', required: true },
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'ExpressProduct', required: true },
  // Store Manager's ON/OFF toggle for this product at their store (section 11)
  isAvailable: { type: Boolean, default: true },
  // Super-admin approval before an item goes LIVE ONLINE. Rows created before
  // this feature (or by admin) have no status = approved. An owner adding an
  // item creates it as 'pending'; customers cannot see or buy a pending or
  // rejected item online (counter/POS selling is unaffected).
  approval: {
    status:      { type: String, enum: ['approved', 'pending', 'rejected'], default: undefined },
    requestedAt: { type: Date, default: null },
    decidedAt:   { type: Date, default: null },
    decidedBy:   { type: String, default: null },
    note:        { type: String, default: null },
  },
  // Current stock balance at this store, in the product's base unit
  stockQty: { type: Number, default: 0, min: 0 },
  // Optional per-store selling price override, in ₹ per base unit. When
  // set, this replaces the globally-computed margin price (see
  // expressPricingService.computeSellingPrice) for THIS store only —
  // other stores selling the same ExpressProduct keep using the global
  // margin calculation unless they also have their own override. Null
  // means "use the global computed price", which is the default and
  // preserves all existing pricing behavior.
  priceOverride: { type: Number, default: null, min: 0 },
  // Audit trail for the last ON/OFF flip (section 11 requires who/when)
  lastToggle: {
    isAvailable: { type: Boolean, default: null },
    byName: { type: String, default: null },
    at: { type: Date, default: null },
  },
}, { timestamps: true });

expressStoreProductSchema.index({ store: 1, product: 1 }, { unique: true });
expressStoreProductSchema.index({ store: 1, isAvailable: 1 });

module.exports = mongoose.model('ExpressStoreProduct', expressStoreProductSchema);
