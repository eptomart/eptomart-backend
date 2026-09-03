// ============================================
// EPTOMART EXPRESS — Product Model
// Express does NOT maintain its own product name/image/description catalog
// — it links to an existing KoyambeduProduct for all of that (single source
// of truth, avoids duplicate/drifting product data entry). Everything
// Express actually owns and manages independently is here: procurement
// cost, unit-of-sale for logistics costing, and margin overrides. Per-store
// availability/stock is separate again, in ExpressStoreProduct.
//
// Reading a KoyambeduProduct's fields does not grant Express any write
// access to Koyambedu Daily's catalog, pricing, or inventory — this is a
// read-only reference for display purposes only.
// ============================================
const mongoose = require('mongoose');

const expressProductSchema = new mongoose.Schema({
  // The Koyambedu Daily product this Express listing displays as — name,
  // description, images and category always come from here, live, via
  // populate. Never denormalized/copied onto this document, so an edit to
  // the Koyambedu product (e.g. a corrected description or new photo)
  // shows up in Express immediately without any re-sync step.
  koyambeduProduct: { type: mongoose.Schema.Types.ObjectId, ref: 'KoyambeduProduct', required: true, unique: true },

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
  // Admin-entered procurement cost, per kg (or per unit for non-weight items
  // that don't have a unitsPerKg conversion, e.g. price per piece)
  procurementBaseCost: { type: Number, required: true, min: 0 },
  // Optional product-specific margin override (section 3) — replaces the
  // default platform-charge percentage from ExpressMarginConfig for this
  // product only. Null = use the global default.
  customMarginPct: { type: Number, default: null, min: 0, max: 500 },
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

expressProductSchema.index({ isActive: 1 });

module.exports = mongoose.model('ExpressProduct', expressProductSchema);
