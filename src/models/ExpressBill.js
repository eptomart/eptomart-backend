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
  // Offer/discount applied as a % of the order's subtotal (e.g. a festival
  // offer or manager-approved discount) — set by the POS user before
  // completing the sale. discountAmount is stored alongside the % so
  // receipts and reports show the actual ₹ knocked off without recomputing.
  discountPercent: { type: Number, default: 0, min: 0, max: 100 },
  discountAmount:  { type: Number, default: 0 },
  // The final payable total is rounded off to the nearest whole rupee (cash
  // counters don't deal in paise); roundOff records the small +/- difference
  // that rounding introduced, purely for transparency in reports/receipts —
  // it never changes what's actually owed beyond the rounding itself.
  roundOff: { type: Number, default: 0 },
  total:    { type: Number, default: 0 },

  status: { type: String, enum: ['held', 'completed', 'voided'], default: 'held' },
  paymentMethod: { type: String, enum: ['cash', 'upi', 'card', null], default: null },
  completedAt: Date,
}, { timestamps: true });

expressBillSchema.index({ posUser: 1, status: 1 });
expressBillSchema.index({ store: 1, createdAt: -1 });

module.exports = mongoose.model('ExpressBill', expressBillSchema);
