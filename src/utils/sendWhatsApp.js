// ============================================
// WHATSAPP NOTIFICATIONS — Meta Cloud API
// Free tier: 1,000 conversations / month
//
// PRODUCTION SETUP:
//   1. business.facebook.com → Security Centre → Business Verification
//      Make sure status is ✅ Verified before proceeding.
//   2. developers.facebook.com → Your App → WhatsApp → API Setup
//      - Copy Phone Number ID  → META_WHATSAPP_PHONE_NUMBER_ID
//   3. Business Settings → System Users → Create Admin System User
//      → Generate Token (permissions: whatsapp_business_messaging,
//        whatsapp_business_management)
//      → Copy token             → META_WHATSAPP_TOKEN
//   4. WhatsApp Manager → Message Templates → create "order_confirmation"
//      template (category: Utility) and wait for Meta approval (< 24h).
//      Then set:                → META_WHATSAPP_ORDER_TEMPLATE=order_confirmation
//
// MESSAGE TYPES:
//   - Template messages: required outside 24h customer-initiated window.
//     Must be pre-approved by Meta. Free for Utility category.
//   - Free-text messages: only work within 24h of customer messaging first.
// ============================================

const https = require('https');

const API_VERSION = 'v21.0'; // keep updated with Meta's latest stable version

// ── Normalise phone number ──────────────────────────────────
const normalisePhone = (phone) => {
  const stripped = (phone || '').replace(/^\+/, '').replace(/\s/g, '');
  return stripped.startsWith('91') ? stripped : `91${stripped}`;
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
          resolve({ success: true, raw: data });
        } else {
          console.error('[WhatsApp] Meta API error:', res.statusCode, data);
          resolve({ success: false, error: data, statusCode: res.statusCode });
        }
      });
    });

    req.on('error', (err) => {
      console.error('[WhatsApp] Request error:', err.message);
      resolve({ success: false, error: err.message });
    });

    req.write(body);
    req.end();
  });
};

// ── Free-text sender (works within 24h customer-initiated window) ──
const sendMetaWhatsApp = (toPhone, message) => {
  const token   = process.env.META_WHATSAPP_TOKEN;
  const phoneId = process.env.META_WHATSAPP_PHONE_NUMBER_ID;

  if (!token || !phoneId) {
    console.warn('⚠️  META_WHATSAPP_TOKEN or META_WHATSAPP_PHONE_NUMBER_ID not set — WhatsApp skipped');
    return Promise.resolve({ success: false, error: 'Meta WhatsApp not configured' });
  }

  const to = normalisePhone(toPhone);
  return _postToMeta(phoneId, token, {
    messaging_product: 'whatsapp',
    recipient_type:    'individual',
    to,
    type: 'text',
    text: { preview_url: false, body: message },
  });
};

// ── Template message sender (works anytime, requires Meta-approved template) ──
// templateName: the name you gave the template in WhatsApp Manager (snake_case)
// components:   array of parameter components — see Meta docs for structure
const sendTemplateWhatsApp = (toPhone, templateName, components = [], languageCode = 'en') => {
  const token   = process.env.META_WHATSAPP_TOKEN;
  const phoneId = process.env.META_WHATSAPP_PHONE_NUMBER_ID;

  if (!token || !phoneId) {
    console.warn('⚠️  META_WHATSAPP_TOKEN or META_WHATSAPP_PHONE_NUMBER_ID not set — WhatsApp skipped');
    return Promise.resolve({ success: false, error: 'Meta WhatsApp not configured' });
  }

  const to = normalisePhone(toPhone);
  return _postToMeta(phoneId, token, {
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

// ── Customer: order placed ──────────────────────────────
// Uses the approved "order_confirmation" template if META_WHATSAPP_ORDER_TEMPLATE is set.
// Falls back to free-text (works within 24h of customer messaging first).
const sendOrderPlacedWhatsApp = (phone, { orderId, total, paymentMethod, items }) => {
  const templateName = process.env.META_WHATSAPP_ORDER_TEMPLATE; // e.g. 'order_confirmation'

  if (templateName) {
    // Template message — works anytime, requires Meta-approved template.
    // Template body example (set up in WhatsApp Manager):
    //   "Your order #{{1}} is confirmed! Amount: ₹{{2}} | Payment: {{3}}
    //    Track at eptomart.com/orders. Thank you for shopping with Eptomart!"
    return sendTemplateWhatsApp(phone, templateName, [
      {
        type: 'body',
        parameters: [
          { type: 'text', text: String(orderId) },
          { type: 'text', text: Number(total).toLocaleString('en-IN') },
          { type: 'text', text: (paymentMethod || 'ONLINE').toUpperCase() },
        ],
      },
    ]);
  }

  // Free-text fallback
  const itemList = (items || []).slice(0, 3).map(i => `• ${i.name} ×${i.quantity}`).join('\n');
  const more     = items?.length > 3 ? `\n...and ${items.length - 3} more item(s)` : '';
  const message =
`🛒 *Order Confirmed — Eptomart!*

Order ID: *#${orderId}*
Amount: *₹${Number(total).toLocaleString('en-IN')}*
Payment: ${(paymentMethod || 'ONLINE').toUpperCase()}

${itemList}${more}

📦 Track your order: eptomart.com/orders
💬 Need help? Just reply here!

Thank you for shopping with Eptomart 🙏`;

  return sendMetaWhatsApp(phone, message);
};

// ── Admin: new order alert ──────────────────────────────
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

  return sendMetaWhatsApp(adminPhone, message);
};

// ── Seller: welcome on account creation ────────────────
const sendSellerWelcomeWhatsApp = (phone, { businessName, loginId, tempPassword }) => {
  const message =
`🎉 *Welcome to Eptomart Seller Platform!*

Hi *${businessName}*, your seller account has been created. Here are your login details:

🔑 Login: *${loginId}*
🔒 Password: *${tempPassword}*
🌐 Seller Portal: eptomart.com/seller

Please log in and change your password on first visit.

We're excited to have you on board! Start listing your products to reach thousands of customers across India. 🚀

— *Team Eptomart*`;

  return sendMetaWhatsApp(phone, message);
};

// ── Seller: account activated ───────────────────────────
const sendSellerActivatedWhatsApp = (phone, { businessName }) => {
  const message =
`✅ *Your Eptomart Seller Account is Now Active!*

Congratulations *${businessName}* 🎊

Your account has been reviewed and approved. You can now:
• Add and manage your products
• Receive and process orders
• Track your earnings

Start selling now: eptomart.com/seller/products

Welcome to the Eptomart family! 💪
— *Team Eptomart*`;

  return sendMetaWhatsApp(phone, message);
};

// ── Customer: payment confirmed ─────────────────────────
const sendOrderPaidWhatsApp = (phone, { orderId, total, name }) => {
  const message =
`✅ *Payment Confirmed — Eptomart!*

Hi ${name || 'there'} 👋

Your payment of *₹${Number(total).toLocaleString('en-IN')}* for order *#${orderId}* has been received successfully.

📦 Your order is now being prepared.
🔍 Track your order: eptomart.com/orders

Thank you for shopping with Eptomart 🙏
— *Team Eptomart*`;

  return sendMetaWhatsApp(phone, message);
};

// ── Customer: order shipped ─────────────────────────────
const sendOrderShippedWhatsApp = (phone, orderId, trackingNumber) => {
  const message =
`📦 *Your Eptomart Order is on its Way!*

Order ID: *#${orderId}*
${trackingNumber ? `Tracking No: *${trackingNumber}*\n` : ''}
Expected delivery in 3–5 business days.

Track: eptomart.com/orders

— *Team Eptomart* 🚀`;

  return sendMetaWhatsApp(phone, message);
};

// ── Customer: order delivered — billing summary ─────────
// Sends a full billing receipt to the customer on delivery.
const sendOrderDeliveredWhatsApp = (phone, {
  name, orderId, items = [], pricing = {}, paymentMethod, deliveredAt,
}) => {
  const templateName = process.env.META_WHATSAPP_DELIVERED_TEMPLATE;

  if (templateName) {
    // Template mode — requires Meta-approved template named e.g. "order_delivered"
    // Suggested template body:
    //   "Hi {{1}}! Your Eptomart order #{{2}} has been delivered. 🎉
    //    Total paid: ₹{{3}}. We hope you love your purchase!
    //    Need help? Visit eptomart.com/orders"
    return sendTemplateWhatsApp(phone, templateName, [
      {
        type: 'body',
        parameters: [
          { type: 'text', text: name || 'Customer' },
          { type: 'text', text: String(orderId) },
          { type: 'text', text: Number(pricing.total || 0).toLocaleString('en-IN') },
        ],
      },
    ]);
  }

  // ── Free-text billing receipt ───────────────────────────
  const dateStr = deliveredAt
    ? new Date(deliveredAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    : new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

  // Item lines (max 5, then "...and N more")
  const itemLines = (items || []).slice(0, 5)
    .map(i => `  • ${i.name} ×${i.quantity}  ₹${Number(i.price * i.quantity).toLocaleString('en-IN')}`)
    .join('\n');
  const moreItems = items.length > 5 ? `\n  ...and ${items.length - 5} more item(s)` : '';

  // Pricing breakdown
  const subtotal = Number(pricing.subtotal || 0).toLocaleString('en-IN');
  const tax      = Number(pricing.tax || 0).toLocaleString('en-IN');
  const shipping = Number(pricing.shipping || 0).toLocaleString('en-IN');
  const discount = Number(pricing.discount || 0);
  const total    = Number(pricing.total || 0).toLocaleString('en-IN');
  const method   = (paymentMethod || 'ONLINE').toUpperCase();

  const discountLine = discount > 0
    ? `\nDiscount:    -₹${discount.toLocaleString('en-IN')}` : '';

  const message =
`✅ *Order Delivered — Eptomart*

Hi *${name || 'Customer'}* 👋, your order has been delivered!

🧾 *Bill for Order #${orderId}*
📅 Date: ${dateStr}

*Items Ordered:*
${itemLines}${moreItems}

─────────────────────
Subtotal:     ₹${subtotal}
GST:          ₹${tax}
Shipping:     ₹${shipping}${discountLine}
*Total Paid:  ₹${total}*
Payment:      ${method}
─────────────────────

🌟 We hope you love your purchase! Rate your experience at eptomart.com/orders

Thank you for shopping with Eptomart 🙏
— *Team Eptomart*`;

  return sendMetaWhatsApp(phone, message);
};

// ── Order status update — one function for all status changes ──
// Sends the right message for each order status transition.
const sendOrderStatusWhatsApp = (phone, { status, orderId, name, trackingNumber, refundStatus, note } = {}) => {
  if (!phone || !orderId) return Promise.resolve({ success: false });

  const track = trackingNumber ? `\n🚚 Tracking: *${trackingNumber}*\nhttps://shiprocket.co/tracking/${trackingNumber}` : '';

  const messages = {
    confirmed: `✅ *Order Confirmed — Eptomart!*\n\nHi ${name || 'there'} 👋\n\nYour order *#${orderId}* has been confirmed and is being prepared.\n\n📦 Track: eptomart.com/orders\n— *Team Eptomart*`,

    processing: `⚙️ *Order Being Processed — Eptomart!*\n\nHi ${name || 'there'} 👋\n\nYour order *#${orderId}* is now being processed and packed.\n\nWe'll notify you once it's shipped! 📦\n— *Team Eptomart*`,

    shipped: `🚚 *Your Eptomart Order is Shipped!*\n\nHi ${name || 'there'} 👋\n\nGreat news! Order *#${orderId}* is on its way to you.${track}\n\nExpected delivery in 3–5 business days.\n— *Team Eptomart*`,

    cancelled: `❌ *Order Cancelled — Eptomart*\n\nHi ${name || 'there'},\n\nYour order *#${orderId}* has been cancelled.${note ? `\nReason: ${note}` : ''}${
      refundStatus === 'initiated' ? '\n\n💰 *Refund initiated* — will credit in 5-7 business days.' :
      refundStatus === 'manual_required' ? '\n\n💰 Refund will be processed manually by our team within 2-3 business days.' :
      refundStatus === 'not_applicable' ? '' : ''
    }\n\nFor help: eptomart.com/orders\n— *Team Eptomart*`,

    returned: `🔄 *Return Acknowledged — Eptomart*\n\nHi ${name || 'there'},\n\nYour return for order *#${orderId}* has been received and is being processed.\n\nRefund will be credited once inspection is complete.\n— *Team Eptomart*`,
  };

  const msg = messages[status];
  if (!msg) return Promise.resolve({ success: false, error: 'No message for this status' });
  return sendMetaWhatsApp(phone, msg);
};

// ── OTP via WhatsApp ────────────────────────────────────
// Used to replace Firebase phone auth (no CAPTCHA, fully backend-controlled).
const sendOtpWhatsApp = (phone, code) => {
  const message =
`🔐 *Your Eptomart OTP*

Your one-time password is: *${code}*

Valid for ${process.env.OTP_EXPIRY_MINUTES || 10} minutes. Do not share this with anyone.

If you didn't request this, please ignore.
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
  sendOrderShippedWhatsApp,
  sendOtpWhatsApp,
};
