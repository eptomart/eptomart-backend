// ============================================
// WHATSAPP NOTIFICATIONS
// Uses: WhatsApp Business API via Twilio (Free trial)
// OR: wati.io (Free plan for small businesses)
// OR: Meta Cloud API (Free)
// ============================================

/**
 * Send WhatsApp message via Twilio
 * Free trial: https://twilio.com → Sandbox
 * Env vars needed:
 *   TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxx
 *   TWILIO_AUTH_TOKEN=your_auth_token
 *   TWILIO_WHATSAPP_FROM=whatsapp:+14155238886 (Twilio Sandbox)
 */
const sendWhatsAppViaTwilio = async (toPhone, message) => {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_WHATSAPP_FROM;

  if (!accountSid || !authToken) {
    console.warn('⚠️ Twilio credentials not set. WhatsApp not sent.');
    return { success: false, error: 'Twilio not configured' };
  }

  try {
    // Dynamic import to avoid crash if twilio not installed
    const twilio = require('twilio');
    const client = twilio(accountSid, authToken);

    const msg = await client.messages.create({
      body: message,
      from: from || 'whatsapp:+14155238886',
      to: `whatsapp:+91${toPhone}`,
    });

    return { success: true, sid: msg.sid };
  } catch (error) {
    console.error('WhatsApp error:', error.message);
    return { success: false, error: error.message };
  }
};

/**
 * Order placed WhatsApp notification to customer
 */
const sendOrderPlacedWhatsApp = async (phone, orderData) => {
  const { orderId, total, paymentMethod, items } = orderData;
  const itemList = items?.slice(0, 3).map(i => `• ${i.name} x${i.quantity}`).join('\n') || '';

  const message = `🛒 *Eptomart Order Confirmed!*

Order ID: *#${orderId}*
Amount: *₹${total?.toLocaleString('en-IN')}*
Payment: ${paymentMethod?.toUpperCase()}

${itemList}
${items?.length > 3 ? `...and ${items.length - 3} more items` : ''}

Track your order: eptomart.com/orders
Need help? Reply to this message!

Thank you for shopping with Eptomart 🙏`;

  return sendWhatsAppViaTwilio(phone, message);
};

/**
 * Order shipped WhatsApp notification
 */
const sendOrderShippedWhatsApp = async (phone, orderId, trackingNumber) => {
  const message = `📦 *Your Eptomart Order is Shipped!*

Order ID: *#${orderId}*
${trackingNumber ? `Tracking: *${trackingNumber}*` : ''}

Track your delivery at: eptomart.com/orders

Expected delivery in 3-5 business days.
- Team Eptomart 🚀`;

  return sendWhatsAppViaTwilio(phone, message);
};

/**
 * New order alert to admin (WhatsApp)
 */
const sendAdminNewOrderAlert = async (orderData) => {
  const adminPhone = process.env.ADMIN_PHONE;
  if (!adminPhone) return;

  const message = `🔔 *New Order on Eptomart!*

Order: *#${orderData.orderId}*
Customer: ${orderData.customerName}
Amount: *₹${orderData.total?.toLocaleString('en-IN')}*
Payment: ${orderData.paymentMethod?.toUpperCase()}

Login to manage: eptomart.com/admin`;

  return sendWhatsAppViaTwilio(adminPhone, message);
};

module.exports = { sendOrderPlacedWhatsApp, sendOrderShippedWhatsApp, sendAdminNewOrderAlert };
