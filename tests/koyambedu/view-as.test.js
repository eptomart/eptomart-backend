// Koyambedu — super admin "View as customer" middleware + admin-attributed cart logging.
const test = require('node:test');
const assert = require('node:assert/strict');
const { fakeRes, chain } = require('../express/helpers');
const User = require('../../src/models/User');
const Activity = require('../../src/models/KoyambeduActivity');
const svc = require('../../src/services/koyambeduActivityService');
const viewAs = require('../../src/middleware/viewAsCustomer');

const SA = { _id: 'aaaaaaaaaaaaaaaaaaaaaaaa', role: 'superAdmin' };
const CUST = '' + 'bbbbbbbbbbbbbbbbbbbbbbbb';
const run = async (user, header, url = '/api/koyambedu/cart', method = 'GET') => {
  const req = { user, method, originalUrl: url, headers: header ? { 'x-view-as-user': header } : {} }; const res = fakeRes(); let nexted = false;
  await viewAs(req, res, () => { nexted = true; });
  return { req, res, nexted };
};

test('VA-01 no header → untouched', async () => {
  const { req, nexted } = await run({ _id: 'u1', role: 'customer' });
  assert.ok(nexted); assert.equal(req.user._id, 'u1'); assert.equal(req.actingAdmin, undefined);
});
test('VA-02 super admin + header → request becomes that customer', async () => {
  User.findById = () => chain({ _id: CUST, role: 'customer', name: 'Priya' });
  const { req, nexted } = await run(SA, CUST);
  assert.ok(nexted); assert.equal(req.user._id, CUST); assert.equal(req.actingAdmin._id, SA._id);
});
test('VA-03 non-super-admin with header → 403', async () => {
  for (const role of ['customer', 'admin']) {
    const { res, nexted } = await run({ _id: 'u', role }, CUST);
    assert.equal(res.statusCode, 403); assert.equal(nexted, false);
  }
});
test('VA-04 bad id → 400, unknown customer → 404, admin target → 400', async () => {
  assert.equal((await run(SA, 'nope')).res.statusCode, 400);
  User.findById = () => chain(null);
  assert.equal((await run(SA, CUST)).res.statusCode, 404);
  User.findById = () => chain({ _id: CUST, role: 'admin' });
  assert.equal((await run(SA, CUST)).res.statusCode, 400);
});
test('VA-05 cart change by admin is logged against the customer, flagged byAdmin', async () => {
  let saved;
  Activity.create = (d) => { saved = d; return Promise.resolve(d); };
  const req = { user: { _id: CUST }, actingAdmin: SA, headers: {}, body: { productId: 'cccccccccccccccccccccccc', quantity: 3 } };
  const res = { statusCode: 200, on: (e, f) => { if (e === 'finish') res.fire = f; } };
  svc.cartTracker('set')(req, res, () => {}); res.fire();
  assert.equal(String(saved.user), CUST); assert.equal(String(saved.byAdmin), SA._id); assert.equal(saved.type, 'cart_set');
});

test('VA-06 payment & order placement refused while viewing', async () => {
  User.findById = () => chain({ _id: CUST, role: 'customer' });
  for (const u of ['/api/koyambedu/orders', '/api/koyambedu/orders/create-razorpay', '/api/koyambedu/orders/verify-payment',
    '/api/koyambedu/orders/test-payment', '/api/koyambedu/orders/abc/amend/checkout', '/api/koyambedu/orders/abc/address/verify?x=1']) {
    const r = await run(SA, CUST, u, 'POST');
    assert.equal(r.res.statusCode, 403, u); assert.equal(r.nexted, false);
  }
});
test('VA-07 checkout data, addresses, wallet, orders are served as the customer', async () => {
  User.findById = () => chain({ _id: CUST, role: 'customer' });
  for (const [u, m] of [['/api/auth/me', 'GET'], ['/api/auth/add-address', 'POST'], ['/api/auth/address/x/default', 'PATCH'],
    ['/api/koyambedu/wallet', 'GET'], ['/api/koyambedu/my-orders/1', 'GET'], ['/api/koyambedu/schedule/available?date=1', 'GET'],
    ['/api/koyambedu/check-delivery', 'POST'], ['/api/coupon/validate', 'POST']]) {
    const r = await run(SA, CUST, u, m);
    assert.ok(r.nexted, u); assert.equal(r.req.user._id, CUST, u);
  }
});
test('VA-08 header ignored on admin / seller / unrelated URLs', async () => {
  for (const u of ['/api/koyambedu/admin/carts', '/api/koyambedu/seller/profile', '/api/admin/users', '/api/express/orders']) {
    const r = await run(SA, CUST, u);
    assert.ok(r.nexted); assert.equal(r.req.user._id, SA._id, u);
  }
});
test('VA-09 viewing never mints a login token for the customer', async () => {
  const { getMe } = require('../../src/controllers/authController');
  const jwt = require('jsonwebtoken');
  User.findById = () => Promise.resolve({ _id: CUST, role: 'customer' });
  const soon = jwt.sign({ id: CUST }, process.env.JWT_SECRET, { expiresIn: '1h' });   // would normally trigger a refresh
  const res = fakeRes();
  await getMe({ user: { _id: CUST }, actingAdmin: SA, headers: { authorization: 'Bearer ' + soon } }, res);
  assert.equal(res.body.token, undefined);
});
