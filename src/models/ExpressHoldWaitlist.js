// ============================================
// EPTOMART EXPRESS — Hold Waitlist
// While a store is on hold ("high demand, opening orders again shortly"),
// customers can still browse and build a cart — only checkout is gated.
// Every time a signed-in customer is blocked at checkout because their
// store is paused, we upsert one row here (per store+user, not per
// attempt) so Admin can see exactly who wants to order and call them back
// the moment the store reopens, instead of silently losing that demand.
// ============================================
const mongoose = require('mongoose');

const expressHoldWaitlistSchema = new mongoose.Schema({
  store: { type: mongoose.Schema.Types.ObjectId, ref: 'ExpressStore', required: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  // Denormalized at write time so Admin's list never needs an extra
  // populate/lookup just to show a name and a number to dial.
  name: { type: String, trim: true, default: '' },
  phone: { type: String, trim: true, default: '' },
  // Starts at 0 — always incremented via $inc on write (see
  // recordHoldInterest), so the first attempt correctly lands on 1 rather
  // than 2 (which combining a default of 1 with $inc would have produced).
  attempts: { type: Number, default: 0 },
  lastAttemptAt: { type: Date, default: Date.now },
  cartSummary: [{
    name: String,
    unit: String,
    quantity: Number,
  }],
  estimatedTotal: { type: Number, default: 0 },
  // Admin ticks this off once they've called the customer back — row stays
  // (so there's a record), just visually moved out of the "to call" list.
  calledBack: { type: Boolean, default: false },
  calledBackAt: { type: Date, default: null },
}, { timestamps: true });

expressHoldWaitlistSchema.index({ store: 1, user: 1 }, { unique: true });
expressHoldWaitlistSchema.index({ store: 1, calledBack: 1, lastAttemptAt: -1 });

module.exports = mongoose.models.ExpressHoldWaitlist || mongoose.model('ExpressHoldWaitlist', expressHoldWaitlistSchema);
