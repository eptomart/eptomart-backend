// ============================================
// WHATSAPP WEBHOOK CONTROLLER
// Handles Meta Cloud API webhook for inbound messages.
//
// SETUP (one-time):
//   1. Add META_WHATSAPP_WEBHOOK_VERIFY_TOKEN to Render env vars.
//      Choose any random string, e.g. "eptomart_wh_2024_xk9"
//   2. In Meta Developer Dashboard → WhatsApp → Configuration → Webhook:
//      - Callback URL: https://your-backend.onrender.com/api/webhooks/whatsapp
//      - Verify Token: same value as META_WHATSAPP_WEBHOOK_VERIFY_TOKEN
//      - Subscribe to "messages" field
//   3. Click "Verify and Save" — Meta will call GET with a challenge; this
//      controller responds automatically.
//
// ADMIN REPLY:
//   Within 24h of a customer's message, admins can reply with free text.
//   After 24h only approved templates work (see sendWhatsApp.js).
// ============================================
'use strict';

const WhatsAppInboundMessage = require('../models/WhatsAppInboundMessage');
const { sendMetaWhatsApp }   = require('../utils/sendWhatsApp');

// ── GET /api/webhooks/whatsapp — Meta verification challenge ──────────────────
exports.verifyWebhook = (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.META_WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
    console.log('[WhatsApp Webhook] Verification successful');
    return res.status(200).send(challenge);
  }
  console.warn('[WhatsApp Webhook] Verification failed — token mismatch or wrong mode');
  return res.status(403).json({ error: 'Forbidden' });
};

// ── POST /api/webhooks/whatsapp — Receive inbound messages ───────────────────
exports.receiveWebhook = async (req, res) => {
  // Always respond 200 immediately so Meta doesn't retry
  res.status(200).json({ status: 'ok' });

  try {
    const body = req.body;
    if (body.object !== 'whatsapp_business_account') return;

    const entries = body.entry || [];
    for (const entry of entries) {
      const changes = entry.changes || [];
      for (const change of changes) {
        if (change.field !== 'messages') continue;
        const value    = change.value || {};
        const messages = value.messages || [];
        const contacts = value.contacts || [];

        for (const msg of messages) {
          // Skip status updates (delivered/read receipts)
          if (!msg.from || !msg.id) continue;

          // Profile name from contacts array
          const contact     = contacts.find(c => c.wa_id === msg.from);
          const profileName = contact?.profile?.name || '';
          const sentAt      = msg.timestamp ? new Date(Number(msg.timestamp) * 1000) : new Date();

          // Build document based on message type
          const doc = {
            messageId:   msg.id,
            from:        msg.from,
            profileName,
            sentAt,
            type:        msg.type || 'unknown',
          };

          if (msg.type === 'text') {
            doc.text = msg.text?.body || '';
          } else if (msg.type === 'image') {
            doc.mediaId      = msg.image?.id;
            doc.mediaMime    = msg.image?.mime_type;
            doc.mediaCaption = msg.image?.caption;
          } else if (msg.type === 'audio') {
            doc.mediaId   = msg.audio?.id;
            doc.mediaMime = msg.audio?.mime_type;
          } else if (msg.type === 'video') {
            doc.mediaId      = msg.video?.id;
            doc.mediaMime    = msg.video?.mime_type;
            doc.mediaCaption = msg.video?.caption;
          } else if (msg.type === 'document') {
            doc.mediaId   = msg.document?.id;
            doc.mediaMime = msg.document?.mime_type;
            doc.text      = msg.document?.filename;
          } else if (msg.type === 'sticker') {
            doc.mediaId   = msg.sticker?.id;
            doc.mediaMime = msg.sticker?.mime_type;
          } else if (msg.type === 'location') {
            doc.locationLat  = msg.location?.latitude;
            doc.locationLng  = msg.location?.longitude;
            doc.locationName = msg.location?.name;
          } else if (msg.type === 'button') {
            doc.text = msg.button?.text || msg.button?.payload;
          }

          // Upsert — Meta may re-deliver duplicates on webhook failure
          await WhatsAppInboundMessage.findOneAndUpdate(
            { messageId: msg.id },
            { $setOnInsert: doc },
            { upsert: true, new: false }
          );
        }
      }
    }
  } catch (err) {
    console.error('[WhatsApp Webhook] Error processing payload:', err.message);
  }
};

// ── GET /api/koyambedu/admin/whatsapp/messages ───────────────────────────────
// List inbound messages for the admin inbox
exports.listMessages = async (req, res) => {
  const page   = Math.max(1, parseInt(req.query.page)  || 1);
  const limit  = Math.min(100, parseInt(req.query.limit) || 50);
  const unread = req.query.unread === 'true';
  const from   = req.query.from;   // filter by phone number

  const filter = {};
  if (unread)  filter.isRead = false;
  if (from)    filter.from   = from;

  const [messages, total, unreadCount] = await Promise.all([
    WhatsAppInboundMessage.find(filter)
      .sort({ sentAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    WhatsAppInboundMessage.countDocuments(filter),
    WhatsAppInboundMessage.countDocuments({ isRead: false }),
  ]);

  res.json({ success: true, messages, total, pages: Math.ceil(total / limit), unreadCount });
};

// ── PATCH /api/koyambedu/admin/whatsapp/messages/:id/read ────────────────────
exports.markRead = async (req, res) => {
  const msg = await WhatsAppInboundMessage.findByIdAndUpdate(
    req.params.id,
    { isRead: true, readAt: new Date(), readBy: req.user._id },
    { new: true }
  );
  if (!msg) return res.status(404).json({ success: false, message: 'Message not found' });
  res.json({ success: true, message: msg });
};

// ── POST /api/koyambedu/admin/whatsapp/messages/:id/reply ────────────────────
// Reply to an inbound message (only works within Meta's 24-hour customer-service window)
exports.replyToMessage = async (req, res) => {
  const { text } = req.body;
  if (!text?.trim()) return res.status(400).json({ success: false, message: 'Reply text required' });

  const original = await WhatsAppInboundMessage.findById(req.params.id).lean();
  if (!original) return res.status(404).json({ success: false, message: 'Message not found' });

  // Check 24-hour window
  const hoursSince = (Date.now() - new Date(original.sentAt).getTime()) / 3_600_000;
  if (hoursSince > 24) {
    return res.status(400).json({
      success: false,
      message: 'Cannot reply — the 24-hour customer service window has expired. Use a WhatsApp message template instead.',
    });
  }

  // Send free-text reply via Meta Cloud API
  await sendMetaWhatsApp(original.from, text.trim());

  // Update message record
  await WhatsAppInboundMessage.findByIdAndUpdate(req.params.id, {
    repliedAt: new Date(),
    repliedBy: req.user._id,
    replyText: text.trim(),
    isRead: true,
    readAt: new Date(),
    readBy: req.user._id,
  });

  res.json({ success: true, message: 'Reply sent' });
};

// ── DELETE /api/koyambedu/admin/whatsapp/messages (bulk mark-read) ───────────
exports.markAllRead = async (req, res) => {
  await WhatsAppInboundMessage.updateMany({ isRead: false }, {
    isRead: true, readAt: new Date(), readBy: req.user._id,
  });
  res.json({ success: true, message: 'All messages marked as read' });
};
