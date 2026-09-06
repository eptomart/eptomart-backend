// ============================================
// EPTOMART EXPRESS — Stock Log Model
// Append-only audit trail of every manual stock movement that isn't a sale:
// admin "Add Stock" (procurement arriving at a store) and Store Manager
// "Report Loss" (wastage/spoilage/damage). Sales-driven deductions already
// happen atomically in expressCustomerController/expressPOSController and
// don't need a separate log entry here — this is specifically for the two
// manual entry points the business needs a report/audit trail for.
// ============================================
const mongoose = require('mongoose');
const { Schema } = mongoose;

const expressStockLogSchema = new Schema({
  store:   { type: Schema.Types.ObjectId, ref: 'ExpressStore', required: true },
  product: { type: Schema.Types.ObjectId, ref: 'ExpressProduct', required: true },
  type:    { type: String, enum: ['addition', 'loss'], required: true },
  qty:     { type: Number, required: true, min: 0.01 },
  previousQty: { type: Number, required: true },
  newQty:      { type: Number, required: true },
  reason:  { type: String, default: null }, // required in practice for 'loss', optional note for 'addition'
  actorType: { type: String, enum: ['admin', 'store_manager'], required: true },
  actorName: { type: String, required: true },

  // Manager acknowledgement — lets the store manager confirm they've
  // physically counted/received a stock addition admin credited to their
  // store. Only meaningful for type:'addition' + actorType:'admin' entries
  // (a manager's own 'loss' entries don't need self-acknowledgement).
  // Defaults to false so it's a purely additive field — every existing log
  // row and every future 'loss' entry is simply never surfaced as pending.
  acknowledged:       { type: Boolean, default: false },
  acknowledgedBy:     { type: Schema.Types.ObjectId, ref: 'ExpressStoreManager', default: null },
  acknowledgedByName: { type: String, default: null },
  acknowledgedAt:     { type: Date, default: null },
}, { timestamps: true });

expressStockLogSchema.index({ store: 1, createdAt: -1 });
expressStockLogSchema.index({ product: 1, createdAt: -1 });
expressStockLogSchema.index({ type: 1 });
expressStockLogSchema.index({ store: 1, type: 1, actorType: 1, acknowledged: 1 });

module.exports = mongoose.model('ExpressStockLog', expressStockLogSchema);
