const express = require('express');
const router  = express.Router();
const { getSettings, updateSettings } = require('../controllers/settingsController');
const { protectSuperAdmin } = require('../middleware/adminAuth');

router.get('/',  getSettings);                    // public — storefront + invoice preview
router.put('/',  ...protectSuperAdmin, updateSettings); // superAdmin only

// ── Contact form — public ────────────────────
router.post('/contact', async (req, res) => {
  const { name, email, phone, subject, message } = req.body;
  if (!name || !message) return res.status(400).json({ success: false, message: 'Name and message are required' });

  try {
    const { sendOtpEmail } = require('../utils/sendEmail');
    // Use Resend directly for generic email
    const sendViaResend = require('../utils/sendEmail').__sendRaw || null;
    const recipient = process.env.CONTACT_EMAIL || 'eptosicare@gmail.com';
    // Fallback: use OTP email util's underlying transport by calling sendOtpEmail-style
    // Actually just call sendViaResend directly via dynamic require of the internal function
    const emailModule = require('../utils/sendEmail');
    // sendOtpEmail is just a wrapper around sendViaResend — call it as generic mailer
    const _sendRaw = (to, subject, html) => {
      // Inline resend call (matches the internal sendViaResend signature)
      const https = require('https');
      return new Promise((resolve) => {
        const payload = JSON.stringify({
          from: process.env.EMAIL_FROM || 'Eptomart <onboarding@resend.dev>',
          to, subject, html,
        });
        const options = {
          hostname: 'api.resend.com', path: '/emails', method: 'POST',
          headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
        };
        const req = https.request(options, (r) => { let d=''; r.on('data', c=>d+=c); r.on('end', () => resolve(r.statusCode < 300 ? {success:true} : {success:false})); });
        req.on('error', () => resolve({success:false}));
        req.write(payload); req.end();
      });
    };
    const html = `
      <h2>New Contact Form Message — Eptomart</h2>
      <table style="font-family:sans-serif;font-size:14px;border-collapse:collapse;width:100%">
        <tr><td style="padding:6px;font-weight:bold;color:#555">Name</td><td style="padding:6px">${name}</td></tr>
        <tr><td style="padding:6px;font-weight:bold;color:#555">Email</td><td style="padding:6px">${email || '—'}</td></tr>
        <tr><td style="padding:6px;font-weight:bold;color:#555">Phone</td><td style="padding:6px">${phone || '—'}</td></tr>
        <tr><td style="padding:6px;font-weight:bold;color:#555">Subject</td><td style="padding:6px">${subject || '—'}</td></tr>
        <tr><td style="padding:6px;font-weight:bold;color:#555;vertical-align:top">Message</td><td style="padding:6px;white-space:pre-wrap">${message}</td></tr>
      </table>
    `;
    await _sendRaw(recipient, `Contact Form: ${subject || 'Message from ' + name}`, html);
    res.json({ success: true, message: 'Message sent successfully' });
  } catch (err) {
    console.error('[Contact] Email send failed:', err.message);
    res.status(500).json({ success: false, message: 'Failed to send message. Please try again.' });
  }
});

module.exports = router;
