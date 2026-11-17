// One payment line in the P&L day ledger: a loadman or transport payment
// for a cutoff cycle, who paid it (name kept as text so deleting a name
// from the list never rewrites history) and optionally who received it.
const mongoose = require('mongoose');
const { Schema } = mongoose;

const schema = new Schema({
  cycle:  { type: String, required: true, index: true },        // "YYYY-MM-DD"
  kind:   { type: String, enum: ['loadman', 'transport', 'misc'], required: true },
  // misc only: Stationery, Packing material, Fuel, Food & tea, Repairs, Other…
  category: { type: String, default: '', trim: true },
  amount: { type: Number, required: true, min: 0 },
  paidBy: { type: String, default: '', trim: true },
  paidTo: { type: String, default: '', trim: true },
  note:   { type: String, default: '', trim: true },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

module.exports = mongoose.model('KoyambeduDayExpense', schema);
