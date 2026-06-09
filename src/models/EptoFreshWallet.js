// ============================================
// EPTOFRESH WALLET MODEL
// Customer wallet credits
// ============================================
const mongoose = require('mongoose');
const { Schema } = mongoose;

const eptoFreshWalletSchema = new Schema({
  user:    { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  balance: { type: Number, default: 0, min: 0 },

  transactions: [{
    type:        { type: String, enum: ['credit', 'debit'] },
    amount:      Number,
    description: String,
    order:       { type: Schema.Types.ObjectId, ref: 'EptoFreshOrder' },
    createdAt:   { type: Date, default: Date.now },
    balance:     Number, // balance after this txn
  }],

}, { timestamps: true });

eptoFreshWalletSchema.index({ user: 1 });

module.exports = mongoose.model('EptoFreshWallet', eptoFreshWalletSchema);
