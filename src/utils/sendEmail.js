// ============================================
// EMAIL UTILITY — Nodemailer (Gmail SMTP)
// ============================================
const nodemailer = require('nodemailer');

// Create transporter
const createTransporter = () => {
  return nodemailer.createTransport({
    host: process.env.EMAIL_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.EMAIL_PORT) || 587,
    secure: false,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
    connectionTimeout: 10000,  // 10 seconds
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });
};

/**
 * Send OTP email
 */
const sendOtpEmail = async (to, otp, purpose = 'login') => {
  try {
    console.log(`📧 Sending OTP email to: ${to}`);
    const transporter = createTransporter();
    const purposeText = purpose === 'register' ? 'Registration' : 'Login';

    await transporter.sendMail({
      from: process.env.EMAIL_FROM || 'Eptomart <noreply@eptomart.com>',
      to,
      subject: `Eptomart — Your ${purposeText} OTP`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: Arial, sans-serif; background: #f4f4f4; margin: 0; padding: 20px; }
            .container { max-width: 500px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
            .header { background: linear-gradient(135deg, #f97316, #ea580c); padding: 30px; text-align: center; }
            .header h1 { color: white; margin: 0; font-size: 28px; letter-spacing: 1px; }
            .body { padding: 30px; }
            .otp-box { background: #fff7ed; border: 2px dashed #f97316; border-radius: 8px; padding: 20px; text-align: center; margin: 20px 0; }
            .otp { font-size: 36px; font-weight: bold; color: #ea580c; letter-spacing: 8px; }
            .note { color: #666; font-size: 14px; margin-top: 20px; }
            .footer { background: #f9f9f9; padding: 15px; text-align: center; font-size: 12px; color: #999; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🛒 Eptomart</h1>
            </div>
            <div class="body">
              <h2>Your ${purposeText} OTP</h2>
              <p>Use the OTP below to complete your ${purposeText.toLowerCase()} on Eptomart.</p>
              <div class="otp-box">
                <div class="otp">${otp}</div>
                <p style="margin:8px 0 0;color:#666;font-size:13px;">Valid for ${process.env.OTP_EXPIRY_MINUTES || 10} minutes</p>
              </div>
              <p class="note">⚠️ Never share this OTP with anyone. Eptomart will never ask for your OTP.</p>
            </div>
            <div class="footer">
              <p>© ${new Date().getFullYear()} Eptomart. All rights reserved.</p>
            </div>
          </div>
        </body>
        </html>
      `,
    });

    return { success: true };
  } catch (error) {
    console.error('Email send error:', error.message);
    return { success: false, error: error.message };
  }
};

/**
 * Send order confirmation email
 */
const sendOrderConfirmation = async (to, order) => {
  try {
    const transporter = createTransporter();

    await transporter.sendMail({
      from: process.env.EMAIL_FROM,
      to,
      subject: `Order Confirmed — #${order.orderId} | Eptomart`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
          <h2 style="color:#ea580c;">✅ Order Confirmed!</h2>
          <p>Your order <strong>#${order.orderId}</strong> has been placed successfully.</p>
          <p><strong>Total:</strong> ₹${order.pricing.total.toLocaleString('en-IN')}</p>
          <p><strong>Payment:</strong> ${order.paymentMethod.toUpperCase()}</p>
          <p>We'll notify you when your order is shipped.</p>
          <p style="color:#999;font-size:12px;">© Eptomart</p>
        </div>
      `,
    });

    return { success: true };
  } catch (error) {
    console.error('Order email error:', error.message);
    return { success: false };
  }
};

module.exports = { sendOtpEmail, sendOrderConfirmation };
