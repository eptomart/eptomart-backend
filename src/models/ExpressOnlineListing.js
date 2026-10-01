// ============================================
// EPTOMART EXPRESS — Online Listing (per-store "show this online?" + price)
// ============================================
// Deliberately separate from ExpressStoreProduct (which is the physical
// stock/availability record used by the Store Manager dashboard and the POS
// terminal). This model answers one question only: "for this store, should
// this Koyambedu Daily product appear in the Express online shop, and at
// what price?" — an admin-curation decision, independent of whether the
// store currently has physical stock of it. Keeping it a separate
// collection means toggling a product online never touches, and is never
// touched by, the manager/POS inventory system.
//
// Every active Koyambedu Daily product is implicitly a CANDIDATE for every
// store (there is no "link into Express" step to do first) — a document
// here only needs to exist once an admin actually makes a decision for that
// store+product pair. No document = not shown online (same as isEnabled:false).
const mongoose = require('mongoose');
const { Schema } = mongoose;

const expressOnlineListingSchema = new Schema({
  store:            { type: Schema.Types.ObjectId, ref: 'ExpressStore', required: true },
  koyambeduProduct: { type: Schema.Types.ObjectId, ref: 'KoyambeduProduct', required: true },
  // Resolved/auto-created the first time this is enabled — lets the online
  // shop and the existing (unmodified) Express cart/checkout pipeline work
  // against the same ExpressProduct id they always have. Null until then.
  product:          { type: Schema.Types.ObjectId, ref: 'ExpressProduct', default: null },
  isEnabled:        { type: Boolean, default: false },
  // Admin-set online selling price for THIS store. Independent of both the
  // Koyambedu Daily price (shown to admin only as a wholesale reference)
  // and ExpressStoreProduct.priceOverride (the POS/manager-facing price).
  price:            { type: Number, default: null, min: 0 },
  updatedBy:        { type: Schema.Types.ObjectId, ref: 'User' },
  updatedAt:        Date,
}, { timestamps: true });

expressOnlineListingSchema.index({ store: 1, koyambeduProduct: 1 }, { unique: true });
expressOnlineListingSchema.index({ store: 1, isEnabled: 1 });

module.exports = mongoose.model('ExpressOnlineListing', expressOnlineListingSchema);
