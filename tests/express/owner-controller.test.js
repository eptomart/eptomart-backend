// Store-owner features: alert numbers, team (manager/accountant), POS users,
// own products, inheriting Koyambedu products, price/stock/online, and the
// admin "assign owner by mobile" action. Mongoose statics are stubbed.
const test = require('node:test');
const assert = require('node:assert/strict');
const { fakeRes, chain } = require('./helpers');

const ExpressStore = require('../../src/models/ExpressStore');
const ExpressStoreManager = require('../../src/models/ExpressStoreManager');
const ExpressStoreProduct = require('../../src/models/ExpressStoreProduct');
const ExpressProduct = require('../../src/models/ExpressProduct');
const ExpressOnlineListing = require('../../src/models/ExpressOnlineListing');
const ExpressStockLog = require('../../src/models/ExpressStockLog');
const ExpressPOSUser = require('../../src/models/ExpressPOSUser');
const ExpressAuditLog = require('../../src/models/ExpressAuditLog');
const ExpressMarginConfig = require('../../src/models/ExpressMarginConfig');
const User = require('../../src/models/User');
const admin = require('../../src/controllers/expressAdminController');
const owner = require('../../src/controllers/expressOwnerController');

ExpressAuditLog.create = async () => ({});
const req = (over = {}) => ({ body: {}, params: {}, query: {}, manager: { _id: 'M1', store: 'S1', name: 'Owner One' }, managerRole: 'owner', ...over });

// ── WhatsApp alert numbers ───────────────────────────────────────────────
test('OW-01 setAlerts saves cleaned, de-duplicated numbers', async () => {
  let saved; ExpressStore.updateOne = async (_, u) => { saved = u.$set.notifyPhones; };
  const res = fakeRes(); await owner.setAlerts(req({ body: { phones: ['+91 9500050027', '9500050027', '9444444444'] } }), res);
  assert.equal(res.statusCode, 200); assert.deepEqual(saved, ['9500050027', '9444444444']);
});
test('OW-02 setAlerts rejects an invalid number and saves nothing', async () => {
  let called = false; ExpressStore.updateOne = async () => { called = true; };
  const res = fakeRes(); await owner.setAlerts(req({ body: { phones: ['9500050027', '12345'] } }), res);
  assert.equal(res.statusCode, 400); assert.equal(called, false);
});
test('OW-03 setAlerts allows at most 5 numbers', async () => {
  const res = fakeRes(); await owner.setAlerts(req({ body: { phones: ['9000000001', '9000000002', '9000000003', '9000000004', '9000000005', '9000000006'] } }), res);
  assert.equal(res.statusCode, 400);
});
test('OW-04 setAlerts with empty list clears alerts', async () => {
  let saved; ExpressStore.updateOne = async (_, u) => { saved = u.$set.notifyPhones; };
  const res = fakeRes(); await owner.setAlerts(req({ body: { phones: [] } }), res); assert.equal(res.statusCode, 200); assert.deepEqual(saved, []);
});

// ── Team profiles ────────────────────────────────────────────────────────
let created;
const stubTeamDb = ({ clash = null, existingUser = null } = {}) => {
  created = null;
  ExpressStoreManager.findOne = () => chain(clash);
  User.findOne = async () => existingUser;
  User.create = async (d) => ({ _id: 'U-new', ...d });
  ExpressStoreManager.create = async (d) => { created = d; return { ...d, _id: 'T1', toObject() { return { ...d, _id: 'T1' }; } }; };
};
test('OW-10 add manager: creates a store-scoped team record linked to a user account', async () => {
  stubTeamDb(); const res = fakeRes();
  await owner.addTeamMember(req({ body: { name: 'Ravi', phone: '9876500001', role: 'manager' } }), res);
  assert.equal(res.statusCode, 201); assert.equal(created.role, 'manager'); assert.equal(created.store, 'S1'); assert.equal(created.user, 'U-new');
  assert.equal(res.body.member.password, undefined, 'password must not be returned');
});
test('OW-11 add accountant works the same', async () => {
  stubTeamDb(); const res = fakeRes();
  await owner.addTeamMember(req({ body: { name: 'Meena', phone: '9876500002', role: 'accountant' } }), res);
  assert.equal(res.statusCode, 201); assert.equal(created.role, 'accountant');
});
test('OW-12 existing Eptomart user is reused (no duplicate account)', async () => {
  stubTeamDb({ existingUser: { _id: 'U-existing' } }); let userCreated = false; User.create = async () => { userCreated = true; return {}; };
  const res = fakeRes(); await owner.addTeamMember(req({ body: { name: 'Ravi', phone: '9876500001', role: 'manager' } }), res);
  assert.equal(res.statusCode, 201); assert.equal(created.user, 'U-existing'); assert.equal(userCreated, false);
});
test('OW-13 role "owner" cannot be created through team API', async () => {
  stubTeamDb(); const res = fakeRes(); await owner.addTeamMember(req({ body: { name: 'X', phone: '9876500001', role: 'owner' } }), res); assert.equal(res.statusCode, 400);
});
test('OW-14 invalid mobile / missing name rejected', async () => {
  stubTeamDb(); let res = fakeRes(); await owner.addTeamMember(req({ body: { name: 'X', phone: '12345', role: 'manager' } }), res); assert.equal(res.statusCode, 400);
  res = fakeRes(); await owner.addTeamMember(req({ body: { name: '', phone: '9876500001', role: 'manager' } }), res); assert.equal(res.statusCode, 400);
});
test('OW-15 mobile already on THIS team → 409', async () => {
  stubTeamDb({ clash: { store: { _id: 'S1' } } }); const res = fakeRes();
  await owner.addTeamMember(req({ body: { name: 'X', phone: '9876500001', role: 'manager' } }), res); assert.equal(res.statusCode, 409); assert.match(res.body.message, /already on your team/);
});
test('OW-16 mobile already working for ANOTHER store → 409 naming that store', async () => {
  stubTeamDb({ clash: { store: { _id: 'S2', name: 'Medavakkam' } } }); const res = fakeRes();
  await owner.addTeamMember(req({ body: { name: 'X', phone: '9876500001', role: 'manager' } }), res); assert.equal(res.statusCode, 409); assert.match(res.body.message, /Medavakkam/);
});
test('OW-17 update team member: change role, suspend — scoped to own store and staff roles only', async () => {
  let filter; const m = { role: 'manager', isActive: true, async save() { return this; }, toObject() { return { ...this }; } };
  ExpressStoreManager.findOne = (f) => { filter = f; return Promise.resolve(m); };
  const res = fakeRes(); await owner.updateTeamMember(req({ params: { memberId: 'T1' }, body: { role: 'accountant', isActive: false } }), res);
  assert.equal(res.statusCode, 200); assert.equal(m.role, 'accountant'); assert.equal(m.isActive, false);
  assert.equal(filter.store, 'S1'); assert.deepEqual(filter.role, { $in: ['manager', 'accountant'] });
});
test('OW-18 update team member: cannot promote to owner', async () => {
  ExpressStoreManager.findOne = () => Promise.resolve({ role: 'manager', async save() {}, toObject() { return {}; } });
  const res = fakeRes(); await owner.updateTeamMember(req({ params: { memberId: 'T1' }, body: { role: 'owner' } }), res); assert.equal(res.statusCode, 400);
});
test('OW-19 remove team member: only staff of own store; 404 otherwise', async () => {
  let filter; ExpressStoreManager.findOneAndDelete = async (f) => { filter = f; return null; };
  let res = fakeRes(); await owner.removeTeamMember(req({ params: { memberId: 'T9' } }), res); assert.equal(res.statusCode, 404);
  assert.equal(filter.store, 'S1'); assert.deepEqual(filter.role, { $in: ['manager', 'accountant'] });
  ExpressStoreManager.findOneAndDelete = async () => ({ phone: '9', role: 'manager' }); res = fakeRes(); await owner.removeTeamMember(req({ params: { memberId: 'T1' } }), res); assert.equal(res.statusCode, 200);
});

// ── POS users ────────────────────────────────────────────────────────────
test('OW-30 create POS user for own store (username = mobile, store forced to owner’s store)', async () => {
  let doc; ExpressPOSUser.create = async (d) => { doc = d; return { ...d, toObject() { return { ...d, pin: 'hash' }; } }; };
  const res = fakeRes(); await owner.createMyPOSUser(req({ body: { name: 'Counter 1', phone: '98765 00003', pin: '4321', store: 'HACK' } }), res);
  assert.equal(res.statusCode, 201); assert.equal(doc.store, 'S1'); assert.equal(doc.username, '9876500003'); assert.equal(res.body.posUser.pin, undefined);
});
test('OW-31 POS user: short PIN / bad mobile / missing name rejected', async () => {
  for (const body of [{ name: 'A', phone: '9876500003', pin: '12' }, { name: 'A', phone: '123', pin: '1234' }, { phone: '9876500003', pin: '1234' }]) {
    const res = fakeRes(); await owner.createMyPOSUser(req({ body }), res); assert.equal(res.statusCode, 400, JSON.stringify(body));
  }
});
test('OW-32 POS user: duplicate mobile → 409', async () => {
  ExpressPOSUser.create = async () => { const e = new Error('dup'); e.code = 11000; throw e; };
  const res = fakeRes(); await owner.createMyPOSUser(req({ body: { name: 'A', phone: '9876500003', pin: '1234' } }), res); assert.equal(res.statusCode, 409);
});
test('OW-33 POS user update is scoped to own store; suspend + PIN change', async () => {
  let filter; const u = { pin: 'old', isActive: true, async save() { return this; }, toObject() { return { ...this }; } };
  ExpressPOSUser.findOne = async (f) => { filter = f; return u; };
  const res = fakeRes(); await owner.updateMyPOSUser(req({ params: { posUserId: 'P1' }, body: { isActive: false, pin: '9999' } }), res);
  assert.equal(res.statusCode, 200); assert.equal(filter.store, 'S1'); assert.equal(u.isActive, false); assert.equal(u.pin, '9999');
});

const KoyambeduProductM = require('../../src/models/KoyambeduProduct');
const noCatalogueMatch = () => { KoyambeduProductM.find = () => chain([]); ExpressProduct.find = () => chain([]); };
// ── Own products ─────────────────────────────────────────────────────────
test('OW-40 create own product: tagged with the owner’s store (private)', async () => {
  let doc; noCatalogueMatch(); ExpressProduct.findOne = () => chain(null); ExpressProduct.create = async (d) => { doc = d; return { _id: 'EP1', ...d }; };
  const res = fakeRes(); await owner.createOwnProduct(req({ body: { name: 'Homemade Pickle', unit: 'piece', procurementBaseCost: 80, ownerStore: 'HACK' } }), res);
  assert.equal(res.statusCode, 201); assert.equal(doc.ownerStore, 'S1'); assert.equal(doc.unit, 'piece'); assert.equal(doc.isWeightBased, false);
});
test('OW-41 create own product: needs name and cost; invalid unit falls back to kg', async () => {
  let res = fakeRes(); await owner.createOwnProduct(req({ body: { procurementBaseCost: 10 } }), res); assert.equal(res.statusCode, 400);
  res = fakeRes(); await owner.createOwnProduct(req({ body: { name: 'X' } }), res); assert.equal(res.statusCode, 400);
  let doc; noCatalogueMatch(); ExpressProduct.findOne = () => chain(null); ExpressProduct.create = async (d) => { doc = d; return d; };
  res = fakeRes(); await owner.createOwnProduct(req({ body: { name: 'X', unit: 'parsec', procurementBaseCost: 10 } }), res); assert.equal(doc.unit, 'kg');
});
test('OW-42 create own product: duplicate name within own store rejected', async () => {
  ExpressProduct.findOne = () => chain({ _id: 'dup' }); const res = fakeRes();
  await owner.createOwnProduct(req({ body: { name: 'Pickle', procurementBaseCost: 10 } }), res); assert.equal(res.statusCode, 409); assert.equal(res.body.duplicate, true);
});
test('OW-43 edit product: only products created by this owner’s store', async () => {
  let filter; ExpressProduct.findOne = async (f) => { filter = f; return null; };
  const res = fakeRes(); await owner.updateOwnProduct(req({ params: { productId: 'EP9' }, body: { name: 'New' } }), res);
  assert.equal(res.statusCode, 404); assert.equal(filter.ownerStore, 'S1');
});

// ── saveItem: inherit Koyambedu / own product, price, stock, online ──────
const stubItem = ({ product, spPrice = null } = {}) => {
  const calls = { sp: null, logs: [], listings: [] };
  ExpressMarginConfig.findOne = () => chain(null);
  admin.resolveExpressProduct = async () => product;
  admin.upsertOnlineListing = async (storeId, ref, opts) => { calls.listings.push({ storeId, ref, opts }); return {}; };
  ExpressStoreProduct.findOneAndUpdate = (f, u) => {
    if (u.$inc) return Promise.resolve({ _id: 'SP1', stockQty: 5 + u.$inc.stockQty, priceOverride: spPrice });
    calls.sp = { f, u }; return Promise.resolve({ _id: 'SP1', stockQty: 5, priceOverride: u.$set?.priceOverride ?? spPrice });
  };
  ExpressStoreProduct.findById = () => chain({ _id: 'SP1', stockQty: 5 });
  ExpressOnlineListing.findOne = () => chain(null);
  ExpressStockLog.create = async (d) => { calls.logs.push(d); return d; };
  return calls;
};
test('OW-50 inherit Koyambedu product "as is": store row created, price set, online ON, stock added + logged', async () => {
  const c = stubItem({ product: { _id: 'EPK1', unit: 'kg' } }); const res = fakeRes();
  await owner.saveItem(req({ body: { koyambeduProductId: 'KP1', price: 120.4, isOnline: true, addStock: 10 } }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(c.sp.f.store, 'S1'); assert.equal(c.sp.u.$set.priceOverride, 120);
  assert.equal(c.logs[0].qty, 10); assert.equal(c.logs[0].actorType, 'store_manager'); assert.equal(c.logs[0].type, 'addition');
  assert.equal(c.listings[0].opts.isEnabled, true); assert.equal(c.listings[0].opts.price, 120.4); assert.deepEqual(c.listings[0].ref, { koyambeduProductId: 'KP1' });
});
test('OW-51 offline-only: isOnline=false hides it online but keeps it in the store', async () => {
  const c = stubItem({ product: { _id: 'EPK1' } }); const res = fakeRes();
  await owner.saveItem(req({ body: { koyambeduProductId: 'KP1', price: 50, isOnline: false } }), res);
  assert.equal(res.statusCode, 200); assert.equal(c.listings[0].opts.isEnabled, false); assert.ok(c.sp, 'store product row still upserted');
});
test('OW-52 toggling online WITHOUT a price reuses the saved selling price (never resets to default markup)', async () => {
  const c = stubItem({ product: { _id: 'EPK1' }, spPrice: 77 }); const res = fakeRes();
  await owner.saveItem(req({ body: { koyambeduProductId: 'KP1', isOnline: true } }), res);
  assert.equal(c.listings[0].opts.price, 77);
});
test('OW-53 negative / non-numeric price rejected', async () => {
  stubItem({ product: { _id: 'EPK1' } });
  for (const price of [-5, 'abc']) { const res = fakeRes(); await owner.saveItem(req({ body: { koyambeduProductId: 'KP1', price } }), res); assert.equal(res.statusCode, 400, String(price)); }
});
test('OW-54 zero / negative stock is ignored (no log written)', async () => {
  const c = stubItem({ product: { _id: 'EPK1' } });
  await owner.saveItem(req({ body: { koyambeduProductId: 'KP1', addStock: 0 } }), fakeRes()); await owner.saveItem(req({ body: { koyambeduProductId: 'KP1', addStock: -3 } }), fakeRes());
  assert.equal(c.logs.length, 0);
});
test('OW-55 must choose a product', async () => { stubItem({}); const res = fakeRes(); await owner.saveItem(req({ body: { price: 10 } }), res); assert.equal(res.statusCode, 400); });
test('OW-56 unknown Koyambedu product → 404', async () => { stubItem({ product: null }); const res = fakeRes(); await owner.saveItem(req({ body: { koyambeduProductId: 'nope' } }), res); assert.equal(res.statusCode, 404); });
test('OW-57 cannot touch ANOTHER store’s private product → 403', async () => {
  stubItem({}); ExpressProduct.findOne = async () => ({ _id: 'EP7', ownerStore: 'S2' }); const res = fakeRes();
  await owner.saveItem(req({ body: { expressProductId: 'EP7', price: 10 } }), res); assert.equal(res.statusCode, 403);
});
test('OW-58 own product: owner may change cost; shared Koyambedu cost is NOT changeable', async () => {
  const own = { _id: 'EP1', ownerStore: 'S1', procurementBaseCost: 50, async save() { return this; } };
  stubItem({}); ExpressProduct.findOne = async () => own;
  await owner.saveItem(req({ body: { expressProductId: 'EP1', procurementBaseCost: 65 } }), fakeRes()); assert.equal(own.procurementBaseCost, 65);
  const shared = { _id: 'EPK1', procurementBaseCost: 40, async save() { throw new Error('must not save shared product'); } };
  stubItem({ product: shared }); const res = fakeRes();
  await owner.saveItem(req({ body: { koyambeduProductId: 'KP1', procurementBaseCost: 1 } }), res); assert.equal(shared.procurementBaseCost, 40); assert.equal(res.statusCode, 200);
});
test('OW-59 store is ALWAYS taken from the session, never from the request body', async () => {
  const c = stubItem({ product: { _id: 'EPK1' } });
  await owner.saveItem(req({ body: { koyambeduProductId: 'KP1', storeId: 'S2', store: 'S2', price: 10, isOnline: true } }), fakeRes());
  assert.equal(c.sp.f.store, 'S1'); assert.equal(c.listings[0].storeId, 'S1');
});

// ── Admin: assign owner by mobile ────────────────────────────────────────
const OID_STORE = '64b000000000000000000001', OID_USER_NEW = '64b0000000000000000000a1', OID_USER_OLD = '64b0000000000000000000a2';
const stubAssign = ({ store = { _id: OID_STORE, name: 'Valasaravakkam', async save() { return this; } }, clash = null, existingOwner = null, existingUser = null } = {}) => {
  const out = { newManager: null, userCreated: null };
  ExpressStore.findById = async () => store;
  let n = 0; ExpressStoreManager.findOne = (q) => { n++; return q.phone ? chain(clash) : Promise.resolve(existingOwner); };
  User.findOne = async () => existingUser;
  User.create = async (d) => { out.userCreated = d; return { _id: OID_USER_NEW, ...d }; };
  ExpressStoreManager.prototype.save = async function () { out.newManager = this; return this; };
  return out;
};
test('AO-01 assign owner: new mobile → reserves a user account, creates owner record, links store', async () => {
  const out = stubAssign(); const res = fakeRes();
  await admin.assignStoreOwner({ params: { storeId: OID_STORE }, body: { phone: '9876500010', name: 'Kumar' }, user: { name: 'Admin' } }, res);
  assert.equal(res.statusCode, 200); assert.equal(out.userCreated.phone, '9876500010'); assert.equal(out.newManager.phone, '9876500010');
  assert.equal(String(out.newManager.store), OID_STORE); assert.equal(String(out.newManager.user), OID_USER_NEW); assert.equal(out.newManager.role, 'owner');
  assert.equal(res.body.generatedPassword, null, 'no password is surfaced for the normal-login flow');
});
test('AO-02 assign owner: existing Eptomart user is linked, not duplicated', async () => {
  const out = stubAssign({ existingUser: { _id: OID_USER_OLD, phone: '9876500010' } }); const res = fakeRes();
  await admin.assignStoreOwner({ params: { storeId: OID_STORE }, body: { phone: '9876500010' }, user: {} }, res);
  assert.equal(res.statusCode, 200); assert.equal(out.userCreated, null); assert.equal(String(out.newManager.user), OID_USER_OLD);
});
test('AO-03 assign owner: invalid mobile → 400', async () => {
  stubAssign(); for (const phone of ['12345', '5123456789', '']) { const res = fakeRes(); await admin.assignStoreOwner({ params: { storeId: OID_STORE }, body: { phone }, user: {} }, res); assert.equal(res.statusCode, 400, phone); }
});
test('AO-04 assign owner: mobile already runs another store → 409', async () => {
  stubAssign({ clash: { store: { name: 'Medavakkam' } } }); const res = fakeRes();
  await admin.assignStoreOwner({ params: { storeId: OID_STORE }, body: { phone: '9876500010' }, user: {} }, res); assert.equal(res.statusCode, 409); assert.match(res.body.message, /Medavakkam/);
});
test('AO-05 assign owner: unknown store → 404', async () => {
  stubAssign({ store: null }); const res = fakeRes(); await admin.assignStoreOwner({ params: { storeId: 'X' }, body: { phone: '9876500010' }, user: {} }, res); assert.equal(res.statusCode, 404);
});
test('AO-06 assign owner on a store that already has one → re-points the SAME record (replace owner)', async () => {
  let saved = false; const existing = { _id: 'MGR1', phone: '9111111111', name: 'Old', isActive: false, async save() { saved = true; return this; }, toObject() { return { ...this }; } };
  stubAssign({ existingOwner: existing }); const res = fakeRes();
  await admin.assignStoreOwner({ params: { storeId: OID_STORE }, body: { phone: '9876500010', name: 'New Owner' }, user: {} }, res);
  assert.equal(res.statusCode, 200); assert.equal(existing.phone, '9876500010'); assert.equal(existing.name, 'New Owner'); assert.equal(existing.isActive, true); assert.equal(saved, true);
});

test('OW-43 create own product: same name as a Koyambedu product → suggests using it (409), nothing created', async () => {
  ExpressProduct.findOne = () => chain(null); let created = false; ExpressProduct.create = async () => { created = true; return {}; };
  KoyambeduProductM.find = () => chain([{ _id: 'KB1', name: 'Tomato', unit: 'kg' }]); ExpressProduct.find = () => chain([]);
  const res = fakeRes(); await owner.createOwnProduct(req({ body: { name: 'tomato', procurementBaseCost: 30 } }), res);
  assert.equal(res.statusCode, 409); assert.equal(res.body.duplicate, true); assert.equal(res.body.matches[0].source, 'koyambedu'); assert.equal(res.body.matches[0].koyambeduProductId, 'KB1'); assert.equal(created, false);
});
test('OW-44 create own product: same name as a company-wide Express product → suggested; force:true creates anyway', async () => {
  ExpressProduct.findOne = () => chain(null); let created = false; ExpressProduct.create = async (d) => { created = true; return { _id: 'N', ...d }; };
  KoyambeduProductM.find = () => chain([]); ExpressProduct.find = () => chain([{ _id: 'N1', name: 'Rose Milk', unit: 'litre' }]);
  let res = fakeRes(); await owner.createOwnProduct(req({ body: { name: 'Rose Milk', unit: 'litre', procurementBaseCost: 30 } }), res);
  assert.equal(res.statusCode, 409); assert.equal(res.body.matches[0].source, 'native'); assert.equal(created, false);
  res = fakeRes(); await owner.createOwnProduct(req({ body: { name: 'Rose Milk', unit: 'litre', procurementBaseCost: 30, force: true } }), res);
  assert.equal(res.statusCode, 201); assert.equal(created, true);
});
