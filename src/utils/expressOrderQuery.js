// ============================================
// EPTOMART EXPRESS — shared order search (store view + super-admin view)
// One filter builder so a store owner and the super admin see the SAME
// numbers for the same filters. The store view forces `store` (never taken
// from the client) and defaults to PAID orders only; the admin view can
// look across every store and sees unpaid / failed orders too.
//
// Filters: from/to (IST calendar days, inclusive), status, payment
// (paid | pending | failed | all), storeId (admin only), search (order id,
// customer name, phone), item (product name), location (address / city /
// pincode), pincode (exact).
// ============================================
const mongoose = require('mongoose');
const ExpressOrder = require('../models/ExpressOrder');

const esc = (s) => String(s).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const STATUSES = ['placed', 'confirmed', 'preparing', 'out_for_delivery', 'delivered', 'cancelled'];
const PAYMENTS = ['paid', 'pending', 'failed'];

// 'YYYY-MM-DD' is an IST calendar day; anything else is parsed as given.
const startOf = (v) => new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00.000+05:30` : v);
const endOf = (v) => new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T23:59:59.999+05:30` : v);

/**
 * @param q     req.query
 * @param opts  { store?: id (forces the store), defaultPayment?: 'paid'|'all' }
 */
function buildOrderFilter(q = {}, opts = {}) {
  const filter = {};
  if (opts.store) filter.store = new mongoose.Types.ObjectId(String(opts.store));
  else if (q.storeId && /^[a-f\d]{24}$/i.test(String(q.storeId))) filter.store = new mongoose.Types.ObjectId(String(q.storeId));

  if (q.status && STATUSES.includes(q.status)) filter.orderStatus = q.status;

  const pay = q.payment || opts.defaultPayment || 'all';
  if (PAYMENTS.includes(pay)) filter.paymentStatus = pay;

  if (q.from || q.to) {
    filter.createdAt = {};
    if (q.from) { const d = startOf(q.from); if (!isNaN(d)) filter.createdAt.$gte = d; }
    if (q.to) { const d = endOf(q.to); if (!isNaN(d)) filter.createdAt.$lte = d; }
    if (!Object.keys(filter.createdAt).length) delete filter.createdAt;
  }

  const and = [];
  if (q.search && String(q.search).trim()) {
    const rx = new RegExp(esc(q.search), 'i');
    and.push({ $or: [{ orderId: rx }, { 'deliveryAddress.name': rx }, { 'deliveryAddress.phone': rx }] });
  }
  if (q.item && String(q.item).trim()) and.push({ 'items.name': new RegExp(esc(q.item), 'i') });
  if (q.location && String(q.location).trim()) {
    const rx = new RegExp(esc(q.location), 'i');
    and.push({ $or: [{ 'deliveryAddress.addressLine': rx }, { 'deliveryAddress.city': rx }, { 'deliveryAddress.pincode': rx }] });
  }
  if (q.pincode && /^\d{6}$/.test(String(q.pincode).trim())) filter['deliveryAddress.pincode'] = String(q.pincode).trim();
  if (and.length) filter.$and = and;
  return filter;
}

/** Totals for everything matching the filter (not just the current page). */
async function summarize(filter) {
  const rows = await ExpressOrder.aggregate([
    { $match: filter },
    { $group: {
      _id: '$orderStatus',
      n: { $sum: 1 },
      gross: { $sum: { $cond: [{ $eq: ['$paymentStatus', 'paid'] }, '$pricing.total', 0] } },
      refunded: { $sum: { $ifNull: ['$pricing.refundedAmount', 0] } },
    } },
  ]);
  const byStatus = {}; let count = 0, gross = 0, refunded = 0;
  for (const r of rows) {
    byStatus[r._id] = r.n; count += r.n;
    gross += r.gross; refunded += r.refunded;
  }
  return { count, gross: r2(gross), refunded: r2(refunded), net: r2(gross - refunded), byStatus };
}

/** Run a filtered, paginated search. `populateStore` for the admin view. */
async function searchOrders(q, opts = {}) {
  const filter = buildOrderFilter(q, opts);
  const limit = Math.min(200, Math.max(1, Number(q.limit) || 50));
  const page = Math.max(1, Number(q.page) || 1);
  let query = ExpressOrder.find(filter).populate('buyer', 'name phone');
  if (opts.populateStore) query = query.populate('store', 'name code');
  const [orders, total, summary] = await Promise.all([
    query.sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    ExpressOrder.countDocuments(filter),
    summarize(filter),
  ]);
  return { orders, total, page, limit, hasMore: page * limit < total, summary };
}

const csvCell = (v) => { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const ist = (d) => new Date(d).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

/** CSV of every order matching the filter (capped at 5,000 rows). */
async function ordersCsv(q, opts = {}) {
  const filter = buildOrderFilter(q, opts);
  const orders = await ExpressOrder.find(filter).populate('store', 'name').sort({ createdAt: -1 }).limit(5000).lean();
  const head = ['Order ID', 'Date (IST)', 'Store', 'Customer', 'Phone', 'Address', 'Pincode', 'Items', 'Order status', 'Payment', 'Total', 'Refunded', 'Net', 'Delivery slot'];
  const rows = orders.map((o) => {
    const refunded = r2(o.pricing?.refundedAmount || 0);
    const total = r2(o.pricing?.total || 0);
    const a = o.deliveryAddress || {};
    return [
      o.orderId, ist(o.createdAt), o.store?.name || '', a.name || '', a.phone || '',
      [a.addressLine, a.city].filter(Boolean).join(', '), a.pincode || '',
      (o.items || []).map((i) => `${i.name} x${i.quantity}${i.status === 'declined' ? ' (declined)' : ''}`).join('; '),
      o.orderStatus, o.paymentStatus, total, refunded, o.paymentStatus === 'paid' ? r2(total - refunded) : 0,
      o.deliverySlot ? `${o.deliverySlot.date || ''} ${o.deliverySlot.label || ''}`.trim() : '',
    ].map(csvCell).join(',');
  });
  return [head.join(','), ...rows].join('\n');
}

module.exports = { buildOrderFilter, summarize, searchOrders, ordersCsv, STATUSES };
