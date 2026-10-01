// ============================================
// KOYAMBEDU PROCURER
// A small maintained list of names that show up in the "Procured By"
// dropdown on the P&L tab, so admin picks a name instead of retyping it
// for every single product/bill. Names are added once (the first time
// someone types a new one) and reused forever after. Purely additive —
// no other feature reads or depends on this collection.
// ============================================
const mongoose = require('mongoose');
const { Schema } = mongoose;

const koyambeduProcurerSchema = new Schema({
  name: { type: String, required: true, unique: true, trim: true },
  addedBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

module.exports = mongoose.model('KoyambeduProcurer', koyambeduProcurerSchema);
