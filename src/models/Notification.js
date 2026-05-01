// ============================================
// IN-APP NOTIFICATION MODEL
// ============================================
const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  user:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  title: { type: String, required: true },
  body:  { type: String, required: true },
  url:   { type: String, default: '/' },
  tag:   { type: String },
  read:  { type: Boolean, default: false, index: true },
}, { timestamps: true });

// Auto-delete notifications older than 60 days
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 24 * 60 * 60 });

module.exports = mongoose.model('Notification', notificationSchema);
