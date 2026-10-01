// ============================================
// KOYAMBEDU DAILY EXPENSE
// One document per cutoffCycle date ("YYYY-MM-DD", same convention as
// getProcurementCycle). Holds day-level costs that apply across every
// order for that day rather than to one order specifically — right now
// just the loadman (porter) charge, paid once per day and split across
// that day's confirmed orders by weight/quantity (see adminPnLDay in
// koyambeduController.js). Purely additive — no other feature reads or
// depends on this collection.
// ============================================
const mongoose = require('mongoose');
const { Schema } = mongoose;

const koyambeduDailyExpenseSchema = new Schema({
  cycle: { type: String, required: true, unique: true },

  // Total loadman/porter payment for this day, entered by admin once. The
  // P&L report divides this by the total quantity across that day's
  // confirmed orders to get a per-unit rate, then allocates it to each
  // order/item proportional to its own quantity.
  loadmanCharge: { type: Number, default: 0 },

  // Who actually paid the loadman out of pocket that day (e.g. a staff
  // member fronted the cash, to be reimbursed) — purely informational,
  // shown alongside the charge amount in the P&L day view.
  loadmanPaidBy: { type: String, default: '' },

  updatedAt: Date,
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

module.exports = mongoose.model('KoyambeduDailyExpense', koyambeduDailyExpenseSchema);
