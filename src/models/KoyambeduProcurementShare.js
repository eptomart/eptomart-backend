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
}, { timestamps: true });

module.exports = mongoose.model('KoyambeduProcurementShare', koyambeduProcurementShareSchema);
