// Role gates + authentication on the store dashboard API, exercised over real
// HTTP with the actual middleware + router. Controllers are replaced by
// "reached" stubs and Mongoose lookups are stubbed — so a 200 means the
// request PASSED auth + role checks and reached the handler.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { chain, sign } = require('./helpers');

const express = require('express');
const ExpressStoreManager = require('../../src/models/ExpressStoreManager');
const User = require('../../src/models/User');

// 1) stub controllers BEFORE the router reads them
const reached = (req, res) => res.json({ success: true, reached: true, role: req.managerRole });
for (const modPath of ['../../src/controllers/expressManagerController', '../../src/controllers/expressOwnerController', '../../src/controllers/expressManagerAuthController']) {
  const m = require(modPath);
  for (const k of Object.keys(m)) m[k] = reached;
}
const router = require('../../src/routes/expressManager');

// 2) DB lookups used by the auth middleware
const db = { managers: {}, byUser: {}, users: {} };
ExpressStoreManager.findById = (id) => chain(db.managers[id] || null);
ExpressStoreManager.findOne = (q) => chain(q && q.user ? db.byUser[String(q.user)] || null : null);
User.findById = (id) => chain(db.users[id] || null);

const mk = (id, role, extra = {}) => ({ _id: id, name: id, role, isActive: true, store: 'S1', ...extra });
db.managers.legacyOwner = mk('legacyOwner', undefined);           // pre-roles record → owner
db.managers.mgr = mk('mgr', 'manager');
db.managers.acc = mk('acc', 'accountant');
db.managers.suspended = mk('suspended', 'manager', { isActive: false });
db.users.uOwner = { _id: 'uOwner', isActive: true }; db.byUser.uOwner = mk('m-owner', 'owner');
db.users.uMgr = { _id: 'uMgr', isActive: true };     db.byUser.uMgr = mk('m-mgr', 'manager');
db.users.uAcc = { _id: 'uAcc', isActive: true };     db.byUser.uAcc = mk('m-acc', 'accountant');
db.users.uSusp = { _id: 'uSusp', isActive: true };   db.byUser.uSusp = mk('m-susp', 'manager', { isActive: false });
db.users.uCustomer = { _id: 'uCustomer', isActive: true };      // normal customer, not on any team
db.users.uBanned = { _id: 'uBanned', isActive: false }; db.byUser.uBanned = mk('m-banned', 'owner');

let server, base;
test.before(async () => {
  const app = express(); app.use(express.json()); app.use('/api/express/manager', router);
  server = http.createServer(app); await new Promise(r => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}/api/express/manager`;
});
test.after(() => server.close());

const call = async (method, path, token) => {
  const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: method === 'GET' ? undefined : '{}' });
  return r.status;
};

// [id, method, path, allowed roles]
const MATRIX = [
  ['RB-01', 'GET', '/dashboard', ['owner', 'manager', 'accountant']],
  ['RB-02', 'GET', '/store', ['owner', 'manager', 'accountant']],
  ['RB-03', 'PATCH', '/store/toggle', ['owner', 'manager']],
  ['RB-04', 'GET', '/products', ['owner', 'manager']],
  ['RB-05', 'PATCH', '/products/x/toggle', ['owner', 'manager']],
  ['RB-06', 'POST', '/products/x/loss', ['owner', 'manager']],
  ['RB-07', 'GET', '/orders', ['owner', 'manager', 'accountant']],
  ['RB-08', 'PATCH', '/orders/x/status', ['owner', 'manager']],
  ['RB-09', 'PATCH', '/orders/x/delivery-expense', ['owner', 'manager']],
  ['RB-10', 'GET', '/inventory-requests', ['owner', 'manager']],
  ['RB-11', 'GET', '/owner/overview', ['owner', 'accountant']],
  ['RB-12', 'GET', '/owner/accounts', ['owner', 'accountant']],
  ['RB-13', 'GET', '/owner/expenses', ['owner', 'accountant']],
  ['RB-14', 'POST', '/owner/expenses', ['owner', 'accountant']],
  ['RB-15', 'GET', '/owner/catalog', ['owner']],
  ['RB-16', 'POST', '/owner/items', ['owner']],
  ['RB-17', 'POST', '/owner/products', ['owner']],
  ['RB-18', 'GET', '/owner/pos-users', ['owner']],
  ['RB-19', 'POST', '/owner/pos-users', ['owner']],
  ['RB-20', 'GET', '/owner/team', ['owner']],
  ['RB-21', 'POST', '/owner/team', ['owner']],
  ['RB-22', 'GET', '/owner/alerts', ['owner']],
  ['RB-23', 'PUT', '/owner/alerts', ['owner']],
  ['RB-24', 'GET', '/owner/store', ['owner']],
  ['RB-25', 'PATCH', '/owner/store/delivery-slots', ['owner']],
  ['RB-26', 'PATCH', '/owner/store/delivery-fee', ['owner']],
  ['RB-27', 'PATCH', '/owner/store/toggle-online-shop', ['owner']],
  ['RB-28', 'PATCH', '/owner/store/toggle-pause', ['owner', 'manager']],
];
const actors = {
  owner: () => sign({ id: 'uOwner' }),            // normal Eptomart login
  manager: () => sign({ id: 'uMgr' }),
  accountant: () => sign({ id: 'uAcc' }),
};
for (const [id, method, path, allowed] of MATRIX) {
  test(`${id} ${method} ${path} → allowed for ${allowed.join('/')}, 403 for others`, async () => {
    for (const role of ['owner', 'manager', 'accountant']) {
      const status = await call(method, path, actors[role]());
      assert.equal(status, allowed.includes(role) ? 200 : 403, `${role} on ${method} ${path}`);
    }
  });
}

test('RB-30 no token → 401', async () => assert.equal(await call('GET', '/dashboard'), 401));
test('RB-31 garbage token → 401', async () => assert.equal(await call('GET', '/dashboard', 'not.a.jwt'), 401));
test('RB-32 normal customer (not on any team) → 403 "not a store owner"', async () => assert.equal(await call('GET', '/dashboard', sign({ id: 'uCustomer' })), 403));
test('RB-33 unknown user id → 401', async () => assert.equal(await call('GET', '/dashboard', sign({ id: 'ghost' })), 401));
test('RB-34 suspended team member (normal login) → 403', async () => assert.equal(await call('GET', '/dashboard', sign({ id: 'uSusp' })), 403));
test('RB-35 deactivated user account → 401 even if still on the team', async () => assert.equal(await call('GET', '/dashboard', sign({ id: 'uBanned' })), 401));
test('RB-36 legacy manager-password token works; missing role is treated as owner', async () => {
  assert.equal(await call('GET', '/owner/catalog', sign({ id: 'legacyOwner', type: 'expressManager' })), 200);
});
test('RB-37 legacy token of a manager-role record cannot reach owner-only routes', async () => {
  assert.equal(await call('GET', '/owner/catalog', sign({ id: 'mgr', type: 'expressManager' })), 403);
  assert.equal(await call('PATCH', '/orders/x/status', sign({ id: 'mgr', type: 'expressManager' })), 200);
});
test('RB-38 legacy token of a suspended record → 401', async () => assert.equal(await call('GET', '/dashboard', sign({ id: 'suspended', type: 'expressManager' })), 401));
test('RB-39 customer/seller/POS token types are rejected on manager routes', async () => {
  assert.equal(await call('GET', '/dashboard', sign({ id: 'uOwner', type: 'expressPOS' })), 401);
});
test('RB-40 /owner-access needs a normal login (no token → 401)', async () => assert.equal(await call('GET', '/owner-access'), 401));
