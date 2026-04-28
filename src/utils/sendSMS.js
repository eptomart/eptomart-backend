// ============================================
// SMS UTILITY — Fast2SMS (India, Free tier)
// Sign up free at: https://www.fast2sms.com
// Free credits on signup (~₹50 = ~300 SMS)
// No DLT registration needed for OTP route
//
// Env var needed:  FAST2SMS_API_KEY
// Get it from: fast2sms.com → Dev API → API Key
// ============================================
const https = require('https');

const getApiKey = () => process.env.FAST2SMS_API_KEY || process.env.TWOFACTOR_API_KEY;

// ── Core sender via Fast2SMS ────────────────────────────────────────────
const sendViaSMS = (phone, message, isOtp = false, otpValue = null) => {
  const apiKey = getApiKey();

  if (!apiKey) {
    console.warn('⚠️  FAST2SMS_API_KEY not set — SMS skipped');
    return Promise.resolve({ success: false, error: 'SMS API key not configured' });
  }

  // Clean phone — 10-digit Indian number only
  const cleanPhone = String(phone).replace(/^(\+91|91)/, '').trim();
  if (!/^[6-9]\d{9}$/.test(cleanPhone)) {
    console.warn('⚠️  Invalid phone for SMS:', cleanPhone);
    return Promise.resolve({ success: false, error: 'Invalid phone number' });
  }

  // Fast2SMS API endpoint
  // route=otp  → for numeric OTP codes (uses their OTP template, no DLT needed)
  // route=q    → Quick SMS for custom messages (works on most numbers)
  let params;
  if (isOtp && otpValue) {
    // OTP route — fast2sms sends a preformatted OTP message
    params = new URLSearchParams({
      authorization:    apiKey,
      route:            'otp',
      numbers:          cleanPhone,
      variables_values: String(otpValue),
      flash:            '0',
    });
  } else {
    // Quick SMS route — custom message text
    params = new URLSearchParams({
      authorization: apiKey,
      route:         'q',
      message:       String(message).substring(0, 160), // keep under 1 SMS length
      numbers:       cleanPhone,
      flash:         '0',
    });
  }

  const url = `https://www.fast2sms.com/dev/bulkV2?${params.toString()}`;

  return new Promise((resolve) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.return === true) {
            console.log('[SMS] Fast2SMS sent to', cleanPhone, '| request_id:', parsed.request_id);
            resolve({ success: true, data: parsed });
          } else {
            console.warn('[SMS] Fast2SMS failed:', parsed.message || JSON.stringify(parsed));
            resolve({ success: false, error: parsed.message || 'Unknown error' });
          }
        } catch {
          resolve({ success: false, error: 'Parse error' });
        }
      });
    }).on('error', (err) => {
      console.error('[SMS] Request error:', err.message);
      resolve({ success: false, error: err.message });
    });
  });
};

// ── Send OTP ────────────────────────────────────────────────────────────
const sendOtpSms = async (phone, otp) => {
  return sendViaSMS(phone, null, true, otp);
};

// ── Order placed confirmation ───────────────────────────────────────────
const sendOrderSms = async (phone, orderId, total) => {
  const message = `Eptomart: Order #${orderId} confirmed! Total Rs.${total}. Track at eptomart.in/orders`;
  return sendViaSMS(phone, message, false);
};

// ── Order status update ─────────────────────────────────────────────────
const sendOrderStatusSms = async (phone, orderId, status) => {
  const message = `Eptomart: Order #${orderId} is now ${status}. Track at eptomart.in/orders`;
  return sendViaSMS(phone, message, false);
};

module.exports = { sendOtpSms, sendOrderSms, sendOrderStatusSms };
