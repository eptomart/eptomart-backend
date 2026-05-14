// ============================================
// NOTIFICATION LOG — track every email sent
// ============================================
const mongoose = require('mongoose');

const notificationLogSchema = new mongoose.Schema({
  orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true },
  userId:  { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  type: {
    type: String,
    enum: ['customer_paid', 'customer_delivered', 'seller_new_order'],
    required: true,
  },
  sentTo:  { type: String },   // email address
  status:  { type: String, enum: ['sent', 'failed'], default: 'sent' },
  sentAt:  { type: Date, default: Date.now },
  error:   { type: String },
}, { timestamps: true });

// customer_paid / customer_delivered: one per order — unique on (orderId, type) for those
// seller_new_order: one per seller per order — unique on (orderId, type, sentTo)
notificationLogSchema.index({ orderId: 1, type: 1, sentTo: 1 }, { unique: true });

module.exports = mongoose.model('NotificationLog', notificationLogSchema);
