const mongoose = require('mongoose');

const expenseCategorySchema = new mongoose.Schema({
  name:        { type: String, required: true, unique: true, trim: true, maxlength: 80 },
  description: { type: String, maxlength: 300 },
  icon:        { type: String, default: '💰' },
  isActive:    { type: Boolean, default: true },
  isDefault:   { type: Boolean, default: false },
  createdBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

module.exports = mongoose.model('ExpenseCategory', expenseCategorySchema);
