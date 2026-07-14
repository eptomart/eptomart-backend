// ============================================
// WHATSAPP INBOUND MESSAGE MODEL
// Stores messages received from customers via Meta WhatsApp Cloud API webhook.
// ============================================
'use strict';

const mongoose = require('mongoose');
const { Schema } = mongoose;

const whatsAppInboundMessageSchema = new Schema({
  // Meta's unique message ID (wamid.xxx…)
  messageId:   { type: String, required: true, unique: true },

  // Sender details
  from:        { type: String, required: true, trim: true },  // phone in E.164 format
  profileName: { type: String, trim: true },                  // WhatsApp display name

  // Message type: text | image | audio | video | document | sticker | location | button | unknown
  type:        { type: String, default: 'text' },

  // Text content (populated for type=text and button click labels)
  text:        { type: String, trim: true },

  // Media (populated for image/audio/video/document/sticker)
  mediaId:     { type: String },   // Meta's media ID (fetch URL with GET /v1/media/{mediaId})
  mediaUrl:    { type: String },   // Fetched download URL (optional — resolve on demand)
  mediaMime:   { type: String },   // e.g. "image/jpeg"
  mediaCaption:{ type: String },   // caption on image/video

  // Location (populated for type=location)
  locationLat: { type: Number },
  locationLng: { type: Number },
  locationName:{ type: String },

  // Timestamp from Meta's webhook payload (when the customer actually sent the message)
  sentAt:      { type: Date, required: true },

  // Admin read tracking
  isRead:      { type: Boolean, default: false },
  readAt:      { type: Date },
  readBy:      { type: Schema.Types.ObjectId, ref: 'User' },

  // Reply tracking
  repliedAt:   { type: Date },
  repliedBy:   { type: Schema.Types.ObjectId, ref: 'User' },
  replyText:   { type: String },   // last reply text sent

}, { timestamps: true });

// Index for admin inbox (latest first, unread first)
whatsAppInboundMessageSchema.index({ sentAt: -1 });
whatsAppInboundMessageSchema.index({ isRead: 1, sentAt: -1 });
whatsAppInboundMessageSchema.index({ from: 1, sentAt: -1 });

module.exports = mongoose.model('WhatsAppInboundMessage', whatsAppInboundMessageSchema);
