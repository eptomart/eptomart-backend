// ============================================
// EPTOMART EXPRESS — Customer Wallet
// One wallet per customer for Express. Credited when a store declines an
// item (or cancels) and the customer chose "refund to wallet"; spent at
// Express checkout. Balance is never negative (debits are capped).
// ============================================
const mongoose = require('mongoose');
const { Schema } = mongoose;

const txSchema = new Schema({
  type:     { type: String, enum: ['credit', 'debit'], required: true },
  category: { type: String, enum: ['item_declined', 'order_cancelled', 'refund_fallback', 'wallet_applied', 'manual_credit', 'manual_debit'], required: true },
  amount:   { type: Number, required: true, min: 0 },
  orderId:  String,                 // human-readable e.g. EX-1A2B3C4D
  orderRef: { type: Schema.Types.ObjectId, ref: 'ExpressOrder' },
  note:     String,
  balanceAfter: Number,
  at:       { type: Date, default: Date.now },
}, { _id: false });

const expressWalletSchema = new Schema({
  user:    { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  balance: { type: Number, default: 0, min: 0 },
  transactions: { type: [txSchema], default: [] },
}, { timestamps: true });

module.exports = mongoose.models.ExpressWallet || mongoose.model('ExpressWallet', expressWalletSchema);
