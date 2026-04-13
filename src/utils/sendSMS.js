// ============================================
// SMS UTILITY
// Free Indian SMS APIs:
//   - Fast2SMS (https://fast2sms.com) — 100 free credits
//   - TextLocal (https://textlocal.in)
//   - MSG91 (https://msg91.com)
// ============================================
const https = require('https');

/**
 * Send SMS via Fast2SMS (Free Indian API)
 * Sign up at: https://fast2sms.com → API → DLT Route
 */
const sendSmsViaFast2SMS = async (phone, message) => {
  const apiKey = process.env.FAST2SMS_API_KEY;

  if (!apiKey) {
    console.warn('⚠️ FAST2SMS_API_KEY not set. SMS not sent.');
    return { success: false, error: 'API key not configured' };
  }

  return new Promise((resolve) => {
    const postData = JSON.stringify({
      route: 'q',
      message: message,
      language: 'english',
      flash: 0,
      numbers: phone,
    });

    const options = {
      hostname: 'www.fast2sms.com',
      path: '/dev/bulkV2',
      method: 'POST',
      headers: {
        'authorization': apiKey,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ success: parsed.return === true, data: parsed });
        } catch {
          resolve({ success: false, error: 'Parse error' });
        }
      });
    });

    req.on('error', (err) => resolve({ success: false, error: err.message }));
    req.write(postData);
    req.end();
  });
};

/**
 * Send OTP via SMS
 */
const sendOtpSms = async (phone, otp) => {
  // Format phone for India
  const formattedPhone = phone.startsWith('91') ? phone : `91${phone}`;

  const message = `${otp} is your Eptomart login OTP. Valid for ${process.env.OTP_EXPIRY_MINUTES || 10} minutes. DO NOT share with anyone. - Team Eptomart`;

  return sendSmsViaFast2SMS(phone, message);
};

/**
 * Send order confirmation SMS
 */
const sendOrderSms = async (phone, orderId, total) => {
  const message = `Your Eptomart order #${orderId} is confirmed! Total: Rs.${total}. Track at eptomart.com/orders - Team Eptomart`;
  return sendSmsViaFast2SMS(phone, message);
};

/**
 * Send order status update SMS
 */
const sendOrderStatusSms = async (phone, orderId, status) => {
  const messages = {
    confirmed: `Order #${orderId} confirmed! We're preparing it. - Eptomart`,
    shipped: `Order #${orderId} is on its way! Track at eptomart.com/orders - Eptomart`,
    delivered: `Order #${orderId} delivered! Hope you love it. Rate us on eptomart.com - Eptomart`,
    cancelled: `Order #${orderId} has been cancelled. Refund (if any) in 3-5 days. - Eptomart`,
  };

  const message = messages[status] || `Your order #${orderId} status: ${status}. - Eptomart`;
  return sendSmsViaFast2SMS(phone, message);
};

module.exports = { sendOtpSms, sendOrderSms, sendOrderStatusSms };
