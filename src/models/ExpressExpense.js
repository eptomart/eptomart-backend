// ============================================
// EPTOMART EXPRESS — Expense Model
// Miscellaneous business costs the admin logs manually (rent, salaries,
// utilities, vehicle fuel, packaging supplies, etc.) that aren't captured
// anywhere else in the system, so the finance dashboard's profit/loss
// figure can account for them alongside procurement/logistics cost and
// recorded stock losses.
// ============================================
const mongoose = require('mongoose');
const { Schema } = mongoose;

const expressExpenseSchema = new Schema({
  store:    { type: Schema.Types.ObjectId, ref: 'ExpressStore', default: null }, // null = company-wide expense
  category: { type: String, enum: ['rent', 'salary', 'utilities', 'maintenance', 'packaging', 'fuel', 'marketing', 'other'], default: 'other' },
  amount:   { type: Number, required: true, min: 0 },
  note:     { type: String, default: '' },
  date:     { type: Date, default: Date.now }, // when the expense was incurred (may differ from entry date)
  enteredByName: { type: String, required: true },
}, { timestamps: true });

expressExpenseSchema.index({ date: -1 });
expressExpenseSchema.index({ store: 1, date: -1 });

module.exports = mongoose.model('ExpressExpense', expressExpenseSchema);
