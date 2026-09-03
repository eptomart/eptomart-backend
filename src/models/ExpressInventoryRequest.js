// ============================================
// EPTOMART EXPRESS — Inventory Request Model
// Section 5: Store Manager requests additional stock; Admin reviews and
// allocates. Approving a request should update ExpressStoreProduct.stockQty
// (handled in the controller, not here).
// ============================================
const mongoose = require('mongoose');

const requestItemSchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'ExpressProduct', required: true },
  requestedQty: { type: Number, required: true, min: 0 },
  // Admin may allocate a different quantity than requested
  allocatedQty: { type: Number, default: null, min: 0 },
}, { _id: false });

const expressInventoryRequestSchema = new mongoose.Schema({
  store: { type: mongoose.Schema.Types.ObjectId, ref: 'ExpressStore', required: true },
  requestedByName: { type: String, required: true }, // ExpressStoreManager.name at time of request
  requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'ExpressStoreManager', required: true },
  items: { type: [requestItemSchema], required: true },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  notes: { type: String, trim: true },
  approvedByName: { type: String, default: null }, // admin name
  approvedAt: { type: Date, default: null },
  rejectionReason: { type: String, default: null },
}, { timestamps: true });

expressInventoryRequestSchema.index({ store: 1, status: 1 });
expressInventoryRequestSchema.index({ createdAt: -1 });

module.exports = mongoose.model('ExpressInventoryRequest', expressInventoryRequestSchema);
