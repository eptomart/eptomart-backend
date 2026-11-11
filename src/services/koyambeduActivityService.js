// ============================================
// KOYAMBEDU DAILY — customer activity (super admin)
//
// One unified, filterable timeline per customer / for everyone, built from:
//   • KoyambeduActivity  — page / product views, searches, cart changes, payment screen
//   • KoyambeduOrder     — payment started, order placed, every status / timeline step
//   • KoyambeduWallet    — wallet credits / debits (refunds, adjustments, …)
//   • KoyambeduCart      — items sitting in the cart right now (with when they were added)
//   • KoyambeduSpecialRequest — special requests
//   • User               — sign-up and last login
//
// Paging is cursor based (`before` = the `at` of the last event received) so
// "Load more" stays fast and never skips or repeats rows.
// ============================================
const mongoose = require('mongoose');
const User = require('../models/User');
const KoyambeduActivity = require('../models/KoyambeduActivity');
const KoyambeduOrder = require('../models/KoyambeduOrder');
const KoyambeduWallet = require('../models/KoyambeduWallet');
const KoyambeduCart = require('../models/KoyambeduCart');
const KoyambeduProduct = require('../models/KoyambeduProduct');
const KoyambeduSpecialRequest = require('../models/KoyambeduSpecialRequest');

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const esc = (s) => String(s).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isId = (v) => /^[a-f\d]{24}$/i.test(String(v || ''));
const oid = (v) => new mongoose.Types.ObjectId(String(v));
const startOf = (v) => new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00.000+05:30` : v);
const endOf = (v) => new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T23:59:59.999+05:30` : v);

// ── event catalogue ───────────────────────────────────────────────────────
const GROUPS = {
  browsing: ['page_view', 'product_view', 'search'],
  cart:     ['cart_set', 'cart_remove', 'cart_clear', 'in_cart'],
  checkout: ['checkout_view', 'payment_started'],
  orders:   ['order_placed', 'order_update'],
  wallet:   ['wallet_credit', 'wallet_debit'],
  requests: ['special_request'],
  account:  ['account_created', 'login'],
};
const TYPE_GROUP = Object.fromEntries(Object.entries(GROUPS).flatMap(([g, ts]) => ts.map((t) => [t, g])));
const LABELS = {
  page_view: 'Visited a page', product_view: 'Viewed a product', search: 'Searched',
  cart_set: 'Changed cart', cart_remove: 'Removed from cart', cart_clear: 'Cleared cart', in_cart: 'Item sitting in cart',
  checkout_view: 'Opened checkout', payment_started: 'Started payment (not completed)',
  order_placed: 'Placed an order', order_update: 'Order update',
  wallet_credit: 'Wallet credit', wallet_debit: 'Wallet debit',
  special_request: 'Special request', account_created: 'Signed up', login: 'Logged in',
};
const humanize = (s) => String(s || '').replace(/[_-]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
const pagePretty = (p) => {
  if (!p) return '';
  const map = { '/koyambedu': 'Home', '/koyambedu/shop': 'Shop', '/koyambedu/cart': 'Cart', '/koyambedu/checkout': 'Checkout', '/koyambedu/wallet': 'Wallet', '/koyambedu/choose': 'Choose delivery', '/koyambedu/location': 'Location' };
  return map[p] || p;
};

function groupsFromQuery(q) {
  const wanted = String(q.group || '').split(',').map((s) => s.trim()).filter((g) => GROUPS[g]);
  return wanted.length ? wanted : Object.keys(GROUPS);
}

/** Resolve the user / product restrictions the filters imply. null = no restriction. */
async function resolveScope(q) {
  let userIds = null;
  const intersect = (ids) => { userIds = userIds ? userIds.filter((u) => ids.some((i) => String(i) === String(u))) : ids; };

  if (q.userId) { if (!isId(q.userId)) return { empty: true }; intersect([oid(q.userId)]); }
  if (q.search && String(q.search).trim()) {
    const rx = new RegExp(esc(q.search), 'i');
    const users = await User.find({ $or: [{ name: rx }, { phone: rx }, { email: rx }] }).select('_id').limit(300).lean();
    intersect(users.map((u) => u._id));
  }
  if (q.location && String(q.location).trim()) {
    const rx = new RegExp(esc(q.location), 'i');
    const buyers = await KoyambeduOrder.distinct('buyer', {
      $or: [{ 'buyerLocation.areaName': rx }, { 'buyerLocation.city': rx }, { 'buyerLocation.pincode': rx }, { 'shippingAddress.city': rx }, { 'shippingAddress.pincode': rx }, { 'shippingAddress.addressLine1': rx }],
    });
    intersect(buyers);
  }
  let productIds = null;
  if (q.product && String(q.product).trim()) {
    const ps = await KoyambeduProduct.find({ name: new RegExp(esc(q.product), 'i') }).select('_id').limit(200).lean();
    productIds = ps.map((p) => p._id);
  }
  if ((userIds && !userIds.length) || (productIds && !productIds.length)) return { empty: true };
  return { userIds, productIds };
}

function range(q, before) {
  const r = {};
  if (q.from) { const d = startOf(q.from); if (!isNaN(d)) r.$gte = d; }
  if (q.to) { const d = endOf(q.to); if (!isNaN(d)) r.$lte = d; }
  if (before) { const d = new Date(before); if (!isNaN(d)) r.$lt = d; }
  return Object.keys(r).length ? r : null;
}
const inRange = (d, r) => {
  if (!r) return true; const t = new Date(d).getTime();
  return (!r.$gte || t >= r.$gte.getTime()) && (!r.$lte || t <= r.$lte.getTime()) && (!r.$lt || t < r.$lt.getTime());
};

// ── per-source fetchers (each returns normalised events, newest first) ──────
async function fetchLogged(scope, q, groups, before, L) {
  const types = groups.flatMap((g) => GROUPS[g]).filter((t) => KoyambeduActivity.TYPES.includes(t));
  if (!types.length) return [];
  const m = { type: { $in: types } };
  if (scope.userIds) m.user = { $in: scope.userIds };
  if (scope.productIds) m.product = { $in: scope.productIds };
  if (q.device) m.device = q.device;
  const r = range(q, before); if (r) m.createdAt = r;
  const rows = await KoyambeduActivity.find(m).populate('product', 'name unit').sort({ createdAt: -1 }).limit(L).lean();
  return rows.map((a) => ({
    id: `a-${a._id}`, at: a.createdAt, type: a.type, user: a.user,
    productId: a.product?._id || null, productName: a.product?.name || null, unit: a.product?.unit || null,
    quantity: a.quantity ?? null, query: a.query || null, page: a.page || null, device: a.device || null,
    detail: a.type === 'page_view' ? pagePretty(a.page) : a.type === 'search' ? `“${a.query}”` : a.type === 'cart_set' ? `${a.product?.name || 'Item'} → ${a.quantity}${a.product?.unit ? ' ' + a.product.unit : ''}` : a.type === 'cart_remove' ? (a.product?.name || 'Item') : a.type === 'product_view' ? (a.product?.name || 'Product') : '',
  }));
}

async function fetchOrders(scope, q, groups, before, L) {
  if (!groups.includes('orders') && !groups.includes('checkout')) return [];
  const m = {};
  if (scope.userIds) m.buyer = { $in: scope.userIds };
  if (scope.productIds) m['items.product'] = { $in: scope.productIds };
  if (q.orderStatus) m.orderStatus = q.orderStatus;
  if (q.orderId) m.orderId = new RegExp(esc(q.orderId), 'i');
  const r = range(q, before);
  if (r && r.$gte) m.updatedAt = { $gte: r.$gte };
  const orders = await KoyambeduOrder.find(m)
    .select('orderId buyer orderStatus paymentStatus pricing placedAt createdAt buyerLocation shippingAddress items.name items.orderedQty items.quantity timeline')
    .sort({ updatedAt: -1 }).limit(L * 3).lean();
  const out = [];
  for (const o of orders) {
    const area = o.buyerLocation?.areaName || o.shippingAddress?.city || null;
    const base = { user: o.buyer, orderId: o.orderId, amount: r2(o.pricing?.total), area, status: o.orderStatus };
    const names = (o.items || []).map((i) => i.name).filter(Boolean);
    const itemsText = names.slice(0, 3).join(', ') + (names.length > 3 ? ` +${names.length - 3} more` : '');
    const placedAt = o.placedAt || o.createdAt;
    if (o.orderStatus === 'payment_pending') {
      if (groups.includes('checkout')) out.push({ ...base, id: `op-${o._id}`, at: o.createdAt, type: 'payment_started', detail: `${o.orderId} · ₹${r2(o.pricing?.total)}${itemsText ? ' · ' + itemsText : ''}` });
    } else if (groups.includes('orders')) {
      out.push({ ...base, id: `ol-${o._id}`, at: placedAt, type: 'order_placed', detail: `${o.orderId} · ₹${r2(o.pricing?.total)}${itemsText ? ' · ' + itemsText : ''}` });
      for (const [i, t] of (o.timeline || []).entries()) {
        if (/^order_(placed|created)/.test(t.event || '')) continue;
        out.push({ ...base, id: `ot-${o._id}-${i}`, at: t.timestamp, type: 'order_update', event: t.event,
          detail: `${o.orderId} · ${t.description || humanize(t.event)}${t.actor?.role && t.actor.role !== 'customer' ? ` (by ${humanize(t.actor.role)})` : ''}` });
      }
    }
  }
  return out.filter((e) => inRange(e.at, r)).sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, L);
}

async function fetchWallet(scope, q, groups, before, L) {
  if (!groups.includes('wallet')) return [];
  const m = {}; if (scope.userIds) m.user = { $in: scope.userIds };
  const r = range(q, before);
  const tx = {}; if (r) tx['transactions.createdAt'] = r;
  if (scope.productIds) tx['transactions.productId'] = { $in: scope.productIds };
  const pipeline = [{ $match: { ...m, ...(r ? { 'transactions.createdAt': r } : {}) } }, { $unwind: '$transactions' }];
  if (Object.keys(tx).length) pipeline.push({ $match: tx });
  pipeline.push({ $sort: { 'transactions.createdAt': -1 } }, { $limit: L }, { $project: { user: 1, tx: '$transactions' } });
  const rows = await KoyambeduWallet.aggregate(pipeline);
  return rows.map((w) => ({
    id: `w-${w.tx._id || w.user}-${new Date(w.tx.createdAt).getTime()}`, at: w.tx.createdAt, user: w.user,
    type: w.tx.type === 'credit' ? 'wallet_credit' : 'wallet_debit', amount: r2(w.tx.amount), orderId: w.tx.orderId || null,
    productName: w.tx.productName || null,
    detail: `₹${r2(w.tx.amount)} · ${humanize(w.tx.category)}${w.tx.orderId ? ' · ' + w.tx.orderId : ''}${w.tx.reason ? ' · ' + w.tx.reason : ''} (balance ₹${r2(w.tx.balanceAfter)})`,
  }));
}

async function fetchCarts(scope, q, groups, before, L) {
  if (!groups.includes('cart')) return [];
  const m = { 'items.0': { $exists: true } };
  if (scope.userIds) m.user = { $in: scope.userIds };
  if (scope.productIds) m['items.product'] = { $in: scope.productIds };
  const r = range(q, before); if (r && r.$gte) m.updatedAt = { $gte: r.$gte };
  const carts = await KoyambeduCart.find(m).populate('items.product', 'name unit').sort({ updatedAt: -1 }).limit(L).lean();
  const out = [];
  for (const c of carts) {
    for (const [i, it] of (c.items || []).entries()) {
      if (!(it.quantity > 0) || !it.addedAt) continue;
      if (scope.productIds && !scope.productIds.some((p) => String(p) === String(it.product?._id))) continue;
      out.push({ id: `c-${c._id}-${i}`, at: it.addedAt, user: c.user, type: 'in_cart', productId: it.product?._id || null,
        productName: it.product?.name || it.name, quantity: it.quantity, amount: r2((it.unitPrice || 0) * (it.quantity || 0)),
        detail: `${it.product?.name || it.name}${it.gradeName ? ` (${it.gradeName})` : ''} × ${it.quantity}${it.product?.unit || it.unit || ''} · ₹${r2((it.unitPrice || 0) * (it.quantity || 0))}` });
    }
  }
  return out.filter((e) => inRange(e.at, r)).sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, L);
}

async function fetchRequests(scope, q, groups, before, L) {
  if (!groups.includes('requests') || scope.productIds) return [];
  const m = { user: { $ne: null } }; if (scope.userIds) m.user = { $in: scope.userIds };
  const r = range(q, before); if (r) m.createdAt = r;
  const rows = await KoyambeduSpecialRequest.find(m).select('user occasionType requestedItems status createdAt').sort({ createdAt: -1 }).limit(L).lean();
  return rows.map((s) => ({ id: `s-${s._id}`, at: s.createdAt, user: s.user, type: 'special_request',
    detail: `${humanize(s.occasionType)} · ${(s.requestedItems || []).length} item(s) · ${humanize(s.status)}` }));
}

async function fetchAccount(scope, q, groups, before, L) {
  if (!groups.includes('account') || scope.productIds) return [];
  const m = {}; if (scope.userIds) m._id = { $in: scope.userIds };
  const r = range(q, before);
  const out = [];
  const created = { ...m }; if (r) created.createdAt = r;
  const users = await User.find(created).select('_id createdAt').sort({ createdAt: -1 }).limit(L).lean();
  for (const u of users) out.push({ id: `u-${u._id}`, at: u.createdAt, user: u._id, type: 'account_created', detail: 'New account' });
  const logged = { ...m }; if (r) logged.lastLogin = r; else logged.lastLogin = { $ne: null };
  const lu = await User.find(logged).select('_id lastLogin').sort({ lastLogin: -1 }).limit(L).lean();
  for (const u of lu) out.push({ id: `l-${u._id}`, at: u.lastLogin, user: u._id, type: 'login', detail: 'Latest login' });
  return out;
}

async function attachUsers(events) {
  const ids = [...new Set(events.map((e) => String(e.user)).filter(Boolean))];
  const users = ids.length ? await User.find({ _id: { $in: ids } }).select('name phone email').lean() : [];
  const byId = Object.fromEntries(users.map((u) => [String(u._id), u]));
  return events.map((e) => {
    const u = byId[String(e.user)] || {};
    return { ...e, userId: e.user ? String(e.user) : null, userName: u.name || 'Unknown', phone: u.phone || '', email: u.email || '',
      group: TYPE_GROUP[e.type] || 'other', label: LABELS[e.type] || humanize(e.type), user: undefined };
  });
}

/** Unified timeline. Returns { events, hasMore, nextBefore }. */
async function feed(q = {}) {
  const limit = Math.min(200, Math.max(1, Number(q.limit) || 50));
  const groups = groupsFromQuery(q);
  const scope = await resolveScope(q);
  if (scope.empty) return { events: [], hasMore: false, nextBefore: null };
  const L = limit + 1;
  const parts = await Promise.all([
    fetchLogged(scope, q, groups, q.before, L), fetchOrders(scope, q, groups, q.before, L), fetchWallet(scope, q, groups, q.before, L),
    fetchCarts(scope, q, groups, q.before, L), fetchRequests(scope, q, groups, q.before, L), fetchAccount(scope, q, groups, q.before, L),
  ]);
  let all = parts.flat().filter((e) => e.at && !isNaN(new Date(e.at)));   // never let one bad record break the timeline
  if (q.device) all = all.filter((e) => e.device === q.device);   // device is only known for logged events
  all.sort((a, b) => new Date(b.at) - new Date(a.at));
  const hasMore = all.length > limit;
  const page = all.slice(0, limit);
  return { events: await attachUsers(page), hasMore, nextBefore: page.length ? new Date(page[page.length - 1].at).toISOString() : null };
}

// ── summary / insights ────────────────────────────────────────────────────
async function summary(q = {}) {
  const scope = await resolveScope(q);
  const r = range(q);
  const empty = { totals: {}, funnel: {}, topViewed: [], topCarted: [], topSearches: [], abandoned: { count: 0, value: 0 }, trend: [], activeUsers: 0 };
  if (scope.empty) return empty;

  const lm = {}; if (scope.userIds) lm.user = { $in: scope.userIds }; if (scope.productIds) lm.product = { $in: scope.productIds }; if (r) lm.createdAt = r;
  const om = { orderStatus: { $ne: 'payment_pending' } }; if (scope.userIds) om.buyer = { $in: scope.userIds }; if (r) om.createdAt = r;
  const dayExpr = { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'Asia/Kolkata' } };

  const [byType, viewers, carters, buyers, topViewed, topCarted, topSearches, trendA, trendO, carts] = await Promise.all([
    KoyambeduActivity.aggregate([{ $match: lm }, { $group: { _id: '$type', n: { $sum: 1 } } }]),
    KoyambeduActivity.distinct('user', { ...lm, type: 'product_view' }),
    KoyambeduActivity.distinct('user', { ...lm, type: 'cart_set' }),
    KoyambeduOrder.distinct('buyer', om),
    KoyambeduActivity.aggregate([{ $match: { ...lm, type: 'product_view', product: lm.product || { $ne: null } } }, { $group: { _id: '$product', views: { $sum: 1 }, users: { $addToSet: '$user' } } }, { $sort: { views: -1 } }, { $limit: 8 }]),
    KoyambeduActivity.aggregate([{ $match: { ...lm, type: 'cart_set', product: lm.product || { $ne: null } } }, { $group: { _id: '$product', adds: { $sum: 1 }, users: { $addToSet: '$user' } } }, { $sort: { adds: -1 } }, { $limit: 8 }]),
    KoyambeduActivity.aggregate([{ $match: { ...lm, type: 'search', query: { $nin: [null, ''] } } }, { $group: { _id: { $toLower: '$query' }, n: { $sum: 1 }, users: { $addToSet: '$user' } } }, { $sort: { n: -1 } }, { $limit: 8 }]),
    KoyambeduActivity.aggregate([{ $match: lm }, { $group: { _id: dayExpr, events: { $sum: 1 }, users: { $addToSet: '$user' } } }, { $sort: { _id: 1 } }]),
    KoyambeduOrder.aggregate([{ $match: om }, { $group: { _id: dayExpr, orders: { $sum: 1 }, value: { $sum: '$pricing.total' } } }, { $sort: { _id: 1 } }]),
    KoyambeduCart.find({ 'items.0': { $exists: true }, ...(scope.userIds ? { user: { $in: scope.userIds } } : {}), ...(r?.$gte ? { updatedAt: { $gte: r.$gte, ...(r.$lte ? { $lte: r.$lte } : {}) } } : {}) }).select('user items updatedAt').lean(),
  ]);

  const names = await KoyambeduProduct.find({ _id: { $in: [...topViewed, ...topCarted].map((x) => x._id) } }).select('name unit').lean();
  const pname = Object.fromEntries(names.map((p) => [String(p._id), p.name]));

  // Abandoned = has items in cart and has not ordered since the cart was last touched
  let abandoned = { count: 0, value: 0 };
  if (carts.length) {
    const lastOrder = await KoyambeduOrder.aggregate([{ $match: { buyer: { $in: carts.map((c) => c.user) }, orderStatus: { $ne: 'payment_pending' } } }, { $group: { _id: '$buyer', last: { $max: '$createdAt' } } }]);
    const lo = Object.fromEntries(lastOrder.map((x) => [String(x._id), new Date(x.last).getTime()]));
    for (const c of carts) {
      const live = (c.items || []).filter((i) => i.quantity > 0);
      if (!live.length) continue;
      if ((lo[String(c.user)] || 0) > new Date(c.updatedAt).getTime()) continue;
      abandoned.count += 1; abandoned.value += live.reduce((s, i) => s + (i.unitPrice || 0) * i.quantity, 0);
    }
    abandoned.value = r2(abandoned.value);
  }

  const activeSet = new Set([...trendA.flatMap((d) => d.users.map(String)), ...buyers.map(String)]);
  const totals = Object.fromEntries(byType.map((t) => [t._id, t.n]));
  const orderTrend = Object.fromEntries(trendO.map((d) => [d._id, d]));
  const days = new Set([...trendA.map((d) => d._id), ...trendO.map((d) => d._id)]);
  const trendMap = Object.fromEntries(trendA.map((d) => [d._id, d]));
  return {
    totals, activeUsers: activeSet.size,
    funnel: { viewers: viewers.length, carted: carters.length, ordered: buyers.length },
    topViewed: topViewed.map((x) => ({ productId: String(x._id), name: pname[String(x._id)] || 'Product', views: x.views, users: x.users.length })),
    topCarted: topCarted.map((x) => ({ productId: String(x._id), name: pname[String(x._id)] || 'Product', adds: x.adds, users: x.users.length })),
    topSearches: topSearches.map((x) => ({ query: x._id, searches: x.n, users: x.users.length })),
    abandoned,
    trend: [...days].sort().map((d) => ({ day: d, events: trendMap[d]?.events || 0, activeUsers: trendMap[d]?.users.length || 0, orders: orderTrend[d]?.orders || 0, orderValue: r2(orderTrend[d]?.value || 0) })),
  };
}

// ── users list + profile ──────────────────────────────────────────────────
async function users(q = {}) {
  const scope = await resolveScope(q);
  if (scope.empty) return { users: [] };
  const r = range(q);
  const lm = {}; if (scope.userIds) lm.user = { $in: scope.userIds }; if (r) lm.createdAt = r;
  const om = { orderStatus: { $ne: 'payment_pending' } }; if (scope.userIds) om.buyer = { $in: scope.userIds }; if (r) om.createdAt = r;
  const [act, ord] = await Promise.all([
    KoyambeduActivity.aggregate([{ $match: lm }, { $group: { _id: '$user', events: { $sum: 1 }, last: { $max: '$createdAt' }, views: { $sum: { $cond: [{ $eq: ['$type', 'product_view'] }, 1, 0] } }, cartAdds: { $sum: { $cond: [{ $eq: ['$type', 'cart_set'] }, 1, 0] } } } }]),
    KoyambeduOrder.aggregate([{ $match: om }, { $group: { _id: '$buyer', orders: { $sum: 1 }, spend: { $sum: '$pricing.total' }, last: { $max: '$createdAt' } } }]),
  ]);
  const map = {};
  for (const a of act) map[String(a._id)] = { userId: String(a._id), events: a.events, views: a.views, cartAdds: a.cartAdds, lastActive: a.last, orders: 0, spend: 0 };
  for (const o of ord) {
    const k = String(o._id); map[k] ||= { userId: k, events: 0, views: 0, cartAdds: 0, lastActive: o.last, orders: 0, spend: 0 };
    map[k].orders = o.orders; map[k].spend = r2(o.spend); if (!map[k].lastActive || new Date(o.last) > new Date(map[k].lastActive)) map[k].lastActive = o.last;
  }
  let rows = Object.values(map);
  const sort = q.sort === 'orders' ? 'orders' : q.sort === 'spend' ? 'spend' : q.sort === 'events' ? 'events' : 'lastActive';
  rows.sort((a, b) => sort === 'lastActive' ? new Date(b.lastActive || 0) - new Date(a.lastActive || 0) : b[sort] - a[sort]);
  rows = rows.slice(0, Math.min(200, Number(q.limit) || 50));
  const us = await User.find({ _id: { $in: rows.map((x) => x.userId) } }).select('name phone email createdAt').lean();
  const ub = Object.fromEntries(us.map((u) => [String(u._id), u]));
  return { users: rows.map((x) => ({ ...x, spend: r2(x.spend), name: ub[x.userId]?.name || 'Unknown', phone: ub[x.userId]?.phone || '', email: ub[x.userId]?.email || '', joined: ub[x.userId]?.createdAt || null })) };
}

async function profile(userId) {
  if (!isId(userId)) return null;
  const u = await User.findById(userId).select('name phone email createdAt lastLogin').lean();
  if (!u) return null;
  const [orders, wallet, cart, firstSeen, lastSeen, loc, topViewed] = await Promise.all([
    KoyambeduOrder.aggregate([{ $match: { buyer: oid(userId), orderStatus: { $ne: 'payment_pending' } } }, { $group: { _id: null, orders: { $sum: 1 }, spend: { $sum: '$pricing.total' }, last: { $max: '$createdAt' }, cancelled: { $sum: { $cond: [{ $eq: ['$orderStatus', 'cancelled'] }, 1, 0] } } } }]),
    KoyambeduWallet.findOne({ user: userId }).select('balance reservedBalance').lean(),
    KoyambeduCart.findOne({ user: userId }).populate('items.product', 'name unit').lean(),
    KoyambeduActivity.findOne({ user: userId }).sort({ createdAt: 1 }).select('createdAt').lean(),
    KoyambeduActivity.findOne({ user: userId }).sort({ createdAt: -1 }).select('createdAt device').lean(),
    KoyambeduOrder.findOne({ buyer: userId }).sort({ createdAt: -1 }).select('buyerLocation shippingAddress').lean(),
    KoyambeduActivity.aggregate([{ $match: { user: oid(userId), type: 'product_view', product: { $ne: null } } }, { $group: { _id: '$product', n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 5 }]),
  ]);
  const names = await KoyambeduProduct.find({ _id: { $in: topViewed.map((x) => x._id) } }).select('name').lean();
  const nm = Object.fromEntries(names.map((p) => [String(p._id), p.name]));
  const items = (cart?.items || []).filter((i) => i.quantity > 0);
  const o = orders[0] || {};
  return {
    userId: String(u._id), name: u.name, phone: u.phone, email: u.email, joined: u.createdAt, lastLogin: u.lastLogin || null,
    firstSeen: firstSeen?.createdAt || null, lastActive: lastSeen?.createdAt || null, device: lastSeen?.device || null,
    area: loc?.buyerLocation?.areaName || loc?.shippingAddress?.city || null, pincode: loc?.buyerLocation?.pincode || loc?.shippingAddress?.pincode || null,
    orders: o.orders || 0, cancelledOrders: o.cancelled || 0, spend: r2(o.spend), lastOrderAt: o.last || null,
    walletBalance: r2(wallet?.balance), walletReserved: r2(wallet?.reservedBalance),
    cart: { itemCount: items.length, value: r2(items.reduce((s, i) => s + (i.unitPrice || 0) * i.quantity, 0)), updatedAt: cart?.updatedAt || null,
      items: items.map((i) => ({ name: i.product?.name || i.name, quantity: i.quantity, unit: i.product?.unit || i.unit, gradeName: i.gradeName || null, unitPrice: i.unitPrice })) },
    topViewed: topViewed.map((x) => ({ name: nm[String(x._id)] || 'Product', views: x.n })),
  };
}

// ── CSV ───────────────────────────────────────────────────────────────────
const cell = (v) => { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
async function csv(q = {}) {
  const events = []; let before = null;
  for (let i = 0; i < 25 && events.length < 5000; i++) {
    const f = await feed({ ...q, limit: 200, before });
    events.push(...f.events); if (!f.hasMore) break; before = f.nextBefore;
  }
  const head = ['Time (IST)', 'Customer', 'Phone', 'Email', 'Group', 'Activity', 'Details', 'Product', 'Qty', 'Amount', 'Order', 'Device'];
  const rows = events.map((e) => [new Date(e.at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }), e.userName, e.phone, e.email, e.group, e.label, e.detail || '', e.productName || '', e.quantity ?? '', e.amount ?? '', e.orderId || '', e.device || ''].map(cell).join(','));
  return [head.join(','), ...rows].join('\n');
}

// ── logging (never throws, never blocks) ──────────────────────────────────
const recent = new Map();   // de-dupe identical beacons within a few seconds
const deviceOf = (ua = '') => (/ipad|tablet/i.test(ua) ? 'tablet' : /mobi|android|iphone/i.test(ua) ? 'mobile' : ua ? 'desktop' : null);

function logActivity(req, type, data = {}) {
  try {
    if (!req?.user?._id || !KoyambeduActivity.TYPES.includes(type)) return;
    const key = `${req.user._id}|${type}|${data.product || ''}|${data.page || ''}|${data.query || ''}|${data.quantity ?? ''}`;
    const now = Date.now();
    if (recent.has(key) && now - recent.get(key) < 4000) return;
    recent.set(key, now);
    if (recent.size > 5000) for (const k of [...recent.keys()].slice(0, 2500)) recent.delete(k);
    KoyambeduActivity.create({
      user: req.user._id, type, ...data,
      page: data.page ? String(data.page).slice(0, 200) : undefined,
      query: data.query ? String(data.query).trim().slice(0, 120) : undefined,
      device: deviceOf(req.headers?.['user-agent']), sessionId: req.headers?.['x-session-id'] || undefined,
    }).catch(() => {});
  } catch (_) { /* logging must never break a request */ }
}

/** Express middleware: log cart changes AFTER the existing cart route has answered OK. */
const cartTracker = (kind) => (req, res, next) => {
  res.on('finish', () => {
    if (res.statusCode >= 300 || !req.user) return;
    if (kind === 'clear') return logActivity(req, 'cart_clear');
    const { productId, quantity, gradeKey, deliveryType } = req.body || {};
    if (!isId(productId)) return;
    if (Number(quantity) <= 0) return logActivity(req, 'cart_remove', { product: productId, gradeKey: gradeKey || undefined });
    logActivity(req, 'cart_set', { product: productId, quantity: Number(quantity), gradeKey: gradeKey || undefined, deliveryType });
  });
  next();
};

module.exports = { cartTracker, feed, summary, users, profile, csv, logActivity, GROUPS, TYPE_GROUP, LABELS, resolveScope };
