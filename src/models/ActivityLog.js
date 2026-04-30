// ============================================
// ACTIVITY LOG MODEL
// ============================================
const mongoose = require('mongoose');

const activityLogSchema = new mongoose.Schema({
  actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  actorName: String,
  actorRole: String,
  action: { type: String, required: true }, // e.g. 'order.status_updated', 'product.approved'
  entity: String,      // 'order' | 'product' | 'seller' | 'user' | 'category'
  entityId: String,    // The ID of the affected document
  entityLabel: String, // Human-readable label e.g. "Order #EPT12345"
  details: mongoose.Schema.Types.Mixed, // any extra data { from, to, note }
  ip: String,
}, { timestamps: true });

activityLogSchema.index({ actor: 1, createdAt: -1 });
activityLogSchema.index({ entity: 1, entityId: 1 });
activityLogSchema.index({ createdAt: -1 });

module.exports = mongoose.model('ActivityLog', activityLogSchema);
