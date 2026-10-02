// ============================================
// EPTOMART EXPRESS — Product Model
// Two kinds of product live in this one collection:
//   1. Koyambedu-linked — koyambeduProduct is set; name/description/images/
//      category always come from the linked KoyambeduProduct, live, via
//      populate. Never denormalized/copied onto this document.
//   2. Native — koyambeduProduct is absent. Everything (name, description,
//      image, category, optional combo contents) lives directly on this
//      document instead. Created by the Express admin from inside Express
//      (Admin -> Create Product/Combo), and NEVER touches Koyambedu Daily's
//      catalog, product-create endpoints, or collection in any way — these
//      products/combos exist only within Express.
// Either way, everything Express actually owns and manages independently
// is here: procurement cost, unit-of-sale for logistics costing, and
// margin overrides. Per-store availability/stock is separate again, in
// ExpressStoreProduct.
// ============================================
const mongoose = require('mongoose');
const { Schema } = mongoose;

const expressProductSchema = new mongoose.Schema({
  // The Koyambedu Daily product this Express listing displays as, when
  // linked (see header comment). Optional — absent entirely for native
  // Express-only products, never explicitly null (see the unique index
  // below, which is sparse: a sparse index only skips documents where the
  // field is truly ABSENT, not ones storing an explicit null — the exact
  // bug fixed for `plu` elsewhere in this file, so the same rule applies
  // here: omit the key for native products, never set it to null).
  koyambeduProduct: { type: mongoose.Schema.Types.ObjectId, ref: 'KoyambeduProduct' },

  // ── Native-product fields (Express's own, Koyambedu-independent) ──────
  // Only populated when koyambeduProduct is absent. Kept separate rather
  // than reusing Koyambedu's schema/collection so Express's self-service
  // product/combo creation never has any write (or even indirect) access
  // to Koyambedu Daily's catalog.
  name:        { type: String, trim: true, default: null },
  description: { type: String, default: '' },
  image:       { type: String, default: null },
  // Free-text, Express-only grouping — intentionally not a ref to
  // KoyambeduCategory, which would reintroduce a Koyambedu dependency.
  category:    { type: String, trim: true, default: null },

  // A combo bundles several OTHER ExpressProducts (native or Koyambedu-
  // linked, either is fine) under one purchasable item. comboContents is
  // informational/display-only — shown to the customer and to procurement/
  // stock planning; it does not affect pricing (the combo has its own
  // price via ExpressOnlineListing, same as any other product) or deduct
  // stock from the component products automatically.
  isCombo: { type: Boolean, default: false },
  comboContents: {
    type: [{
      product: { type: Schema.Types.ObjectId, ref: 'ExpressProduct' },
      name:    { type: String, required: true }, // snapshot at selection time
      unit:    { type: String, required: true },
      qty:     { type: Number, required: true, min: 0 },
    }],
    default: [],
  },

  // How Express prices/sells this product — independent of however
  // Koyambedu Daily prices the same underlying product.
  unit: {
    type: String,
    enum: ['kg', 'gram', 'piece', 'bunch', 'litre', 'dozen'],
    required: true,
  },
  isWeightBased: { type: Boolean, default: true },
  // Only relevant when unit === 'bunch' (or any non-weight unit that still
  // needs a weight-equivalent for logistics-cost distribution).
  // e.g. 10 bunches of coriander = 1 kg  ->  unitsPerKg = 10
  unitsPerKg: { type: Number, default: null },
  // Smallest quantity a customer can order/add in one step — admin-set per
  // product (e.g. radish can only be ordered starting from 0.25 kg). The
  // customer-facing stepper (ExpressShop.jsx) starts the "Add" action at
  // this quantity and increments/decrements by it from then on, replacing
  // what used to be one hardcoded 250g/500g/1kg set for every kg product.
  // Only meaningful for isWeightBased (kg/gram/litre-style) products —
  // piece/dozen/bunch-style items always step by whole units regardless of
  // this value. Default 0.25 preserves the previous global behaviour
  // (250 g minimum) for every product saved before this field existed.
  minOrderQty: { type: Number, default: 0.25, min: 0.01 },
  // Admin-entered procurement cost, per kg (or per unit for non-weight items
  // that don't have a unitsPerKg conversion, e.g. price per piece)
  procurementBaseCost: { type: Number, required: true, min: 0 },
  // Optional product-specific margin override (section 3) — replaces the
  // default platform-charge percentage from ExpressMarginConfig for this
  // product only. Null = use the global default.
  customMarginPct: { type: Number, default: null, min: 0, max: 500 },
  isActive: { type: Boolean, default: true },

  // Quick-entry code for the POS terminal — a 3-digit PLU-style code so the
  // POS operator can type a number instead of searching by name. Auto-
  // assigned when the product is linked into Express, based on the linked
  // KoyambeduProduct's category: 100-199 for Vegetables, 200-299 for
  // Fruits. Products in any other category (or where the category can't be
  // confidently matched) get no code and can have one assigned manually
  // by admin later (see adminSetProductPlu). Null = no code assigned.
  // No `default: null` here on purpose — the unique index below is sparse,
  // which only skips documents where the field is entirely ABSENT, not
  // documents that explicitly store `plu: null`. Giving this a default of
  // null would mean every product with no detected PLU series ends up with
  // the field present-and-null, and the second such product collides with
  // the first on the unique index (E11000 duplicate key: { plu: null }).
  // Always omit the key (or use $unset) rather than assigning null — see
  // resolveExpressProduct/createProduct/adminSetProductPlu.
  plu: { type: Number, min: 100, max: 299 },
}, { timestamps: true });

expressProductSchema.index({ isActive: 1 });
expressProductSchema.index({ plu: 1 }, { unique: true, sparse: true });
// Sparse, not inline `unique: true` — koyambeduProduct is now optional
// (native products omit it entirely), so this must only enforce uniqueness
// among documents that actually have the field set.
expressProductSchema.index({ koyambeduProduct: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('ExpressProduct', expressProductSchema);
