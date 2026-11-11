// Koyambedu Daily — super-admin customer activity (feed, filters, summary, users, profile, logging).
const test = require('node:test');
const assert = require('node:assert/strict');
const { chain } = require('../express/helpers');

const User = require('../../src/models/User');
const Activity = require('../../src/models/KoyambeduActivity');
const Order = require('../../src/models/KoyambeduOrder');
const Wallet = require('../../src/models/KoyambeduWallet');
const Cart = require('../../src/models/KoyambeduCart');
const Product = require('../../src/models/KoyambeduProduct');
const Special = require('../../src/models/KoyambeduSpecialRequest');
const svc = require('../../src/services/koyambeduActivityService');
const ctrl = require('../../src/controllers/koyambeduActivityController');

const U1 = 'aaaaaaaaaaaaaaaaaaaaaaaa', U2 = 'bbbbbbbbbbbbbbbbbbbbbbbb', P1 = 'cccccccccccccccccccccccc';
const t = (iso) => new Date(iso);

// every source empty unless a test fills it; records the filters it was called with
function stub(o = {}) {
  const seen = {};
  const rec = (k, rows) => (f) => { seen[k] = f; const c = chain(typeof rows === 'function' ? rows(f) : rows); return c; };
  Activity.find = rec('activity', o.activity || []);
  Order.find = rec('order', o.orders || []);
  Cart.find = rec('cart', o.carts || []);
  Special.find = rec('special', o.special || []);
  User.find = (f) => { seen.user = f; return chain(o.users || [{ _id: U1, name: 'Priya', phone: '9876543210', email: 'p@x.com' }, { _id: U2, name: 'Ravi', phone: '9000000000', email: 'r@x.com' }]); };
  Wallet.aggregate = async (p) => { seen.walletPipe = p; return o.wallet || []; };
  Order.distinct = async (f, q) => { seen.distinct = q; return o.buyersAtLocation || []; };
  Product.find = (f) => { seen.product = f; return chain(o.products || []); };
  Activity.distinct = async () => o.distinctUsers || [];
  Activity.aggregate = async () => o.actAgg || [];
  Order.aggregate = async () => o.ordAgg || [];
  Wallet.findOne = () => chain(o.walletDoc || null);
  Activity.findOne = () => chain(o.actOne || null);
  Order.findOne = () => chain(o.ordOne || null);
  Cart.findOne = () => chain(o.cartOne || null);
  User.findById = () => chain(o.userDoc === undefined ? { _id: U1, name: 'Priya', phone: '9876543210', email: 'p@x.com', createdAt: t('2026-10-01T00:00:00Z') } : o.userDoc);
  return seen;
}

const placedOrder = { _id: 'o1', orderId: 'KBD1', buyer: U1, orderStatus: 'delivered', pricing: { total: 1560 }, placedAt: t('2026-11-09T05:00:00Z'), items: [{ name: 'Tomato', quantity: 30 }, { name: 'Onion', quantity: 5 }],
  buyerLocation: { areaName: 'Valasaravakkam' }, timeline: [{ event: 'order_placed', timestamp: t('2026-11-09T05:00:00Z') }, { event: 'confirmed', description: 'Order confirmed', actor: { role: 'super_admin' }, timestamp: t('2026-11-09T08:00:00Z') }, { event: 'delivered', description: 'Delivered', actor: { role: 'seller_admin' }, timestamp: t('2026-11-10T04:00:00Z') }] };

// ── feed ────────────────────────────────────────────────────────────────
test('KA-01 feed merges every source newest-first with customer names, labels and groups', async () => {
  stub({
    activity: [{ _id: 'a1', user: U1, type: 'product_view', product: { _id: P1, name: 'Tomato', unit: 'kg' }, createdAt: t('2026-11-10T06:00:00Z'), device: 'mobile' }],
    orders: [placedOrder],
    wallet: [{ user: U1, tx: { _id: 'w1', type: 'credit', category: 'item_declined', amount: 40, orderId: 'KBD1', balanceAfter: 40, createdAt: t('2026-11-10T05:00:00Z') } }],
    carts: [{ _id: 'c1', user: U2, items: [{ product: { _id: P1, name: 'Tomato', unit: 'kg' }, quantity: 2, unitPrice: 50, addedAt: t('2026-11-10T07:00:00Z') }] }],
    special: [{ _id: 's1', user: U2, occasionType: 'wedding', requestedItems: [{}], status: 'new', createdAt: t('2026-11-08T00:00:00Z') }],
  });
  const f = await svc.feed({});
  const types = f.events.map(e => e.type);
  assert.deepEqual(types.slice(0, 4), ['in_cart', 'product_view', 'wallet_credit', 'order_update']);
  assert.ok(types.includes('order_placed') && types.includes('special_request'));
  const times = f.events.map(e => new Date(e.at).getTime()); assert.deepEqual([...times].sort((a, b) => b - a), times);
  const pv = f.events.find(e => e.type === 'product_view');
  assert.equal(pv.userName, 'Priya'); assert.equal(pv.phone, '9876543210'); assert.equal(pv.group, 'browsing'); assert.equal(pv.label, 'Viewed a product'); assert.equal(pv.detail, 'Tomato');
  assert.equal(f.events.find(e => e.type === 'in_cart').detail.startsWith('Tomato × 2kg'), true);
});
test('KA-02 order events: placed + each timeline step (no duplicate "placed"), with amount, items, area', async () => {
  stub({ orders: [placedOrder] });
  const f = await svc.feed({ group: 'orders' });
  assert.deepEqual(f.events.map(e => e.type).sort(), ['order_placed', 'order_update', 'order_update']);
  const p = f.events.find(e => e.type === 'order_placed'); assert.equal(p.amount, 1560); assert.match(p.detail, /KBD1 · ₹1560 · Tomato, Onion/); assert.equal(p.area, 'Valasaravakkam');
  assert.ok(f.events.some(e => /Order confirmed \(by Super admin\)/.test(e.detail)));
});
test('KA-03 payment not completed → "Started payment" (checkout), never "placed an order"', async () => {
  stub({ orders: [{ ...placedOrder, _id: 'o2', orderId: 'KBD2', orderStatus: 'payment_pending', createdAt: t('2026-11-10T09:00:00Z'), placedAt: undefined, timeline: [] }] });
  const f = await svc.feed({});
  assert.equal(f.events.length, 1); assert.equal(f.events[0].type, 'payment_started'); assert.equal(f.events[0].group, 'checkout');
});
test('KA-04 group filter only queries the sources that can answer it', async () => {
  let touched = [];
  const seen = stub({}); const orig = { a: Activity.find, o: Order.find, c: Cart.find, s: Special.find, w: Wallet.aggregate };
  Activity.find = (...a) => { touched.push('activity'); return orig.a(...a); }; Order.find = (...a) => { touched.push('order'); return orig.o(...a); };
  Cart.find = (...a) => { touched.push('cart'); return orig.c(...a); }; Special.find = (...a) => { touched.push('special'); return orig.s(...a); };
  Wallet.aggregate = async (p) => { touched.push('wallet'); return orig.w(p); };
  await svc.feed({ group: 'cart' });
  assert.deepEqual(touched.sort(), ['activity', 'cart']);   // cart_set/remove (logged) + items in cart
  touched = []; await svc.feed({ group: 'wallet' }); assert.deepEqual(touched, ['wallet']);
  touched = []; await svc.feed({ group: 'nonsense' }); assert.ok(touched.includes('order') && touched.includes('wallet'));   // unknown → all groups
  assert.ok(seen);
});
test('KA-05 customer search resolves name / phone / email to users and limits every source to them', async () => {
  const seen = stub({ users: [{ _id: U1, name: 'Priya' }] });
  await svc.feed({ search: '98765' });
  assert.ok(seen.activity.user.$in.some(i => String(i) === U1)); assert.ok(seen.order.buyer.$in.some(i => String(i) === U1));
  assert.deepEqual(seen.walletPipe[0].$match.user.$in.map(String), [U1]);
});
test('KA-06 nobody matches the search → empty result and no source is queried', async () => {
  let queried = false; const seen = stub({ users: [] }); Activity.find = () => { queried = true; return chain([]); };
  const f = await svc.feed({ search: 'zzz' }); assert.deepEqual(f.events, []); assert.equal(f.hasMore, false); assert.equal(queried, false); assert.ok(seen);
  assert.deepEqual((await svc.feed({ userId: 'not-an-id' })).events, []);
});
test('KA-07 date range is IST calendar days; "before" cursor is exclusive', async () => {
  const seen = stub();
  await svc.feed({ from: '2026-11-01', to: '2026-11-10', before: '2026-11-05T00:00:00.000Z' });
  const r = seen.activity.createdAt;
  assert.equal(r.$gte.toISOString(), '2026-10-31T18:30:00.000Z'); assert.equal(r.$lte.toISOString(), '2026-11-10T18:29:59.999Z'); assert.equal(r.$lt.toISOString(), '2026-11-05T00:00:00.000Z');
});
test('KA-08 product filter finds product ids by name and applies them to logged events and orders', async () => {
  const seen = stub({ products: [{ _id: P1 }] });
  await svc.feed({ product: 'tomato' });
  assert.ok(seen.product.name.test('Tomato')); assert.equal(String(seen.activity.product.$in[0]), P1); assert.equal(String(seen.order['items.product'].$in[0]), P1);
  stub({ products: [] }); assert.deepEqual((await svc.feed({ product: 'nothing' })).events, []);
});
test('KA-09 location filter → customers who ordered to that area / city / pincode', async () => {
  const seen = stub({ buyersAtLocation: [U2] });
  await svc.feed({ location: 'Valasaravakkam' });
  assert.equal(seen.distinct.$or.length, 6); assert.deepEqual(seen.activity.user.$in.map(String), [U2]);
  stub({ buyersAtLocation: [] }); assert.deepEqual((await svc.feed({ location: 'Mars' })).events, []);
});
test('KA-10 device filter keeps only events whose device is known to match', async () => {
  stub({ activity: [{ _id: 'a1', user: U1, type: 'page_view', page: '/koyambedu/shop', device: 'mobile', createdAt: t('2026-11-10T06:00:00Z') }], orders: [placedOrder] });
  const f = await svc.feed({ device: 'mobile' }); assert.deepEqual(f.events.map(e => e.type), ['page_view']);
});
test('KA-11 cursor paging: hasMore + nextBefore', async () => {
  const rows = Array.from({ length: 5 }, (_, i) => ({ _id: `a${i}`, user: U1, type: 'page_view', page: '/koyambedu', createdAt: t(`2026-11-10T0${9 - i}:00:00Z`) }));
  stub({ activity: rows });
  const f = await svc.feed({ limit: '3' });
  assert.equal(f.events.length, 3); assert.equal(f.hasMore, true); assert.equal(f.nextBefore, '2026-11-10T07:00:00.000Z');
  assert.equal((await svc.feed({ limit: '50' })).hasMore, false);
});
test('KA-12 regex characters in search boxes are escaped', async () => {
  const seen = stub(); await svc.feed({ search: '(.*)+', group: 'browsing' });
  assert.ok(seen.user.$or[0].name instanceof RegExp); assert.ok(!seen.user.$or[0].name.test('Priya'));
});
test('KA-13 page paths get friendly names', async () => {
  stub({ activity: [{ _id: 'a1', user: U1, type: 'page_view', page: '/koyambedu/cart', createdAt: t('2026-11-10T06:00:00Z') }, { _id: 'a2', user: U1, type: 'search', query: 'lemon', createdAt: t('2026-11-10T05:00:00Z') }] });
  const f = await svc.feed({ group: 'browsing' }); assert.equal(f.events[0].detail, 'Cart'); assert.equal(f.events[1].detail, '“lemon”');
});

// ── summary / users / profile / csv ─────────────────────────────────────
test('KA-20 summary: funnel, top lists with names, searches, trend, abandoned carts', async () => {
  const day = '2026-11-10';
  Activity.aggregate = async (p) => {
    const g = p.find(s => s.$group)?.$group || {};
    if (g._id === '$type') return [{ _id: 'product_view', n: 10 }, { _id: 'cart_set', n: 4 }];
    if (g._id === '$product' && g.views) return [{ _id: P1, views: 7, users: [U1, U2] }];
    if (g._id === '$product' && g.adds) return [{ _id: P1, adds: 3, users: [U1] }];
    if (g._id?.$toLower) return [{ _id: 'lemon grass', n: 5, users: [U1, U2] }];
    return [{ _id: day, events: 14, users: [U1, U2] }];
  };
  Activity.distinct = async (f, q) => (q?.type === 'product_view' || f === 'user' ? [U1, U2] : [U1]);
  Activity.distinct = async (field, q) => (q.type === 'product_view' ? [U1, U2] : [U1]);
  Order.distinct = async () => [U1];
  Order.aggregate = async (p) => (p.find(s => s.$group)?.$group.last ? [{ _id: U2, last: t('2026-11-01T00:00:00Z') }] : [{ _id: day, orders: 2, value: 3000 }]);
  Product.find = () => chain([{ _id: P1, name: 'Tomato' }]);
  User.find = () => chain([]);
  Cart.find = () => chain([
    { user: U2, updatedAt: t('2026-11-09T00:00:00Z'), items: [{ quantity: 2, unitPrice: 100 }] },           // touched after last order → abandoned
    { user: U1, updatedAt: t('2026-11-01T00:00:00Z'), items: [{ quantity: 1, unitPrice: 50 }] },            // ordered since → not abandoned
  ]);
  Order.aggregate = async (p) => { const g = p.find(s => s.$group)?.$group || {}; return g.last ? [{ _id: U1, last: t('2026-11-05T00:00:00Z') }] : [{ _id: day, orders: 2, value: 3000 }]; };
  const s = await svc.summary({ from: '2026-11-01', to: '2026-11-10' });
  assert.deepEqual(s.funnel, { viewers: 2, carted: 1, ordered: 1 });
  assert.equal(s.totals.product_view, 10); assert.equal(s.topViewed[0].name, 'Tomato'); assert.equal(s.topViewed[0].views, 7); assert.equal(s.topCarted[0].adds, 3);
  assert.deepEqual(s.topSearches[0], { query: 'lemon grass', searches: 5, users: 2 });
  assert.deepEqual(s.abandoned, { count: 1, value: 200 });
  assert.deepEqual(s.trend[0], { day, events: 14, activeUsers: 2, orders: 2, orderValue: 3000 }); assert.equal(s.activeUsers, 2);
});
test('KA-21 users list merges browsing + orders and sorts by last active / spend / orders', async () => {
  Activity.aggregate = async () => [{ _id: U1, events: 12, views: 8, cartAdds: 3, last: t('2026-11-10T06:00:00Z') }];
  Order.aggregate = async () => [{ _id: U1, orders: 2, spend: 3100, last: t('2026-11-09T00:00:00Z') }, { _id: U2, orders: 5, spend: 9000, last: t('2026-11-10T09:00:00Z') }];
  User.find = () => chain([{ _id: U1, name: 'Priya', phone: '98', email: '' }, { _id: U2, name: 'Ravi', phone: '90', email: '' }]);
  let r = await svc.users({}); assert.deepEqual(r.users.map(u => u.name), ['Ravi', 'Priya']);                    // lastActive desc
  assert.equal(r.users[1].events, 12); assert.equal(r.users[1].orders, 2);
  r = await svc.users({ sort: 'spend' }); assert.equal(r.users[0].name, 'Ravi'); assert.equal(r.users[0].spend, 9000);
  r = await svc.users({ sort: 'events' }); assert.equal(r.users[0].name, 'Priya');
});
test('KA-22 customer profile: orders, spend, wallet, current cart, last device/area', async () => {
  stub({
    walletDoc: { balance: 120, reservedBalance: 20 },
    cartOne: { updatedAt: t('2026-11-10T00:00:00Z'), items: [{ product: { name: 'Tomato', unit: 'kg' }, quantity: 3, unitPrice: 50 }, { product: { name: 'Gone' }, quantity: 0, unitPrice: 9 }] },
    actOne: { createdAt: t('2026-11-10T06:00:00Z'), device: 'mobile' }, ordOne: { buyerLocation: { areaName: 'Valasaravakkam', pincode: '600087' } },
  });
  Order.aggregate = async () => [{ _id: null, orders: 4, spend: 6200.5, last: t('2026-11-09T00:00:00Z'), cancelled: 1 }];
  Activity.aggregate = async () => [{ _id: P1, n: 6 }]; Product.find = () => chain([{ _id: P1, name: 'Tomato' }]);
  const p = await svc.profile(U1);
  assert.equal(p.name, 'Priya'); assert.equal(p.orders, 4); assert.equal(p.cancelledOrders, 1); assert.equal(p.spend, 6200.5); assert.equal(p.walletBalance, 120);
  assert.deepEqual([p.cart.itemCount, p.cart.value], [1, 150]); assert.equal(p.area, 'Valasaravakkam'); assert.equal(p.device, 'mobile'); assert.deepEqual(p.topViewed, [{ name: 'Tomato', views: 6 }]);
  assert.equal(await svc.profile('bad'), null);
  stub({ userDoc: null }); assert.equal(await svc.profile(U1), null);
});
test('KA-23 CSV export: header, quoting, one row per event', async () => {
  stub({ activity: [{ _id: 'a1', user: U1, type: 'search', query: 'lemon, "fresh"', createdAt: t('2026-11-10T06:00:00Z'), device: 'mobile' }] });
  const out = await svc.csv({ group: 'browsing' }); const lines = out.split('\n');
  assert.match(lines[0], /^Time \(IST\),Customer,Phone,Email,Group,Activity,Details/); assert.equal(lines.length, 2);
  assert.match(lines[1], /Priya,9876543210,p@x\.com,browsing,Searched,"“lemon, ""fresh""”"/);
});

// ── logging ─────────────────────────────────────────────────────────────
function capture() { const rows = []; Activity.create = async (d) => { rows.push(d); return d; }; return rows; }
const req = (extra = {}) => ({ user: { _id: U1 }, headers: { 'user-agent': 'Mozilla/5.0 (iPhone) Mobile', 'x-session-id': 's1' }, ...extra });
test('KA-30 logActivity: stores type, device and session; ignores unknown types and anonymous users; never throws', () => {
  const rows = capture();
  svc.logActivity(req(), 'page_view', { page: '/koyambedu/shop?x=1' }); svc.logActivity(req(), 'hack', {}); svc.logActivity({ headers: {} }, 'page_view', { page: '/a' });
  svc.logActivity(null, 'page_view'); Activity.create = () => { throw new Error('db down'); }; assert.doesNotThrow(() => svc.logActivity(req(), 'search', { query: 'zz' }));
  assert.equal(rows.length, 1); assert.equal(rows[0].device, 'mobile'); assert.equal(rows[0].sessionId, 's1'); assert.equal(rows[0].type, 'page_view');
});
test('KA-31 logActivity: identical beacons within a few seconds are stored once (no flooding)', () => {
  const rows = capture(); const r = req({ user: { _id: 'dddddddddddddddddddddddd' } });
  svc.logActivity(r, 'product_view', { product: P1 }); svc.logActivity(r, 'product_view', { product: P1 }); svc.logActivity(r, 'product_view', { product: 'eeeeeeeeeeeeeeeeeeeeeeee' });
  assert.equal(rows.length, 2);
});
function res() { const r = { code: null, ended: false, status(c) { r.code = c; return r; }, end() { r.ended = true; return r; }, json(b) { r.body = b; return r; } }; return r; }
test('KA-32 customer beacon: only browsing events accepted, path must be Koyambedu, always 204', () => {
  const rows = capture(); const r1 = res(), r2 = res(), r3 = res(), r4 = res(), r5 = res(); const u = { user: { _id: 'f'.repeat(24) }, headers: {} };
  ctrl.track({ ...u, body: { type: 'page_view', page: '/koyambedu/cart' } }, r1);
  ctrl.track({ ...u, body: { type: 'cart_set', productId: P1, quantity: 99 } }, r2);                 // cart events can't be forged from the browser
  ctrl.track({ ...u, body: { type: 'search', query: 'a' } }, r3);                                     // too short
  ctrl.track({ ...u, body: { type: 'product_view', productId: 'bad' } }, r4);
  ctrl.track({ ...u, body: { type: 'page_view', page: '/admin/secret' } }, r5);                      // not a Koyambedu page → stored without page
  assert.deepEqual([r1.code, r2.code, r3.code, r4.code, r5.code], [204, 204, 204, 204, 204]);
  assert.deepEqual(rows.map(x => [x.type, x.page]), [['page_view', '/koyambedu/cart'], ['page_view', undefined]]);
});
test('KA-33 cart tracker: logs add/change, remove and clear AFTER a successful response only', () => {
  const rows = capture(); const mk = (body, code = 200, user = { _id: 'a1'.repeat(12) }) => { let fin; const rs = { statusCode: code, on: (e, f) => { fin = f; } }; const rq = { user, body, headers: {} }; let nexted = false; return { run: (kind) => { svc.cartTracker(kind)(rq, rs, () => { nexted = true; }); fin(); return nexted; } }; };
  assert.equal(mk({ productId: P1, quantity: 2, gradeKey: 'premium' }).run('set'), true);
  mk({ productId: P1, quantity: 0 }).run('set');
  mk({}, 200, { _id: 'a2'.repeat(12) }).run('clear');
  mk({ productId: P1, quantity: 5 }, 400, { _id: 'a3'.repeat(12) }).run('set');                      // failed request → nothing logged
  mk({ productId: 'bad', quantity: 5 }, 200, { _id: 'a4'.repeat(12) }).run('set');                   // invalid id → nothing logged
  assert.deepEqual(rows.map(x => x.type), ['cart_set', 'cart_remove', 'cart_clear']);
  assert.equal(rows[0].quantity, 2); assert.equal(rows[0].gradeKey, 'premium');
});
test('KA-34 every admin activity endpoint is behind the SUPER ADMIN guard; the beacon needs a login', () => {
  const router = require('../../src/routes/koyambedu'); const { superAdminOnly } = require('../../src/middleware/adminAuth'); const { protect } = require('../../src/middleware/auth');
  const find = (m, p) => router.stack.find(l => l.route && l.route.path === p && l.route.methods[m]).route.stack.map(s => s.handle);
  for (const p of ['/admin/activity', '/admin/activity/summary', '/admin/activity/users', '/admin/activity/export', '/admin/activity/user/:userId']) assert.ok(find('get', p).includes(superAdminOnly), p);
  assert.ok(find('post', '/activity').includes(protect));
});
test('KA-35 retention: log expires after 180 days; only known event types', () => {
  const idx = Activity.schema.indexes().find(([k, o]) => o && o.expireAfterSeconds);
  assert.equal(idx[1].expireAfterSeconds, 180 * 24 * 3600); assert.ok(Activity.TYPES.includes('cart_set') && !Activity.TYPES.includes('order_placed'));
});
