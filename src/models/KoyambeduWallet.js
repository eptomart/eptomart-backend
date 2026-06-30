// ============================================
// KOYAMBEDU WALLET MODEL
// Tracks per-customer wallet balance and transaction history
// Credits: order cancellation, declined items
// Debits: refund payouts (initiated by super admin)
// ============================================
const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  type:        { type: String, enum: ['credit', 'debit'], required: true },
  amount:      { type: Number, required: true },
  reason:      { type: String }, // 'order_cancelled', 'item_declined', 'refund_paid', 'manual'
  orderId:     { type: String }, // human-readable order ID for display
  orderRef:    { type: mongoose.Schema.Types.ObjectId, ref: 'KoyambeduOrder' },
  note:        { type: String },
  createdAt:   { type: Date, default: Date.now },
});

const refundRequestSchema = new mongoose.Schema({
  amount:           { type: Number, required: true },
  status:           { type: String, enum: ['pending', 'confirmed', 'cancelled', 'refunded'], default: 'pending' },
  bankAccountName:  { type: String, required: true },
  bankAccountNumber:{ type: String, required: true },
  bankIfsc:         { type: String, required: true },
  bankName:         { type: String },
  adminNote:        { type: String },
  requestedAt:      { type: Date, default: Date.now },
  processedAt:      { type: Date },
});

const walletSchema = new mongoose.Schema({
  user:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  balance:  { type: Number, default: 0 },
  transactions: [transactionSchema],
  refundRequests: [refundRequestSchema],
}, { timestamps: true });

/** Credit the wallet (cancellation / declined item) */
walletSchema.methods.credit = async function(amount, reason, orderId, orderRef, note) {
  this.balance += amount;
  this.transactions.push({ type: 'credit', amount, reason, orderId, orderRef, note });
  return this.save();
};

/** Debit the wallet (when refund is paid out) */
walletSchema.methods.debit = async function(amount, reason, note) {
  if (this.balance < amount) throw new Error('Insufficient wallet balance');
  this.balance -= amount;
  this.transactions.push({ type: 'debit', amount, reason, note });
  return this.save();
};

module.exports = mongoose.model('KoyambeduWallet', walletSchema);
