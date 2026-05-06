// ============================================
// CONVERSATION MODEL
// Supports: user ↔ admin  and  seller ↔ admin
// ============================================
const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  senderType: {
    type: String,
    enum: ['participant', 'admin'],
    required: true,
  },
  senderName: { type: String, default: 'Unknown' },
  content:    { type: String, required: true, maxlength: 2000 },
}, { timestamps: true });

const conversationSchema = new mongoose.Schema({
  // Who initiated: user or seller
  participantType: {
    type: String,
    enum: ['user', 'seller'],
    required: true,
  },
  participantId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    // ref is dynamic: User or Seller
  },
  participantName:  { type: String, default: '' },
  participantEmail: { type: String, default: '' },

  subject: { type: String, required: true, maxlength: 200 },

  status: {
    type: String,
    enum: ['open', 'closed'],
    default: 'open',
  },

  messages: [messageSchema],

  // Unread counters
  unreadByAdmin:       { type: Number, default: 0 },
  unreadByParticipant: { type: Number, default: 0 },

  lastMessageAt: { type: Date, default: Date.now },
}, { timestamps: true });

conversationSchema.index({ participantId: 1, participantType: 1 });
conversationSchema.index({ status: 1 });
conversationSchema.index({ lastMessageAt: -1 });

module.exports = mongoose.model('Conversation', conversationSchema);
