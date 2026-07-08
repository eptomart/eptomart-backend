// ============================================
// KOYAMBEDU WALLET MODEL — v2
// Supports positive AND negative balance.
// Positive = customer savings / credits
// Negative = pending recovery (price increase debt)
// ============================================
const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['credit', 'debit'],
    required: true,
  },
  // Extended transaction categories
  category: {
    type: String,
    enum: [
      'order_cancelled',        // full order cancelled
      'item_declined',          // SA declined a product
      'price_adjustment_credit',// actual procurement price was lower → credit
      'price_adjustment_due',   // actual procurement price was higher → debt
      'debt_recovery',          // previous negative balance recovered in new order
      'wallet_applied',         // positive wallet balance applied at checkout
      'cashback',               // promotional cashback
      'manual_credit',          // admin manual credit
      'manual_debit',           // admin manual debit
      'refund_paid',            // bank refund disbursed
      'refund_requested',       // refund reserved (held from available balance)
      'refund_released',        // reservation released on cancel/reject
      'price_revision_credit',  // daily price dropped after order → wallet credit
      'price_revision_debit',   // daily price rose after order → wallet debit (debt)
      'manual',                 // legacy fallback
    ],
    default: 'manual',
  },
  amount:    { type: Number, required: true },
  // Human-readable order ID (e.g. "KBDABC123")
  orderId:   { type: String },
  // ObjectId reference to the order document
  orderRef:  { type: mongoose.Schema.Types.ObjectId, ref: 'KoyambeduOrder' },
  // Product involved (for price adjustment transactions)
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'KoyambeduProduct' },
  productName: { type: String },
  // Admin who triggered the transaction (for manual / procurement invoice)
  adminBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  adminName: { type: String },
  // Running balance AFTER this transaction
  balanceAfter: { type: Number },
  reason:    { type: String },
  note:      { type: String },
  createdAt: { type: Date, default: Date.now },
});

const refundRequestSchema = new mongoose.Schema({
  amount:            { type: Number, required: true },
  status:            { type: String, enum: ['pending', 'confirmed', 'cancelled', 'refunded'], default: 'pending' },
  bankAccountName:   { type: String, required: true },
  bankAccountNumber: { type: String, required: true },
  bankIfsc:          { type: String, required: true },
  bankName:          { type: String },
  adminNote:         { type: String },
  requestedAt:       { type: Date, default: Date.now },
  processedAt:       { type: Date },
});

const walletSchema = new mongoose.Schema({
  user:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  // Can be negative — represents pending debt to recover on next order
  balance:  { type: Number, default: 0 },
  // Amount currently reserved for pending/confirmed refund requests
  // availableBalance = balance - reservedBalance
  reservedBalance: { type: Number, default: 0 },
  transactions:   [transactionSchema],
  refundRequests: [refundRequestSchema],
}, { timestamps: true });

// ── Helpers ─────────────────────────────────────────────
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;

/** Credit the wallet (always allowed — even if currently negative) */
walletSchema.methods.credit = async function(amount, category = 'manual', opts = {}) {
  const amt = r2(amount);
  this.balance = r2(this.balance + amt);
  this.transactions.push({
    type:        'credit',
    category,
    amount:       amt,
    orderId:      opts.orderId,
    orderRef:     opts.orderRef,
    productId:    opts.productId,
    productName:  opts.productName,
    adminBy:      opts.adminBy,
    adminName:    opts.adminName,
    balanceAfter: this.balance,
    reason:       opts.reason,
    note:         opts.note,
  });
  return this.save();
};

/** Debit the wallet — balance MAY go negative (price increase debt) */
walletSchema.methods.debit = async function(amount, category = 'manual', opts = {}) {
  const amt = r2(amount);
  this.balance = r2(this.balance - amt);
  this.transactions.push({
    type:        'debit',
    category,
    amount:       amt,
    orderId:      opts.orderId,
    orderRef:     opts.orderRef,
    productId:    opts.productId,
    productName:  opts.productName,
    adminBy:      opts.adminBy,
    adminName:    opts.adminName,
    balanceAfter: this.balance,
    reason:       opts.reason,
    note:         opts.note,
  });
  return this.save();
};

/**
 * Apply wallet at checkout:
 * - Positive available balance → debit wallet (apply discount), return positive adjustment
 *   (available = balance − reservedBalance; reserved funds are never spent at checkout)
 * - Negative balance → credit wallet (recover debt), return negative adjustment
 * Returns the walletAdjustment amount (positive = customer saves, negative = customer pays extra)
 */
walletSchema.methods.applyAtCheckout = async function(orderRef, orderId) {
  const bal      = r2(this.balance);
  const reserved = r2(this.reservedBalance || 0);

  if (bal === 0) return 0;

  if (bal > 0) {
    // Only spend what is NOT reserved for refund requests
    const available = r2(bal - reserved);
    if (available <= 0) return 0;

    this.balance = r2(bal - available); // balance now equals reservedBalance
    this.transactions.push({
      type:        'debit',
      category:    'wallet_applied',
      amount:       available,
      orderId,
      orderRef,
      balanceAfter: this.balance,
      reason:       'Wallet credit applied at checkout',
    });
    await this.save();
    return available; // positive → reduces order total
  } else {
    // Recover negative balance (debt)
    const debt = r2(Math.abs(bal));
    this.balance = 0;
    this.transactions.push({
      type:        'credit',
      category:    'debt_recovery',
      amount:       debt,
      orderId,
      orderRef,
      balanceAfter: 0,
      reason:       'Pending wallet adjustment recovered in this order',
    });
    await this.save();
    return bal; // negative → increases order total
  }
};

module.exports = mongoose.model('KoyambeduWallet', walletSchema);
