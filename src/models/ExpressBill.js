// ============================================
// EPTOMART EXPRESS — POS Bill Model
// Covers spec sections 6, 17 & 18: POS users create bills, can hold up to
// 4 at once, resume held bills, and complete a sale (which is billed and
// reflected in the store's sales records). A bill is "held" the moment
// it's created — completing it is a separate explicit action, and voiding
// frees up a held slot without it ever counting as a sale.
// ============================================
const mongoose = require('mongoose');
const { Schema } = mongoose;

const expressBillSchema = new Schema({
  billNo: { type: String, required: true, unique: true },
  store: { type: Schema.Types.ObjectId, ref: 'ExpressStore', required: true },
  posUser: { type: Schema.Types.ObjectId, ref: 'ExpressPOSUser', required: true },
  posUserName: String,

  customerName: { type: String, default: 'Walk-in Customer' },
  customerPhone: String,

  items: [{
    product:  { type: Schema.Types.ObjectId, ref: 'ExpressProduct', required: true },
    name:     String,
    unit:     String,
    price:    Number,
    quantity: { type: Number, required: true, min: 0.01 },
  }],

  subtotal: { type: Number, default: 0 },
  total:    { type: Number, default: 0 },

  status: { type: String, enum: ['held', 'completed', 'voided'], default: 'held' },
  paymentMethod: { type: String, enum: ['cash', 'upi', 'card', null], default: null },
  completedAt: Date,
}, { timestamps: true });

expressBillSchema.index({ posUser: 1, status: 1 });
expressBillSchema.index({ store: 1, createdAt: -1 });

module.exports = mongoose.model('ExpressBill', expressBillSchema);
