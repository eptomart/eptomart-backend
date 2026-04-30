// ============================================
// EMAIL UTILITY
// Primary:  Gmail SMTP via Nodemailer (set GMAIL_USER + GMAIL_APP_PASSWORD)
// Fallback: Resend API (set RESEND_API_KEY)
// ============================================
const nodemailer = require('nodemailer');
const https      = require('https');

// ── Transport factory ───────────────────────
let _gmailTransport = null;

const getGmailTransport = () => {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) return null;
  if (_gmailTransport) return _gmailTransport;
  _gmailTransport = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD,   // 16-char App Password, not your Google password
    },
    pool: true,
    maxConnections: 3,
    rateDelta: 1000,
    rateLimit: 5,
  });
  return _gmailTransport;
};

// ── Core send function — Gmail first, Resend fallback ───────────────
const sendMail = async (to, subject, html, attachments = []) => {
  const transport = getGmailTransport();

  if (transport) {
    try {
      const mailOptions = {
        from: `"${process.env.EMAIL_FROM_NAME || 'Eptomart'}" <${process.env.GMAIL_USER}>`,
        to,
        subject,
        html,
        attachments: attachments.map(a => ({
          filename:    a.filename,
          content:     Buffer.from(a.content, 'base64'),
          contentType: 'application/pdf',
        })),
      };
      await transport.sendMail(mailOptions);
      console.log(`📧 [Gmail SMTP] Email sent to: ${to}`);
      return { success: true };
    } catch (err) {
      console.error('[Email] Gmail SMTP failed, falling back to Resend:', err.message);
    }
  }

  // Resend API fallback
  return sendViaResend(to, subject, html, attachments);
};

// ── Resend API helper ───────────────────────
const sendViaResend = (to, subject, html, attachments = []) => {
  if (!process.env.RESEND_API_KEY) {
    console.error('[Email] No transport configured. Set GMAIL_USER+GMAIL_APP_PASSWORD or RESEND_API_KEY.');
    return Promise.resolve({ success: false, error: 'No email transport configured' });
  }

  return new Promise((resolve) => {
    const payload = {
      from:    process.env.EMAIL_FROM || 'Eptomart <onboarding@resend.dev>',
      to,
      subject,
      html,
    };
    if (attachments.length) payload.attachments = attachments;
    const body = JSON.stringify(payload);

    const options = {
      hostname: 'api.resend.com',
      path:     '/emails',
      method:   'POST',
      headers: {
        'Authorization':  `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          console.log(`📧 [Resend] Email sent to: ${to}`);
          resolve({ success: true });
        } else {
          console.error('[Email] Resend API error:', data);
          resolve({ success: false, error: data });
        }
      });
    });

    req.on('error', (err) => {
      console.error('[Email] Resend request error:', err.message);
      resolve({ success: false, error: err.message });
    });

    req.write(body);
    req.end();
  });
};

// ── OTP Email ───────────────────────────────
const sendOtpEmail = async (to, otp, purpose = 'login') => {
  console.log(`📧 Sending OTP to: ${to} (purpose: ${purpose})`);
  const purposeText = purpose === 'register' ? 'Registration' : 'Login';
  const expiry = process.env.OTP_EXPIRY_MINUTES || 10;

  const html = `
    <!DOCTYPE html><html><head><meta charset="utf-8">
    <style>
      body{font-family:Arial,sans-serif;background:#f4f4f4;margin:0;padding:20px}
      .container{max-width:500px;margin:0 auto;background:white;border-radius:12px;overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,.1)}
      .header{background:linear-gradient(135deg,#f97316,#ea580c);padding:30px;text-align:center}
      .header h1{color:white;margin:0;font-size:28px}
      .body{padding:30px}
      .otp-box{background:#fff7ed;border:2px dashed #f97316;border-radius:8px;padding:20px;text-align:center;margin:20px 0}
      .otp{font-size:40px;font-weight:bold;color:#ea580c;letter-spacing:10px;font-family:monospace}
      .footer{background:#f9f9f9;padding:15px;text-align:center;font-size:12px;color:#999}
    </style></head>
    <body>
      <div class="container">
        <div class="header"><h1>🛒 Eptomart</h1></div>
        <div class="body">
          <h2>Your ${purposeText} OTP</h2>
          <p style="color:#555">Use the code below to complete your ${purposeText.toLowerCase()} on Eptomart.</p>
          <div class="otp-box">
            <div class="otp">${otp}</div>
            <p style="margin:10px 0 0;color:#888;font-size:13px">Valid for ${expiry} minutes · Do not share this code</p>
          </div>
          <p style="color:#999;font-size:13px">If you didn't request this OTP, please ignore this email. Your account is safe.</p>
        </div>
        <div class="footer"><p>© ${new Date().getFullYear()} Eptomart. All rights reserved.</p></div>
      </div>
    </body></html>
  `;

  const result = await sendMail(to, `${otp} is your Eptomart ${purposeText} OTP`, html);
  if (!result.success) console.error('[OTP] Email delivery failed for:', to);
  return result;
};

// ── Order Confirmation Email ─────────────────
const sendOrderConfirmation = async (to, order, opts = {}) => {
  const { userName = '', invoicePdfBuf = null, invoiceNumber = '' } = opts;

  const itemRows = (order.items || []).map(item => `
    <tr>
      <td style="padding:10px 12px;border-bottom:1px solid #f0f0f0;color:#333">${item.name}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #f0f0f0;text-align:center;color:#555">${item.quantity}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #f0f0f0;text-align:right;font-weight:600;color:#333">₹${((item.price || 0) * item.quantity).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
    </tr>
  `).join('');

  const html = `
    <!DOCTYPE html><html><head><meta charset="utf-8"></head>
    <body style="font-family:Arial,sans-serif;background:#f4f4f4;margin:0;padding:20px">
      <div style="max-width:580px;margin:0 auto;background:white;border-radius:12px;overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,.08)">
        <div style="background:linear-gradient(135deg,#f97316,#ea580c);padding:32px 30px;text-align:center">
          <h1 style="color:white;margin:0 0 4px;font-size:26px">🛒 Eptomart</h1>
          <p style="color:rgba(255,255,255,.85);margin:0;font-size:14px">Order Confirmed!</p>
        </div>
        <div style="padding:30px">
          <h2 style="color:#333;margin-top:0">Hello${userName ? ', ' + userName : ''}! 🎉</h2>
          <p style="color:#555;font-size:15px;line-height:1.6">Your order <strong style="color:#ea580c">#${order.orderId}</strong> has been placed successfully.</p>
          <table style="width:100%;border-collapse:collapse;margin:20px 0;font-size:14px">
            <thead><tr style="background:#f97316">
              <th style="padding:10px 12px;text-align:left;color:white">Item</th>
              <th style="padding:10px 12px;text-align:center;color:white">Qty</th>
              <th style="padding:10px 12px;text-align:right;color:white">Amount</th>
            </tr></thead>
            <tbody>${itemRows}</tbody>
          </table>
          <div style="background:#fff7ed;border-radius:8px;padding:16px 20px;margin-bottom:20px">
            <div style="display:flex;justify-content:space-between;font-size:14px;color:#555;margin-bottom:6px"><span>Subtotal (excl. GST)</span><span>₹${(order.pricing?.subtotal || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span></div>
            ${(order.pricing?.tax || 0) > 0 ? `<div style="display:flex;justify-content:space-between;font-size:14px;color:#555;margin-bottom:6px"><span>GST</span><span>₹${(order.pricing.tax).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span></div>` : ''}
            ${(order.pricing?.shipping || 0) > 0 ? `<div style="display:flex;justify-content:space-between;font-size:14px;color:#555;margin-bottom:6px"><span>Shipping</span><span>₹${order.pricing.shipping.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span></div>` : '<div style="font-size:13px;color:#22c55e;margin-bottom:6px">✅ Free Shipping</div>'}
            <div style="display:flex;justify-content:space-between;font-size:16px;font-weight:bold;color:#333;border-top:1px solid #f97316;padding-top:8px">
              <span>Grand Total</span><span style="color:#ea580c">₹${(order.pricing?.total || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
            </div>
          </div>
          <p style="font-size:14px;color:#555">
            <strong>Payment:</strong> ${(order.paymentMethod || '').toUpperCase()}&nbsp;&nbsp;
            <strong>Status:</strong> ${order.paymentMethod === 'cod' ? 'Pay on Delivery' : 'Paid'}
          </p>
          ${invoiceNumber ? `<p style="font-size:13px;color:#888">Invoice <strong>${invoiceNumber}</strong> is attached.</p>` : ''}
          <a href="https://eptomart.com/orders" style="display:inline-block;background:linear-gradient(135deg,#f97316,#ea580c);color:white;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:700;font-size:14px;margin-top:8px">Track Your Order →</a>
        </div>
        <div style="background:#f9f9f9;padding:16px 30px;text-align:center;font-size:12px;color:#999">
          <p style="margin:0">© ${new Date().getFullYear()} Eptomart. Questions? <a href="mailto:support@eptomart.com" style="color:#f97316">support@eptomart.com</a></p>
        </div>
      </div>
    </body></html>
  `;

  const attachments = invoicePdfBuf
    ? [{ filename: `invoice-${invoiceNumber || order.orderId}.pdf`, content: invoicePdfBuf.toString('base64') }]
    : [];

  return sendMail(to, `Order Confirmed — #${order.orderId} | Eptomart`, html, attachments);
};

// ── Seller New Order Email ───────────────────
const sendSellerNewOrderEmail = async (to, { businessName, orderId, items = [], total = 0 }) => {
  const itemRows = items.map(i => `
    <tr>
      <td style="padding:10px 12px;border-bottom:1px solid #f0f0f0;color:#333">${i.name}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #f0f0f0;text-align:center;color:#555">${i.qty}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #f0f0f0;text-align:right;font-weight:600;color:#333">₹${((i.price || 0) * i.qty).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
    </tr>
  `).join('');

  const html = `
    <!DOCTYPE html><html><head><meta charset="utf-8"></head>
    <body style="font-family:Arial,sans-serif;background:#f4f4f4;margin:0;padding:20px">
      <div style="max-width:580px;margin:0 auto;background:white;border-radius:12px;overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,.08)">
        <div style="background:linear-gradient(135deg,#1e40af,#1d4ed8);padding:32px 30px;text-align:center">
          <h1 style="color:white;margin:0;font-size:26px">📦 New Order Received!</h1>
          <p style="color:rgba(255,255,255,.85);margin:4px 0 0;font-size:14px">Action required — please confirm</p>
        </div>
        <div style="padding:30px">
          <h2 style="color:#333;margin-top:0">Hello, ${businessName}!</h2>
          <p style="color:#555;font-size:15px;line-height:1.6">You have a new order <strong style="color:#1d4ed8">#${orderId}</strong> waiting for confirmation.</p>
          <table style="width:100%;border-collapse:collapse;margin:20px 0;font-size:14px">
            <thead><tr style="background:#1d4ed8">
              <th style="padding:10px 12px;text-align:left;color:white">Product</th>
              <th style="padding:10px 12px;text-align:center;color:white">Qty</th>
              <th style="padding:10px 12px;text-align:right;color:white">Amount</th>
            </tr></thead>
            <tbody>${itemRows}</tbody>
            <tfoot><tr style="background:#eff6ff">
              <td colspan="2" style="padding:10px 12px;font-weight:bold;color:#1d4ed8">Order Total</td>
              <td style="padding:10px 12px;text-align:right;font-weight:bold;color:#1d4ed8">₹${total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
            </tr></tfoot>
          </table>
          <div style="background:#fef3c7;border-left:4px solid #f59e0b;padding:12px 16px;border-radius:4px;margin-bottom:20px;font-size:14px;color:#92400e">
            ⏰ Please confirm within 24 hours to avoid automatic cancellation.
          </div>
          <a href="https://eptomart.com/seller/orders" style="display:inline-block;background:linear-gradient(135deg,#f97316,#ea580c);color:white;text-decoration:none;padding:13px 28px;border-radius:8px;font-weight:700;font-size:15px">Confirm Order →</a>
        </div>
        <div style="background:#f9f9f9;padding:16px 30px;text-align:center;font-size:12px;color:#999">
          <p style="margin:0">© ${new Date().getFullYear()} Eptomart</p>
        </div>
      </div>
    </body></html>
  `;

  return sendMail(to, `New Order #${orderId} — Action Required | Eptomart`, html);
};

// ── Seller Welcome Email ─────────────────────
const sendSellerWelcomeEmail = async (to, { businessName, loginId }) => {
  const html = `
    <!DOCTYPE html><html><head><meta charset="utf-8">
    <style>
      body{font-family:Arial,sans-serif;background:#f0f2f5;margin:0;padding:28px 16px}
      .wrap{max-width:600px;margin:0 auto}
      .header{background:linear-gradient(135deg,#f97316,#c2410c);border-radius:16px 16px 0 0;padding:40px 36px 32px;text-align:center}
      .header h1{color:white;margin:0 0 6px;font-size:26px;font-weight:800}
      .header p{color:rgba(255,255,255,.85);margin:0;font-size:14px}
      .body{background:white;padding:36px}
      .login-card{border:1.5px solid #fed7aa;border-radius:14px;overflow:hidden;margin-bottom:30px}
      .login-header{background:#fff7ed;padding:14px 20px;border-bottom:1px solid #fed7aa;font-size:13px;font-weight:800;color:#c2410c;text-transform:uppercase;letter-spacing:.7px}
      .login-body{padding:20px}
      .step{display:flex;gap:14px;margin-bottom:16px;align-items:flex-start}
      .badge{background:#f97316;color:white;font-size:12px;font-weight:800;min-width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px}
      .step-body{font-size:14px;color:#444;line-height:1.6}
      .email-chip{display:inline-block;margin-top:6px;background:white;border:1.5px solid #f97316;border-radius:8px;padding:7px 14px;font-family:monospace;font-size:14px;font-weight:700;color:#c2410c}
      .cta{text-align:center;margin:6px 0 30px}
      .btn{display:inline-block;background:linear-gradient(135deg,#f97316,#c2410c);color:white!important;text-decoration:none;padding:15px 36px;border-radius:10px;font-weight:800;font-size:15px}
      .footer{background:#f9fafb;border-top:1px solid #e5e7eb;border-radius:0 0 16px 16px;padding:20px 36px;text-align:center;font-size:12px;color:#9ca3af}
      .footer a{color:#f97316;text-decoration:none}
    </style>
    </head>
    <body><div class="wrap">
      <div class="header">
        <h1>Welcome aboard, ${businessName}! 🎉</h1>
        <p>Your Eptomart seller account is ready.</p>
      </div>
      <div class="body">
        <p style="color:#555;font-size:15px;line-height:1.7;margin-bottom:24px">
          You're now part of India's growing community of online sellers on <strong>Eptomart</strong>.
          Here's how to log in and start selling.
        </p>
        <div class="login-card">
          <div class="login-header">🔐 How to Log In — No Password Needed</div>
          <div class="login-body">
            <div class="step"><div class="badge">1</div><div class="step-body">Go to <strong>eptomart.com/login</strong> and enter your email:<br><span class="email-chip">${loginId}</span></div></div>
            <div class="step"><div class="badge">2</div><div class="step-body">Click <strong>"Send OTP"</strong> — a 6-digit code will arrive in this inbox.</div></div>
            <div class="step"><div class="badge">3</div><div class="step-body">Enter the OTP and you're in — no password ever needed.</div></div>
          </div>
        </div>
        <div class="cta"><a href="https://eptomart.com/login" class="btn">Go to Seller Dashboard →</a></div>
        <p style="color:#777;font-size:13px;line-height:1.7;margin:0">
          Your account is under review. You'll receive an activation email once approved.
        </p>
      </div>
      <div class="footer">
        <p>Questions? <a href="mailto:support@eptomart.com">support@eptomart.com</a></p>
        <p style="margin:4px 0 0">© ${new Date().getFullYear()} Eptomart</p>
      </div>
    </div></body></html>
  `;
  return sendMail(to, `Welcome to Eptomart — ${businessName}`, html);
};

// ── Seller Activated Email ───────────────────
const sendSellerActivatedEmail = async (to, { businessName }) => {
  const html = `
    <!DOCTYPE html><html><head><meta charset="utf-8"></head>
    <body style="font-family:Arial,sans-serif;background:#f4f4f4;margin:0;padding:20px">
      <div style="max-width:560px;margin:0 auto;background:white;border-radius:12px;overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,.1)">
        <div style="background:linear-gradient(135deg,#22c55e,#16a34a);padding:36px 30px;text-align:center">
          <h1 style="color:white;margin:0 0 4px;font-size:28px">✅ Account Activated!</h1>
          <p style="color:rgba(255,255,255,.85);margin:0;font-size:15px">You're now live on Eptomart</p>
        </div>
        <div style="padding:32px 30px">
          <h2 style="color:#333;margin-top:0">Congratulations, ${businessName}! 🎊</h2>
          <p style="color:#555;font-size:15px;line-height:1.6">Your seller account has been <strong>reviewed and activated</strong>. You can now list products and receive orders!</p>
          <a href="https://eptomart.com/seller/products" style="display:inline-block;background:linear-gradient(135deg,#f97316,#ea580c);color:white;text-decoration:none;padding:13px 28px;border-radius:8px;font-weight:700;font-size:15px;margin:20px 0">Start Listing Products →</a>
        </div>
        <div style="background:#f9f9f9;padding:16px 30px;text-align:center;font-size:12px;color:#999">
          <p style="margin:0">© ${new Date().getFullYear()} Eptomart</p>
        </div>
      </div>
    </body></html>
  `;
  return sendMail(to, `Your Eptomart Seller Account is Now Active! — ${businessName}`, html);
};

/**
 * Generic email sender — use for any transactional email not covered by a specific helper.
 * @param {{ to, subject, html, attachments? }} opts
 */
const sendEmail = ({ to, subject, html, attachments = [] }) =>
  sendViaResend(to, subject, html, attachments);

module.exports = {
  sendOtpEmail,
  sendOrderConfirmation,
  sendSellerNewOrderEmail,
  sendSellerWelcomeEmail,
  sendSellerActivatedEmail,
  sendEmail,
};
