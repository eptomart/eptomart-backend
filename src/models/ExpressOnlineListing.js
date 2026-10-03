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
  // Set for a listing of a Koyambedu-linked product; absent (never
  // explicit null — see the index note below) for a listing of a native
  // Express-only product, which is instead keyed by `product` alone.
  koyambeduProduct: { type: Schema.Types.ObjectId, ref: 'KoyambeduProduct' },
  // Resolved/auto-created the first time this is enabled — lets the online
  // shop and the existing (unmodified) Express cart/checkout pipeline work
  // against the same ExpressProduct id they always have. Null until then.
  product:          { type: Schema.Types.ObjectId, ref: 'ExpressProduct', default: null },
  isEnabled:        { type: Boolean, default: false },
  // Admin-set online selling price for THIS store. Independent of both the
  // Koyambedu Daily price (shown to admin only as a wholesale reference)
  // and ExpressStoreProduct.priceOverride (the POS/manager-facing price).
  price:            { type: Number, default: null, min: 0 },
  // Optional "strike-through" maximum price for this store, shown to the
  // customer alongside `price` as a discount (e.g. "MRP ₹50, ₹40 — 20% off")
  // when it's set and genuinely higher than the selling price. Null = no
  // MRP configured, so the item just shows its plain price with no
  // discount badge — this is purely a display feature, never used in any
  // pricing/profit calculation.
  mrp:              { type: Number, default: null, min: 0 },
  updatedBy:        { type: Schema.Types.ObjectId, ref: 'User' },
  updatedAt:        Date,
}, { timestamps: true });

// partialFilterExpression (not plain `sparse`) — for a COMPOUND index,
// `sparse` only skips a document missing ALL of the indexed fields, and
// `store` is always present, so a plain sparse index here would still
// collide every native listing (koyambeduProduct always absent) against
// each other at { store, <missing> }, exactly the plu:null bug elsewhere
// in this codebase, just in compound form. partialFilterExpression avoids
// that by only indexing documents where koyambeduProduct genuinely exists.
expressOnlineListingSchema.index(
  { store: 1, koyambeduProduct: 1 },
  { unique: true, partialFilterExpression: { koyambeduProduct: { $exists: true } } }
);
// Second uniqueness guard, for native listings (no koyambeduProduct at
// all) — one listing per native product per store, keyed by `product`.
expressOnlineListingSchema.index(
  { store: 1, product: 1 },
  { unique: true, partialFilterExpression: { product: { $exists: true } } }
);
expressOnlineListingSchema.index({ store: 1, isEnabled: 1 });

module.exports = mongoose.model('ExpressOnlineListing', expressOnlineListingSchema);
