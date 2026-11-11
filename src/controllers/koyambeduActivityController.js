// ============================================
// KOYAMBEDU DAILY — customer activity endpoints
//   POST /api/koyambedu/activity                (logged-in customer beacon)
//   GET  /api/koyambedu/admin/activity          (super admin: unified feed)
//   GET  /api/koyambedu/admin/activity/summary
//   GET  /api/koyambedu/admin/activity/users
//   GET  /api/koyambedu/admin/activity/user/:userId
//   GET  /api/koyambedu/admin/activity/export   (CSV)
// ============================================
const svc = require('../services/koyambeduActivityService');

const fail = (res, status, message) => res.status(status).json({ success: false, message });
const CLIENT_TYPES = ['page_view', 'product_view', 'search', 'checkout_view'];   // cart changes are logged server-side
const isId = (v) => /^[a-f\d]{24}$/i.test(String(v || ''));

// Customer beacon — always answers fast and never errors the page
const track = (req, res) => {
  const { type, page, productId, query } = req.body || {};
  if (CLIENT_TYPES.includes(type)) {
    const data = {};
    if (page && String(page).startsWith('/koyambedu')) data.page = String(page);
    if (isId(productId)) data.product = productId;
    if (type === 'search') { if (!query || String(query).trim().length < 2) return res.status(204).end(); data.query = query; }
    if (type === 'product_view' && !data.product) return res.status(204).end();
    svc.logActivity(req, type, data);
  }
  res.status(204).end();
};

const wrap = (fn) => async (req, res) => {
  try { await fn(req, res); }
  catch (err) { console.error('[koyambeduActivity]', err); fail(res, 500, 'Failed to load activity'); }
};

const adminFeed = wrap(async (req, res) => { res.json({ success: true, ...(await svc.feed(req.query)) }); });
const adminSummary = wrap(async (req, res) => { res.json({ success: true, summary: await svc.summary(req.query) }); });
const adminUsers = wrap(async (req, res) => { res.json({ success: true, ...(await svc.users(req.query)) }); });
const adminProfile = wrap(async (req, res) => {
  const p = await svc.profile(req.params.userId);
  if (!p) return fail(res, 404, 'Customer not found');
  res.json({ success: true, profile: p });
});
const adminExport = wrap(async (req, res) => {
  const csv = await svc.csv(req.query);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="koyambedu-activity-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send('﻿' + csv);
});

module.exports = { track, adminFeed, adminSummary, adminUsers, adminProfile, adminExport };
