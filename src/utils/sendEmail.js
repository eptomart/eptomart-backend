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

/**
 * Send seller welcome / onboarding email
 */
const sendSellerWelcomeEmail = async (to, { businessName, loginId, tempPassword }) => {
  const html = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8">
    <style>
      body { font-family: Arial, sans-serif; background: #f4f4f4; margin: 0; padding: 20px; }
      .container { max-width: 560px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
      .header { background: linear-gradient(135deg, #f97316, #ea580c); padding: 36px 30px; text-align: center; }
      .header h1 { color: white; margin: 0 0 4px; font-size: 28px; }
      .header p { color: rgba(255,255,255,0.85); margin: 0; font-size: 15px; }
      .body { padding: 32px 30px; }
      .creds { background: #fff7ed; border: 2px dashed #f97316; border-radius: 8px; padding: 20px; margin: 20px 0; }
      .creds p { margin: 6px 0; font-size: 14px; color: #444; }
      .creds strong { color: #ea580c; font-family: monospace; font-size: 15px; }
      .btn { display: inline-block; background: linear-gradient(135deg,#f97316,#ea580c); color: white !important; text-decoration: none; padding: 13px 28px; border-radius: 8px; font-weight: 700; font-size: 15px; margin: 20px 0; }
      .steps { margin: 20px 0; }
      .steps li { margin-bottom: 8px; font-size: 14px; color: #555; }
      .footer { background: #f9f9f9; padding: 16px 30px; text-align: center; font-size: 12px; color: #999; }
    </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>🛒 Eptomart</h1>
          <p>Welcome to India's growing seller community!</p>
        </div>
        <div class="body">
          <h2 style="color:#333;margin-top:0;">Hello, ${businessName}! 🎉</h2>
          <p style="color:#555;font-size:15px;line-height:1.6;">
            We're thrilled to have you on the <strong>Eptomart Seller Platform</strong>.
            Your account has been set up and you're ready to start your selling journey.
            Reach thousands of customers across India — all from one simple dashboard.
          </p>

          <div class="creds">
            <p>🔑 <strong>Login ID:</strong> <strong>${loginId}</strong></p>
            <p>🔒 <strong>Temp Password:</strong> <strong>${tempPassword}</strong></p>
            <p style="color:#f97316;font-size:12px;margin-top:10px;">⚠️ Please change your password after your first login.</p>
          </div>

          <a href="https://eptomart.com/seller" class="btn">Go to Seller Portal →</a>

          <p style="color:#555;font-size:14px;font-weight:600;margin-bottom:8px;">Getting started checklist:</p>
          <ul class="steps">
            <li>✅ Log in to your seller portal</li>
            <li>📦 Add your first product listing</li>
            <li>🏦 Set up your bank details for payments</li>
            <li>📋 Review seller guidelines</li>
          </ul>

          <p style="color:#555;font-size:14px;line-height:1.6;">
            Your account will be reviewed and activated by our team shortly.
            You'll receive a confirmation as soon as it goes live. 🚀
          </p>
        </div>
        <div class="footer">
          <p>Questions? Email us at <a href="mailto:support@eptomart.com" style="color:#f97316;">support@eptomart.com</a></p>
          <p>© ${new Date().getFullYear()} Eptomart. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `;
  return sendViaResend(to, `Welcome to Eptomart Seller Platform — ${businessName}`, html);
};

/**
 * Send seller account activated email
 */
const sendSellerActivatedEmail = async (to, { businessName }) => {
  const html = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8">
    <style>
      body { font-family: Arial, sans-serif; background: #f4f4f4; margin: 0; padding: 20px; }
      .container { max-width: 560px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
      .header { background: linear-gradient(135deg, #22c55e, #16a34a); padding: 36px 30px; text-align: center; }
      .header h1 { color: white; margin: 0 0 4px; font-size: 28px; }
      .header p { color: rgba(255,255,255,0.85); margin: 0; font-size: 15px; }
      .body { padding: 32px 30px; }
      .btn { display: inline-block; background: linear-gradient(135deg,#f97316,#ea580c); color: white !important; text-decoration: none; padding: 13px 28px; border-radius: 8px; font-weight: 700; font-size: 15px; margin: 20px 0; }
      .footer { background: #f9f9f9; padding: 16px 30px; text-align: center; font-size: 12px; color: #999; }
    </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>✅ Account Activated!</h1>
          <p>You're now live on Eptomart</p>
        </div>
        <div class="body">
          <h2 style="color:#333;margin-top:0;">Congratulations, ${businessName}! 🎊</h2>
          <p style="color:#555;font-size:15px;line-height:1.6;">
            Great news — your Eptomart seller account has been <strong>reviewed and activated</strong>.
            You can now list products, receive orders, and start growing your business online!
          </p>
          <p style="color:#555;font-size:15px;line-height:1.6;">
            Thousands of customers are already browsing Eptomart daily.
            Make sure your product listings have great photos and accurate descriptions for the best results. 📸
          </p>
          <a href="https://eptomart.com/seller/products" class="btn">Start Listing Products →</a>
          <p style="color:#555;font-size:14px;">
            Need help? Our seller support team is just an email away at
            <a href="mailto:support@eptomart.com" style="color:#f97316;">support@eptomart.com</a>
          </p>
        </div>
        <div class="footer">
          <p>© ${new Date().getFullYear()} Eptomart. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `;
  return sendViaResend(to, `Your Eptomart Seller Account is Now Active! — ${businessName}`, html);
};

module.exports = { sendOtpEmail, sendOrderConfirmation, sendSellerWelcomeEmail, sendSellerActivatedEmail };
