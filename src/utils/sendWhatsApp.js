// ============================================
// WHATSAPP NOTIFICATIONS — Meta Cloud API (FREE)
// Free tier: 1,000 conversations / month
//
// Setup (one-time, 10 min, no card required):
//   1. developers.facebook.com → Create App → Business
//   2. Add "WhatsApp" product to the app
//   3. WhatsApp → Getting Started → copy:
//        - Temporary access token  → META_WHATSAPP_TOKEN
//        - Phone number ID          → META_WHATSAPP_PHONE_NUMBER_ID
//   4. Add recipient numbers to the test allowlist (under API Setup)
//
// For production (verified business):
//   - Verify your business in Meta Business Manager
//   - Get permanent system user token
//   - Register your own phone number
// ============================================

const https = require('https');

/**
 * Core sender — Meta Graph API v18
 * @param {string} toPhone  Phone with country code e.g. "919876543210" or "+919876543210"
 * @param {string} message  Plain text body (max 4096 chars)
 */
const sendMetaWhatsApp = (toPhone, message) => {
  const token   = process.env.META_WHATSAPP_TOKEN;
  const phoneId = process.env.META_WHATSAPP_PHONE_NUMBER_ID;

  if (!token || !phoneId) {
    console.warn('⚠️  META_WHATSAPP_TOKEN or META_WHATSAPP_PHONE_NUMBER_ID not set — WhatsApp skipped');
    return Promise.resolve({ success: false, error: 'Meta WhatsApp not configured' });
  }

  // Normalise: strip leading + and prepend country code if missing
  const normalised = toPhone.replace(/^\+/, '');
  const to = normalised.startsWith('91') ? normalised : `91${normalised}`;

  return new Promise((resolve) => {
    const body = JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type:    'individual',
      to,
      type: 'text',
      text: { preview_url: false, body: message },
    });

    const options = {
      hostname: 'graph.facebook.com',
      path:     `/v18.0/${phoneId}/messages`,
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
          resolve({ success: true });
        } else {
          console.error('[WhatsApp] Meta API error:', res.statusCode, data);
          resolve({ success: false, error: data });
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

// ── Customer: order placed ──────────────────────────────
const sendOrderPlacedWhatsApp = (phone, { orderId, total, paymentMethod, items }) => {
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

module.exports = {
  sendOrderPlacedWhatsApp,
  sendAdminNewOrderAlert,
  sendSellerWelcomeWhatsApp,
  sendSellerActivatedWhatsApp,
  sendOrderShippedWhatsApp,
};
