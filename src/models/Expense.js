const mongoose = require('mongoose');

const expenseSchema = new mongoose.Schema({
  category:    { type: mongoose.Schema.Types.ObjectId, ref: 'ExpenseCategory', required: true },
  title:       { type: String, required: true, trim: true, maxlength: 200 },
  description: { type: String, maxlength: 1000 },
  amount:      { type: Number, required: true, min: 0 },
  date:        { type: Date, required: true, default: Date.now },
  notes:       String,
  receipts:    [String],
  createdBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  updatedBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

expenseSchema.index({ date: -1 });
expenseSchema.index({ category: 1, date: -1 });
expenseSchema.index({ createdBy: 1 });

module.exports = mongoose.model('Expense', expenseSchema);
