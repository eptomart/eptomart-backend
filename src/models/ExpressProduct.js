// ============================================
// EPTOMART EXPRESS — Product (master catalogue) Model
// Admin-managed master list of products Express can sell. Per-store
// availability/stock lives separately in ExpressStoreProduct so the same
// master product can be ON in one store and OFF in another.
// ============================================
const mongoose = require('mongoose');

const expressProductSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  category: { type: String, trim: true, default: 'General' },
  image: {
    url: String,
    publicId: String,
  },
  // How the product is priced/sold
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

expressProductSchema.index({ name: 'text' });
expressProductSchema.index({ category: 1, isActive: 1 });

module.exports = mongoose.model('ExpressProduct', expressProductSchema);
