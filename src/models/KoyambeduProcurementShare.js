// ============================================
// KOYAMBEDU PROCUREMENT SHARE LOG
// One document per procurement cycle date. Tracks whether the supplier-
// facing procurement list (item + quantity + packing note only — no
// prices, no customer data) has already been shared, so the admin sees
// an "already shared" notice instead of accidentally re-sending a stale
// list. Purely additive tracking — does not gate or block re-sharing.
// ============================================
const mongoose = require('mongoose');
const { Schema } = mongoose;

const koyambeduProcurementShareSchema = new Schema({
  cycle:         { type: String, required: true, unique: true }, // "YYYY-MM-DD"
  shareCount:    { type: Number, default: 0 },
  lastSharedAt:  { type: Date },
  lastSharedBy:  { type: Schema.Types.ObjectId, ref: 'User' },
  lastSharedByName: { type: String },
  lastSharedVia: { type: String, default: '' }, // e.g. 'whatsapp', 'copy'
  // Snapshot of qty shared per product line, so the admin's product list can
  // strike through items that have already been communicated to the supplier
  // in full. Keyed by productKey; overwritten (not accumulated) on each share
  // so it always reflects the latest quantity actually sent.
  items: [{
    productKey: { type: String, required: true },
    qty:        { type: Number, default: 0 },
    _id: false,
  }],
}, { timestamps: true });

module.exports = mongoose.model('KoyambeduProcurementShare', koyambeduProcurementShareSchema);
