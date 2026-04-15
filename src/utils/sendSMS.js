// ============================================
// SMS UTILITY — 2Factor.in (Indian OTP API)
// Sign up free at: https://2factor.in
// ============================================
const https = require('https');

/**
 * Send OTP via 2Factor.in (dedicated Indian OTP service)
 */
const sendSmsVia2Factor = async (phone, otp) => {
  const apiKey = process.env.TWOFACTOR_API_KEY || process.env.FAST2SMS_API_KEY;

  if (!apiKey) {
    console.warn('⚠️ SMS API key not set (TWOFACTOR_API_KEY). SMS not sent.');
    return { success: false, error: 'SMS API key not configured' };
  }

  // 2Factor OTP API — sends via their default OTP template
  const url = `https://2factor.in/API/V1/${apiKey}/SMS/${phone}/${otp}/AUTOGEN`;

  return new Promise((resolve) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          console.log('2Factor SMS response:', parsed);
          resolve({ success: parsed.Status === 'Success', data: parsed });
        } catch {
          resolve({ success: false, error: 'Parse error' });
        }
      });
    }).on('error', (err) => {
      console.error('SMS send error:', err.message);
      resolve({ success: false, error: err.message });
    });
  });
};

/**
 * Send OTP via SMS
 */
const sendOtpSms = async (phone, otp) => {
  // Strip country code if present, use 10-digit number
  const cleanPhone = phone.replace(/^(\+91|91)/, '').trim();
  return sendSmsVia2Factor(cleanPhone, otp);
};

/**
 * Send order confirmation SMS
 */
const sendOrderSms = async (phone, orderId, total) => {
  const otp = `Order #${orderId} confirmed Rs.${total}`;
  return sendSmsVia2Factor(phone, otp);
};

/**
 * Send order status update SMS
 */
const sendOrderStatusSms = async (phone, orderId, status) => {
  return sendSmsVia2Factor(phone, `${orderId} ${status}`);
};

module.exports = { sendOtpSms, sendOrderSms, sendOrderStatusSms };
