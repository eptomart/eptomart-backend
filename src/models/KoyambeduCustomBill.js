// ============================================
// KOYAMBEDU CUSTOM BILL
// Walk-in / manual bills printed from the admin Printer tab ("Custom Print").
// Previously these were printed and forgotten; saving them lets the admin
// review, edit (add more items), reprint and delete them later. Items are
// free-form — the name does NOT have to match a Koyambedu product.
// Standalone collection: nothing else reads or depends on it.
// ============================================
const mongoose = require('mongoose');
const { Schema } = mongoose;

const itemSchema = new Schema({
  name:  { type: String, required: true, trim: true },
  unit:  { type: String, default: '', trim: true },
  qty:   { type: Number, required: true, min: 0 },
  price: { type: Number, required: true, min: 0 },
}, { _id: false });

const customBillSchema = new Schema({
  billNo:       { type: String, required: true, unique: true },
  customerName: { type: String, required: true, trim: true },
  location:     { type: String, default: '', trim: true },
  // Bill date/time as shown on the receipt (admin can back-date).
  billDate:     { type: String, required: true },   // 'YYYY-MM-DD'
  billTime:     { type: String, default: '' },      // 'HH:mm'
  items:        { type: [itemSchema], default: [] },
  total:        { type: Number, default: 0 },
  createdBy:    { type: Schema.Types.ObjectId, ref: 'User' },
  updatedBy:    { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

customBillSchema.index({ createdAt: -1 });
customBillSchema.index({ customerName: 'text', billNo: 'text' });

module.exports = mongoose.models.KoyambeduCustomBill || mongoose.model('KoyambeduCustomBill', customBillSchema);
