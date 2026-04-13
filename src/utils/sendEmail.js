// ============================================
// EMAIL UTILITY — Resend API (works on all cloud servers)
// Sign up free at: https://resend.com
// ============================================
const https = require('https');

const sendViaResend = (to, subject, html) => {
  return new Promise((resolve) => {
    const body = JSON.stringify({
      from: process.env.EMAIL_FROM || 'Eptomart <onboarding@resend.dev>',
      to,
      subject,
      html,
    });

    const options = {
      hostname: 'api.resend.com',
      path: '/emails',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
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
          console.error('Resend error:', data);
          resolve({ success: false, error: data });
        }
      });
    });

    req.on('error', (err) => {
      console.error('Resend request error:', err.message);
      resolve({ success: false, error: err.message });
    });

    req.write(body);
    req.end();
  });
};

/**
 * Send OTP email
 */
const sendOtpEmail = async (to, otp, purpose = 'login') => {
  console.log(`📧 Sending OTP email to: ${to}`);
  const purposeText = purpose === 'register' ? 'Registration' : 'Login';

  const html = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8">
    <style>
      body { font-family: Arial, sans-serif; background: #f4f4f4; margin: 0; padding: 20px; }
      .container { max-width: 500px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
      .header { background: linear-gradient(135deg, #f97316, #ea580c); padding: 30px; text-align: center; }
      .header h1 { color: white; margin: 0; font-size: 28px; }
      .body { padding: 30px; }
      .otp-box { background: #fff7ed; border: 2px dashed #f97316; border-radius: 8px; padding: 20px; text-align: center; margin: 20px 0; }
      .otp { font-size: 36px; font-weight: bold; color: #ea580c; letter-spacing: 8px; }
      .footer { background: #f9f9f9; padding: 15px; text-align: center; font-size: 12px; color: #999; }
    </style>
    </head>
    <body>
      <div class="container">
        <div class="header"><h1>🛒 Eptomart</h1></div>
        <div class="body">
          <h2>Your ${purposeText} OTP</h2>
          <p>Use the OTP below to complete your ${purposeText.toLowerCase()} on Eptomart.</p>
          <div class="otp-box">
            <div class="otp">${otp}</div>
            <p style="margin:8px 0 0;color:#666;font-size:13px;">Valid for ${process.env.OTP_EXPIRY_MINUTES || 10} minutes</p>
          </div>
          <p style="color:#666;font-size:14px;">⚠️ Never share this OTP with anyone.</p>
        </div>
        <div class="footer"><p>© ${new Date().getFullYear()} Eptomart. All rights reserved.</p></div>
      </div>
    </body>
    </html>
  `;

  return sendViaResend(to, `Eptomart — Your ${purposeText} OTP`, html);
};

/**
 * Send order confirmation email
 */
const sendOrderConfirmation = async (to, order) => {
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
      <h2 style="color:#ea580c;">✅ Order Confirmed!</h2>
      <p>Your order <strong>#${order.orderId}</strong> has been placed successfully.</p>
      <p><strong>Total:</strong> ₹${order.pricing.total.toLocaleString('en-IN')}</p>
      <p><strong>Payment:</strong> ${order.paymentMethod.toUpperCase()}</p>
      <p>We'll notify you when your order is shipped.</p>
      <p style="color:#999;font-size:12px;">© Eptomart</p>
    </div>
  `;
  return sendViaResend(to, `Order Confirmed — #${order.orderId} | Eptomart`, html);
};

module.exports = { sendOtpEmail, sendOrderConfirmation };
