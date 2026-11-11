// Maintained list of names for the P&L "Paid by" dropdown on Loadman /
// Transport payments. Separate from KoyambeduProcurer so deleting a name
// here never touches procurement data. Additive only.
const mongoose = require('mongoose');
const { Schema } = mongoose;

const schema = new Schema({
  name: { type: String, required: true, unique: true, trim: true },
  addedBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

module.exports = mongoose.model('KoyambeduExpenseParty', schema);
