// ============================================
// EPTOMART EXPRESS — Audit Log Model
// Section 22: every operational action (store/product toggles, inventory
// allocation, manager/POS activity) recorded here so Admin has a full trail.
// Deliberately generic/append-only — never updated or deleted.
// ============================================
const mongoose = require('mongoose');

const expressAuditLogSchema = new mongoose.Schema({
  actorType: { type: String, enum: ['admin', 'store_manager', 'pos_user', 'system'], required: true },
  actorName: { type: String, required: true },
  action: { type: String, required: true }, // e.g. 'store.toggle', 'product.toggle', 'inventory.allocate'
  store: { type: mongoose.Schema.Types.ObjectId, ref: 'ExpressStore', default: null },
  meta: { type: mongoose.Schema.Types.Mixed, default: {} }, // free-form extra detail (productId, orderId, etc.)
}, { timestamps: true });

expressAuditLogSchema.index({ store: 1, createdAt: -1 });
expressAuditLogSchema.index({ action: 1, createdAt: -1 });

module.exports = mongoose.model('ExpressAuditLog', expressAuditLogSchema);
