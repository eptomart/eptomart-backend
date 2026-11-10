// Express orders: store-level scoping + super-admin cross-store filters.
const test = require('node:test');
const assert = require('node:assert/strict');
const { fakeRes, chain } = require('./helpers');

const ExpressOrder = require('../../src/models/ExpressOrder');
const q = require('../../src/utils/expressOrderQuery');
const mgr = require('../../src/controllers/expressManagerController');
const adm = require('../../src/controllers/expressAdminController');

const S1 = 'aaaaaaaaaaaaaaaaaaaaaaaa', S2 = 'bbbbbbbbbbbbbbbbbbbbbbbb';

// ── filter builder ──────────────────────────────────────────────────────
test('OQ-01 store view forces the store; a storeId from the client is ignored', () => {
  const f = q.buildOrderFilter({ storeId: S2 }, { store: S1 });
  assert.equal(String(f.store), S1);
});
test('OQ-02 admin view: optional store filter; none → all stores; garbage ignored', () => {
  assert.equal(String(q.buildOrderFilter({ storeId: S2 }).store), S2);
  assert.equal(q.buildOrderFilter({}).store, undefined);
  assert.equal(q.buildOrderFilter({ storeId: 'x; drop' }).store, undefined);
});
test('OQ-03 store view defaults to PAID; admin default shows all; explicit payment honoured', () => {
  assert.equal(q.buildOrderFilter({}, { store: S1, defaultPayment: 'paid' }).paymentStatus, 'paid');
  assert.equal(q.buildOrderFilter({}, { defaultPayment: 'all' }).paymentStatus, undefined);
  assert.equal(q.buildOrderFilter({ payment: 'pending' }, { defaultPayment: 'all' }).paymentStatus, 'pending');
  assert.equal(q.buildOrderFilter({ payment: 'all' }, { store: S1, defaultPayment: 'paid' }).paymentStatus, undefined);
});
test('OQ-04 date range is inclusive of the whole "to" day in IST', () => {
  const f = q.buildOrderFilter({ from: '2026-11-01', to: '2026-11-10' });
  assert.equal(f.createdAt.$gte.toISOString(), '2026-10-31T18:30:00.000Z');
  assert.equal(f.createdAt.$lte.toISOString(), '2026-11-10T18:29:59.999Z');
});
test('OQ-05 invalid status / dates are ignored, valid status applied', () => {
  assert.equal(q.buildOrderFilter({ status: 'hacked' }).orderStatus, undefined);
  assert.equal(q.buildOrderFilter({ status: 'delivered' }).orderStatus, 'delivered');
  assert.equal(q.buildOrderFilter({ from: 'garbage' }).createdAt, undefined);
});
test('OQ-06 item filter matches product names case-insensitively', () => {
  const f = q.buildOrderFilter({ item: 'lemon grass' });
  const rx = f.$and[0]['items.name']; assert.ok(rx.test('Lemon Grass')); assert.ok(!rx.test('Tomato'));
});
test('OQ-07 location filter searches address, city and pincode', () => {
  const f = q.buildOrderFilter({ location: 'Valasaravakkam' });
  const ors = f.$and[0].$or.map(o => Object.keys(o)[0]);
  assert.deepEqual(ors, ['deliveryAddress.addressLine', 'deliveryAddress.city', 'deliveryAddress.pincode']);
  assert.equal(q.buildOrderFilter({ pincode: '600087' })['deliveryAddress.pincode'], '600087');
  assert.equal(q.buildOrderFilter({ pincode: '60' })['deliveryAddress.pincode'], undefined);
});
test('OQ-08 search covers order id, customer name and phone', () => {
  const f = q.buildOrderFilter({ search: '98765' });
  assert.deepEqual(f.$and[0].$or.map(o => Object.keys(o)[0]), ['orderId', 'deliveryAddress.name', 'deliveryAddress.phone']);
});
test('OQ-09 regex characters in user input are escaped (no injection / crash)', () => {
  const f = q.buildOrderFilter({ item: '(.*)+' });
  assert.doesNotThrow(() => f.$and[0]['items.name'].test('Tomato')); assert.ok(!f.$and[0]['items.name'].test('Tomato'));
});

// ── controllers ─────────────────────────────────────────────────────────
function stubOrders({ rows = [], total = rows.length, agg = [] } = {}) {
  const seen = {};
  ExpressOrder.find = (f) => { seen.filter = f; const c = chain(rows); c.skip = (n) => { seen.skip = n; return c; }; c.limit = (n) => { seen.limit = n; return c; }; c.populate = () => c; c.sort = () => c; return c; };
  ExpressOrder.countDocuments = async () => total;
  ExpressOrder.aggregate = async () => agg;
  return seen;
}
test('OQ-20 store orders: scoped to the session store, paid by default, paginated with a summary', async () => {
  const seen = stubOrders({ rows: [{ orderId: 'EX1' }], total: 120, agg: [{ _id: 'delivered', n: 3, gross: 900, refunded: 100 }, { _id: 'preparing', n: 1, gross: 300, refunded: 0 }] });
  const res = fakeRes();
  await mgr.listMyOrders({ manager: { store: S1 }, query: { storeId: S2, limit: '20', page: '2' } }, res);
  assert.equal(res.statusCode, 200); assert.equal(String(seen.filter.store), S1); assert.equal(seen.filter.paymentStatus, 'paid');
  assert.equal(seen.skip, 20); assert.equal(seen.limit, 20); assert.equal(res.body.total, 120); assert.equal(res.body.hasMore, true);
  assert.deepEqual(res.body.summary, { count: 4, gross: 1200, refunded: 100, net: 1100, byStatus: { delivered: 3, preparing: 1 } });
  assert.equal(res.body.orders.length, 1);
});
test('OQ-21 store orders: page size is capped at 200', async () => {
  const seen = stubOrders(); await mgr.listMyOrders({ manager: { store: S1 }, query: { limit: '99999' } }, fakeRes()); assert.equal(seen.limit, 200);
});
test('OQ-22 admin orders: all stores by default incl. unpaid; store filter + item + location combine', async () => {
  let seen = stubOrders();
  let res = fakeRes(); await adm.adminListOrders({ query: {} }, res);
  assert.equal(res.statusCode, 200); assert.equal(seen.filter.store, undefined); assert.equal(seen.filter.paymentStatus, undefined);
  seen = stubOrders(); await adm.adminListOrders({ query: { storeId: S2, item: 'lemon', location: '600087', status: 'delivered', from: '2026-11-01' } }, fakeRes());
  assert.equal(String(seen.filter.store), S2); assert.equal(seen.filter.orderStatus, 'delivered'); assert.equal(seen.filter.$and.length, 2); assert.ok(seen.filter.createdAt.$gte);
});
test('OQ-23 summary totals: net = paid gross − refunds; cancelled-and-refunded orders net to zero', async () => {
  stubOrders({ agg: [{ _id: 'cancelled', n: 1, gross: 500, refunded: 500 }, { _id: 'delivered', n: 2, gross: 800, refunded: 50 }] });
  const res = fakeRes(); await adm.adminListOrders({ query: {} }, res);
  assert.equal(res.body.summary.gross, 1300); assert.equal(res.body.summary.refunded, 550); assert.equal(res.body.summary.net, 750);
});
test('OQ-24 CSV export: header, escaping, net, declined items, store scope', async () => {
  const seen = stubOrders({ rows: [{
    orderId: 'EX9', createdAt: new Date('2026-11-10T06:00:00Z'), store: { name: 'Valasaravakkam' }, orderStatus: 'delivered', paymentStatus: 'paid',
    deliveryAddress: { name: 'Priya, S', phone: '9876543210', addressLine: '12 "Main" Rd', city: 'Chennai', pincode: '600087' },
    items: [{ name: 'Tomato', quantity: 2 }, { name: 'Onion', quantity: 1, status: 'declined' }], pricing: { total: 200, refundedAmount: 40 },
  }] });
  let sent, headers = {}; const res = { setHeader: (k, v) => { headers[k] = v; }, send: (b) => { sent = b; }, status() { return this; }, json() {} };
  await mgr.exportMyOrders({ manager: { store: S1 }, query: {} }, res);
  assert.equal(String(seen.filter.store), S1); assert.match(headers['Content-Type'], /text\/csv/); assert.match(headers['Content-Disposition'], /store-orders/);
  const lines = sent.replace('﻿', '').split('\n'); assert.match(lines[0], /^Order ID,Date \(IST\),Store/);
  assert.match(lines[1], /EX9/); assert.match(lines[1], /"Priya, S"/); assert.match(lines[1], /"12 ""Main"" Rd, Chennai"/); assert.match(lines[1], /Onion x1 \(declined\)/); assert.match(lines[1], /,200,40,160,/);
});
test('OQ-25 admin export honours admin filters across stores', async () => {
  const seen = stubOrders(); const res = { setHeader() {}, send() {}, status() { return this; }, json() {} };
  await adm.adminExportOrders({ query: { storeId: S2, item: 'lemon' } }, res);
  assert.equal(String(seen.filter.store), S2); assert.equal(seen.filter.$and.length, 1);
});
