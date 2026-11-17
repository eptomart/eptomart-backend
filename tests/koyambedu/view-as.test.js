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
const run = async (user, header) => {
  const req = { user, headers: header ? { 'x-view-as-user': header } : {} }; const res = fakeRes(); let nexted = false;
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
