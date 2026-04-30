const BusinessSettings = require('../models/BusinessSettings');
const Enquiry          = require('../models/Enquiry');
const { sendEmail }    = require('../utils/sendEmail');
const business         = require('../../config/business');

// ── GET /api/settings  — public ─────────────────────────────
const getSettings = async (req, res) => {
  const settings = await BusinessSettings.getSettings();
  res.json({ success: true, settings });
};

// ── PUT /api/settings  — superAdmin only ────────────────────
const updateSettings = async (req, res) => {
  const allowed = ['name', 'tagline', 'address', 'phone', 'email', 'website', 'gstNo', 'state', 'city', 'pincode'];
  let settings = await BusinessSettings.getSettings();
  allowed.forEach(k => { if (req.body[k] !== undefined) settings[k] = req.body[k]; });
  await settings.save();
  res.json({ success: true, settings });
};

// ── POST /api/settings/contact  — public ────────────────────
// Saves enquiry to DB and emails the admin team.
const contactUs = async (req, res) => {
  const { name, email, phone, subject, message } = req.body;

  if (!name?.trim() || !message?.trim()) {
    return res.status(400).json({ success: false, message: 'Name and message are required' });
  }

  // Save to database
  const enquiry = await Enquiry.create({
    name:      name.trim(),
    email:     email?.trim() || undefined,
    phone:     phone?.trim() || undefined,
    subject:   subject?.trim() || undefined,
    message:   message.trim(),
    ip:        req.ip || req.headers['x-forwarded-for'] || '',
    userAgent: req.headers['user-agent'] || '',
  });

  console.log(`[Contact] New enquiry #${enquiry._id} from ${name} (${email || phone || 'no contact'}): "${subject || 'General'}"`);

  // Email admin (non-blocking)
  const adminEmail = process.env.ADMIN_EMAIL || process.env.CONTACT_EMAIL || business.email || 'eptosicare@gmail.com';
  sendEmail({
    to:      adminEmail,
    subject: `📬 New Contact Enquiry — ${subject || 'General'} from ${name}`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
        <h2 style="color:#ea580c">New Contact Enquiry</h2>
        <table style="width:100%;border-collapse:collapse">
          <tr><td style="padding:8px;font-weight:bold;width:120px">Name</td><td style="padding:8px">${name}</td></tr>
          <tr style="background:#fef3c7"><td style="padding:8px;font-weight:bold">Email</td><td style="padding:8px">${email || '—'}</td></tr>
          <tr><td style="padding:8px;font-weight:bold">Phone</td><td style="padding:8px">${phone || '—'}</td></tr>
          <tr style="background:#fef3c7"><td style="padding:8px;font-weight:bold">Subject</td><td style="padding:8px">${subject || '—'}</td></tr>
          <tr><td style="padding:8px;font-weight:bold;vertical-align:top">Message</td><td style="padding:8px">${message.replace(/\n/g, '<br>')}</td></tr>
        </table>
        <p style="color:#666;font-size:12px;margin-top:20px">
          Received: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST
          &nbsp;|&nbsp; Enquiry ID: ${enquiry._id}
          &nbsp;|&nbsp; <a href="${process.env.FRONTEND_URL || 'https://eptomart.com'}/admin/enquiries">View in Admin Panel</a>
        </p>
      </div>
    `,
  }).catch(err => console.error('[Contact] Admin email failed:', err.message));

  // Auto-reply to sender (if email provided)
  if (email) {
    sendEmail({
      to:      email,
      subject: `We received your message — Eptomart`,
      html: `
        <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
          <h2 style="color:#ea580c">Thanks for reaching out, ${name}!</h2>
          <p>We've received your message and will get back to you within 24 hours (Mon–Sat, 9AM–7PM IST).</p>
          <div style="background:#fff7ed;border-left:4px solid #ea580c;padding:12px 16px;margin:16px 0;border-radius:4px">
            <strong>Your message:</strong><br>${message.replace(/\n/g, '<br>')}
          </div>
          <p>If you have an urgent query, call us at <strong>${business.phone || '+91-XXXXXXXXXX'}</strong>.</p>
          <p style="color:#999;font-size:12px">— Team Eptomart</p>
        </div>
      `,
    }).catch(() => {});
  }

  res.status(201).json({
    success: true,
    message: 'Message received! We\'ll reply within 24 hours.',
    enquiryId: enquiry._id,
  });
};

// ── GET /api/settings/enquiries  — admin only ───────────────
const getEnquiries = async (req, res) => {
  const { page = 1, limit = 20, status } = req.query;
  const filter = {};
  if (status) filter.status = status;

  const skip = (Number(page) - 1) * Number(limit);
  const [enquiries, total] = await Promise.all([
    Enquiry.find(filter).sort('-createdAt').skip(skip).limit(Number(limit)),
    Enquiry.countDocuments(filter),
  ]);

  // Count by status for badges
  const counts = await Enquiry.aggregate([
    { $group: { _id: '$status', count: { $sum: 1 } } }
  ]);
  const statusCounts = {};
  counts.forEach(c => { statusCounts[c._id] = c.count; });

  res.json({ success: true, enquiries, total, totalPages: Math.ceil(total / Number(limit)), statusCounts });
};

// ── PATCH /api/settings/enquiries/:id  — admin only ─────────
const updateEnquiry = async (req, res) => {
  const { status, adminReply } = req.body;
  const enquiry = await Enquiry.findById(req.params.id);
  if (!enquiry) return res.status(404).json({ success: false, message: 'Enquiry not found' });

  if (status) enquiry.status = status;
  if (adminReply !== undefined) {
    enquiry.adminReply = adminReply;
    enquiry.repliedAt  = new Date();
    enquiry.repliedBy  = req.user._id;

    // Email reply to customer
    if (enquiry.email && adminReply.trim()) {
      sendEmail({
        to:      enquiry.email,
        subject: `Re: ${enquiry.subject || 'Your enquiry'} — Eptomart`,
        html: `
          <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
            <h2 style="color:#ea580c">Reply from Eptomart</h2>
            <p>Hi ${enquiry.name},</p>
            <p>${adminReply.replace(/\n/g, '<br>')}</p>
            <hr style="margin:20px 0;border:none;border-top:1px solid #eee">
            <p style="color:#999;font-size:12px">Original message: ${enquiry.message}</p>
          </div>
        `,
      }).catch(() => {});
    }
  }

  await enquiry.save();
  res.json({ success: true, enquiry });
};

module.exports = { getSettings, updateSettings, contactUs, getEnquiries, updateEnquiry };
