// ============================================
// EPTOFRESH PAYOUT / LEDGER MODEL
// Records every financial transaction per seller
// ============================================
const mongoose = require('mongoose');
const { Schema } = mongoose;

const eptoFreshPayoutSchema = new Schema({
  seller:      { type: Schema.Types.ObjectId, ref: 'EptoFreshSeller', required: true },
  order:       { type: Schema.Types.ObjectId, ref: 'EptoFreshOrder', required: true },
  orderId:     String,

  // Amounts
  orderTotal:        { type: Number, required: true },
  platformFee:       { type: Number, required: true },  // 10%
  gstOnFee:          { type: Number, required: true },  // 18% on platformFee
  totalDeduction:    { type: Number, required: true },  // platformFee + gstOnFee
  sellerReceives:    { type: Number, required: true },  // orderTotal - totalDeduction

  // Status
  status: {
    type: String,
    enum: ['pending', 'processing', 'settled', 'failed', 'on_hold'],
    default: 'pending',
  },

  // Trigger: customer confirms order received
  triggeredAt:  Date,
  settledAt:    Date,
  failedReason: String,

  // Transfer reference (bank/UPI)
  transferRef:  String,
  transferMode: { type: String, enum: ['bank', 'upi', 'manual'] },

  // Processed by admin
  processedBy:  { type: Schema.Types.ObjectId, ref: 'User' },
  adminNote:    String,

}, { timestamps: true });

eptoFreshPayoutSchema.index({ seller: 1, createdAt: -1 });
eptoFreshPayoutSchema.index({ status: 1 });
eptoFreshPayoutSchema.index({ order: 1 });

module.exports = mongoose.model('EptoFreshPayout', eptoFreshPayoutSchema);
