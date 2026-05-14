// ============================================
// WHATSAPP NOTIFICATIONS — Meta Cloud API
// Free tier: 1,000 conversations / month
//
// ⚠️  IMPORTANT — WHY FREE-TEXT FAILS:
//   Meta blocks ALL business-initiated free-text messages.
//   Free-text ONLY works if the customer messaged YOU first (24h window).
//   Order notifications are always business-initiated → MUST use templates.
//
// REQUIRED ENV VARS (set in Render):
//   META_WHATSAPP_TOKEN           → permanent System User token (never expires)
//   META_WHATSAPP_PHONE_NUMBER_ID → from WhatsApp API Setup page
//   ADMIN_WHATSAPP_PHONE          → your phone (digits only, e.g. 9514519518)
//
// TEMPLATE ENV VARS (set after Meta approves each template):
//   META_WHATSAPP_ORDER_TEMPLATE     → e.g. order_confirmation
//   META_WHATSAPP_PAID_TEMPLATE      → e.g. order_paid
//   META_WHATSAPP_STATUS_TEMPLATE    → e.g. order_status_update
//   META_WHATSAPP_DELIVERED_TEMPLATE → e.g. order_delivered
//   META_WHATSAPP_OTP_TEMPLATE       → e.g. otp_login  (authentication category)
//
// HOW TO CREATE TEMPLATES (one-time, takes ~30 min for Meta to approve):
//   business.facebook.com → WhatsApp Manager → Message Templates → Create
//
//   Template: order_confirmation  (Category: Utility)
//   Body: Your Eptomart order #{{1}} is confirmed! Amount: ₹{{2}} | Payment: {{3}}. Track at eptomart.com/orders 🎉
//
//   Template: order_paid  (Category: Utility)
//   Body: Hi {{1}}! Payment of ₹{{2}} received for order #{{3}} on Eptomart. We're preparing your order 📦
//
//   Template: order_status_update  (Category: Utility)
//   Body: Hi {{1}}, your Eptomart order #{{2}} status: {{3}}. {{4}}
//
//   Template: order_delivered  (Category: Utility)
//   Body: Hi {{1}}, your Eptomart order #{{2}} has been delivered! Total paid: ₹{{3}}. Rate us at eptomart.com/orders 🌟
//
//   Template: otp_login  (Category: Authentication — auto-approved)
//   Body: {{1}} is your Eptomart login OTP. Valid for {{2}} minutes. Do not share.
//
// After each template is approved, add to Render env vars and redeploy.
// ============================================

const https = require('https');

const API_VERSION = 'v21.0';

// ── Normalise phone → E.164 without '+' ────────────────────
const normalisePhone = (phone) => {
  const digits = (phone || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length >= 11 && digits.startsWith('91')) return digits;
  if (digits.length === 10) return `91${digits}`;
  return digits;
};

// ── Core HTTP sender ────────────────────────────────────────
const _postToMeta = (phoneId, token, payload) => {
  return new Promise((resolve) => {
    const body = JSON.stringify(payload);
    const options = {
      hostname: 'graph.facebook.com',
      path:     `/${API_VERSION}/${phoneId}/messages`,
      method:   'POST',
      headers: {
        'Authorization':  `Bearer ${token}`,
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          console.log(`[WhatsApp] ✅ Sent → ${payload.to}`);
          resolve({ success: true, raw: data });
        } else {
          let parsed = {};
          try { parsed = JSON.parse(data); } catch {}
          const code = parsed?.error?.code;
          const msg  = parsed?.error?.message || data;

          const hint =
            code === 190    ? '⚠️  TOKEN EXPIRED — go to Meta Business Settings → System Users → generate new permanent token → update RENDER env var META_WHATSAPP_TOKEN.' :
            code === 131030 ? '⚠️  PHONE NUMBER not on WhatsApp or wrong format. Check number is in E.164 (e.g. 919514519518).' :
            code === 131047 ? '⚠️  FREE-TEXT BLOCKED — customer has not messaged you. You MUST create Meta-approved templates. See comments in sendWhatsApp.js.' :
            code === 132000 ? '⚠️  TEMPLATE not found. Check template name spelling and that it is approved in WhatsApp Manager.' :
            code === 132001 ? '⚠️  TEMPLATE variables mismatch — check number of {{params}} matches what Meta approved.' :
            '';

          console.error(`[WhatsApp] ❌ ${res.statusCode} | code=${code} | ${msg}`);
          if (hint) console.error(`[WhatsApp] ${hint}`);
          resolve({ success: false, error: msg, statusCode: res.statusCode, code });
        }
      });
    });

    req.on('error', (err) => {
      console.error('[WhatsApp] ❌ Network error:', err.message);
      resolve({ success: false, error: err.message });
    });

    req.write(body);
    req.end();
  });
};

// ── Check config ────────────────────────────────────────────
const _getConfig = () => {
  const token   = process.env.META_WHATSAPP_TOKEN;
  const phoneId = process.env.META_WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneId || token === 'PASTE_YOUR_TEMPORARY_TOKEN_HERE') {
    console.warn('[WhatsApp] ⚠️  META_WHATSAPP_TOKEN or META_WHATSAPP_PHONE_NUMBER_ID not set — skipped');
    return null;
  }
  return { token, phoneId };
};

// ── Template message ────────────────────────────────────────
const sendTemplateWhatsApp = (toPhone, templateName, components = [], languageCode = 'en') => {
  const cfg = _getConfig();
  if (!cfg) return Promise.resolve({ success: false, error: 'Not configured' });
  const to = normalisePhone(toPhone);
  if (!to) return Promise.resolve({ success: false, error: 'Invalid phone' });
  return _postToMeta(cfg.phoneId, cfg.token, {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name:     templateName,
      language: { code: languageCode },
      ...(components.length ? { components } : {}),
    },
  });
};

// ── Free-text (only works if customer messaged you first in 24h) ──
const sendMetaWhatsApp = (toPhone, message) => {
  const cfg = _getConfig();
  if (!cfg) return Promise.resolve({ success: false, error: 'Not configured' });
  const to = normalisePhone(toPhone);
  if (!to) return Promise.resolve({ success: false, error: 'Invalid phone' });
  return _postToMeta(cfg.phoneId, cfg.token, {
    messaging_product: 'whatsapp',
    recipient_type:    'individual',
    to,
    type: 'text',
    text: { preview_url: false, body: message },
  });
};

// ── Helpers ─────────────────────────────────────────────────
// Try template first; if no template set, log a clear warning and skip (don't send broken free-text).
const _sendWithTemplate = (phone, templateEnvKey, templateParams, fallbackMessage) => {
  const templateName = process.env[templateEnvKey];

  if (templateName) {
    return sendTemplateWhatsApp(phone, templateName, [
      { type: 'body', parameters: templateParams.map(t => ({ type: 'text', text: String(t) })) },
    ]);
  }

  // No template configured — warn and skip (free-text will be blocked by Meta)
  console.warn(`[WhatsApp] ⚠️  ${templateEnvKey} not set. Create a Meta-approved template and add to Render env vars. Message NOT sent to ${phone}.`);
  if (fallbackMessage) {
    console.warn('[WhatsApp] Would have sent:', fallbackMessage.slice(0, 80) + '...');
  }
  return Promise.resolve({ success: false, error: `${templateEnvKey} not configured` });
};

// ── Customer: order placed ──────────────────────────────────
// Template body (create in Meta → WhatsApp Manager → Message Templates):
//   "Your Eptomart order #{{1}} is confirmed! Amount: ₹{{2}} | Payment: {{3}}. Track at eptomart.com/orders 🎉"
const sendOrderPlacedWhatsApp = (phone, { orderId, total, paymentMethod, items }) => {
  return _sendWithTemplate(
    phone,
    'META_WHATSAPP_ORDER_TEMPLATE',
    [
      String(orderId),
      Number(total).toLocaleString('en-IN'),
      (paymentMethod || 'ONLINE').toUpperCase(),
    ],
    `Order #${orderId} confirmed`
  );
};

// ── Customer: payment confirmed ─────────────────────────────
// Primary template (META_WHATSAPP_PAID_TEMPLATE):
//   "Hi {{1}}! Payment of ₹{{2}} received for order #{{3}} on Eptomart. We're preparing your order 📦"
//
// Fallback: uses META_WHATSAPP_STATUS_TEMPLATE with status "Payment Received ✅"
const sendOrderPaidWhatsApp = (phone, { orderId, total, name }) => {
  const paidTemplate   = process.env.META_WHATSAPP_PAID_TEMPLATE;
  const statusTemplate = process.env.META_WHATSAPP_STATUS_TEMPLATE;

  if (paidTemplate) {
    console.log(`[WhatsApp] Sending paid template "${paidTemplate}" → ${phone}`);
    return sendTemplateWhatsApp(phone, paidTemplate, [
      { type: 'body', parameters: [
        { type: 'text', text: name || 'Customer' },
        { type: 'text', text: Number(total).toLocaleString('en-IN') },
        { type: 'text', text: String(orderId) },
      ]},
    ]);
  }

  // Fallback: use status template
  if (statusTemplate) {
    console.log(`[WhatsApp] META_WHATSAPP_PAID_TEMPLATE not set — falling back to status template for order ${orderId}`);
    return sendTemplateWhatsApp(phone, statusTemplate, [
      { type: 'body', parameters: [
        { type: 'text', text: name || 'Customer' },
        { type: 'text', text: String(orderId) },
        { type: 'text', text: 'Payment Received ✅' },
        { type: 'text', text: `Amount: ₹${Number(total).toLocaleString('en-IN')}. We are preparing your order 📦` },
      ]},
    ]);
  }

  console.warn(`[WhatsApp] ⚠️  Neither META_WHATSAPP_PAID_TEMPLATE nor META_WHATSAPP_STATUS_TEMPLATE is set — paid message NOT sent for order ${orderId}.`);
  return Promise.resolve({ success: false, error: 'No template configured for paid notification' });
};

// ── Customer: order delivered — billing summary ─────────────
// Primary template (META_WHATSAPP_DELIVERED_TEMPLATE):
//   "Hi {{1}}, your Eptomart order #{{2}} has been delivered! Total paid: ₹{{3}}. Rate us at eptomart.com/orders 🌟"
//
// Fallback: if delivered template not set, uses META_WHATSAPP_STATUS_TEMPLATE with status "Delivered 🎉"
//   so at least one message always goes out when any status template is configured.
const sendOrderDeliveredWhatsApp = (phone, { name, orderId, pricing = {} }) => {
  const deliveredTemplate = process.env.META_WHATSAPP_DELIVERED_TEMPLATE;
  const statusTemplate    = process.env.META_WHATSAPP_STATUS_TEMPLATE;

  if (deliveredTemplate) {
    console.log(`[WhatsApp] Sending delivered template "${deliveredTemplate}" → ${phone}`);
    return _sendWithTemplate(
      phone,
      'META_WHATSAPP_DELIVERED_TEMPLATE',
      [
        name || 'Customer',
        String(orderId),
        Number(pricing.total || 0).toLocaleString('en-IN'),
      ],
      `Order #${orderId} delivered`
    );
  }

  // Fallback: use status template with "Delivered" status
  if (statusTemplate) {
    const total = Number(pricing.total || 0).toLocaleString('en-IN');
    console.log(`[WhatsApp] META_WHATSAPP_DELIVERED_TEMPLATE not set — falling back to status template for order ${orderId}`);
    return sendTemplateWhatsApp(phone, statusTemplate, [
      { type: 'body', parameters: [
        { type: 'text', text: name || 'Customer' },
        { type: 'text', text: String(orderId) },
        { type: 'text', text: 'Delivered 🎉' },
        { type: 'text', text: `Total paid: ₹${total}. Rate us at eptomart.com/orders 🌟` },
      ]},
    ]);
  }

  console.warn(`[WhatsApp] ⚠️  Neither META_WHATSAPP_DELIVERED_TEMPLATE nor META_WHATSAPP_STATUS_TEMPLATE is set — delivery message NOT sent for order ${orderId}.`);
  return Promise.resolve({ success: false, error: 'No template configured for delivered notification' });
};

// ── Customer: all other status changes ─────────────────────
// Template body:
//   "Hi {{1}}, your Eptomart order #{{2}} status: {{3}}. {{4}}"
//   {{4}} = tracking link for shipped, refund note for cancelled, empty otherwise
const sendOrderStatusWhatsApp = (phone, { status, orderId, name, trackingNumber, refundStatus, note } = {}) => {
  if (!phone || !orderId) return Promise.resolve({ success: false });

  const statusLabel = {
    confirmed:  'Confirmed ✅',
    processing: 'Processing ⚙️',
    shipped:    'Shipped 🚚',
    cancelled:  'Cancelled ❌',
    returned:   'Return Received 🔄',
  }[status] || status;

  const detail =
    status === 'shipped' && trackingNumber
      ? `Track: https://shiprocket.co/tracking/${trackingNumber}`
      : status === 'cancelled' && refundStatus === 'initiated'
      ? 'Refund will credit in 5-7 business days.'
      : status === 'cancelled' && refundStatus === 'manual_required'
      ? 'Refund will be processed by our team in 2-3 business days.'
      : status === 'cancelled' && note
      ? `Reason: ${note}`
      : 'Visit eptomart.com/orders for details.';

  return _sendWithTemplate(
    phone,
    'META_WHATSAPP_STATUS_TEMPLATE',
    [name || 'Customer', String(orderId), statusLabel, detail],
    `Order #${orderId} → ${status}`
  );
};

// ── Customer: order shipped (legacy — use sendOrderStatusWhatsApp) ──
const sendOrderShippedWhatsApp = (phone, orderId, trackingNumber) =>
  sendOrderStatusWhatsApp(phone, { status: 'shipped', orderId, trackingNumber });

// ── Admin: new order alert ──────────────────────────────────
// Admin phone is yours — you control it. Free-text works if you've messaged the business WA before.
// If not, add META_WHATSAPP_ADMIN_TEMPLATE to use a template instead.
const sendAdminNewOrderAlert = ({ orderId, customerName, total, paymentMethod }) => {
  const adminPhone = process.env.ADMIN_WHATSAPP_PHONE;
  if (!adminPhone) return Promise.resolve({ success: false });

  const message =
`🔔 *New Order on Eptomart!*

Order: *#${orderId}*
Customer: ${customerName}
Amount: *₹${Number(total).toLocaleString('en-IN')}*
Payment: ${(paymentMethod || '—').toUpperCase()}

Manage: eptomart.com/admin/orders`;

  // Try free-text for admin (they can message business WA to open window)
  // If blocked, set META_WHATSAPP_ADMIN_TEMPLATE and add template logic here
  return sendMetaWhatsApp(adminPhone, message);
};

// ── Seller: welcome on account creation ────────────────────
const sendSellerWelcomeWhatsApp = (phone, { businessName, loginId, tempPassword }) => {
  const message =
`🎉 *Welcome to Eptomart Seller Platform!*

Hi *${businessName}*, your seller account has been created.

🔑 Login: *${loginId}*
🔒 Password: *${tempPassword}*
🌐 Seller Portal: eptomart.com/seller

Please log in and change your password on first visit.

— *Team Eptomart*`;

  return sendMetaWhatsApp(phone, message);
};

// ── Seller: account activated ───────────────────────────────
const sendSellerActivatedWhatsApp = (phone, { businessName }) => {
  const message =
`✅ *Your Eptomart Seller Account is Now Active!*

Congratulations *${businessName}* 🎊

You can now add products and receive orders.
Start: eptomart.com/seller/products

— *Team Eptomart*`;

  return sendMetaWhatsApp(phone, message);
};

// ── Seller: new order received ──────────────────────────────
// Sent to each seller's contact phone when a new order arrives containing their products.
// Uses free-text (same as admin alert — seller is running a business and usually has the
// business WhatsApp linked, so the 24h window is often open. If Meta blocks it, the log
// will show error code 131047 and you can create a seller-specific template).
const sendSellerNewOrderWhatsApp = (phone, { businessName, orderId, items = [], total, buyerName, paymentMethod }) => {
  if (!phone) return Promise.resolve({ success: false, error: 'No phone' });

  const itemLines = items
    .map(i => `  • ${i.name} × ${i.qty} — ₹${Number((i.price || 0) * i.qty).toLocaleString('en-IN')}`)
    .join('\n');

  const message =
`📦 *New Order on Eptomart!*

Order: *#${orderId}*
Buyer: ${buyerName || 'Customer'}
Payment: ${(paymentMethod || '—').toUpperCase()}

*Your Items:*
${itemLines}

*Your Total: ₹${Number(total).toLocaleString('en-IN')}*

Go to your seller dashboard to confirm:
eptomart.com/seller/orders

— *Team Eptomart*`;

  return sendMetaWhatsApp(phone, message);
};

// ── OTP via WhatsApp ────────────────────────────────────────
// Authentication templates are auto-approved by Meta — fastest to set up.
// Template body (Category: Authentication):
//   "{{1}} is your Eptomart login OTP. Valid for {{2}} minutes. Do not share."
const sendOtpWhatsApp = (phone, code) => {
  const templateName = process.env.META_WHATSAPP_OTP_TEMPLATE;

  if (templateName) {
    return sendTemplateWhatsApp(phone, templateName, [
      { type: 'body', parameters: [
        { type: 'text', text: String(code) },
        { type: 'text', text: String(process.env.OTP_EXPIRY_MINUTES || 10) },
      ]},
    ]);
  }

  // Fallback free-text for OTP (usually works since the customer is actively logging in)
  const message =
`🔐 *Your Eptomart OTP*

Your one-time password is: *${code}*

Valid for ${process.env.OTP_EXPIRY_MINUTES || 10} minutes. Do not share this with anyone.

— *Team Eptomart*`;

  return sendMetaWhatsApp(phone, message);
};

module.exports = {
  sendMetaWhatsApp,
  sendTemplateWhatsApp,
  sendOrderPlacedWhatsApp,
  sendOrderPaidWhatsApp,
  sendOrderDeliveredWhatsApp,
  sendAdminNewOrderAlert,
  sendSellerWelcomeWhatsApp,
  sendSellerActivatedWhatsApp,
  sendSellerNewOrderWhatsApp,
  sendOrderShippedWhatsApp,
  sendOrderStatusWhatsApp,
  sendOtpWhatsApp,
};
