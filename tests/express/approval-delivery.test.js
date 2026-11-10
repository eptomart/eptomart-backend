// Product approval gate (admin approves before items go live online),
// owner-managed delivery settings, and super-admin "view as owner".
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { fakeRes, chain, sign } = require('./helpers');

const ExpressStore = require('../../src/models/ExpressStore');
const ExpressStoreProduct = require('../../src/models/ExpressStoreProduct');
const ExpressOnlineListing = require('../../src/models/ExpressOnlineListing');
const ExpressMarginConfig = require('../../src/models/ExpressMarginConfig');
const ExpressStockLog = require('../../src/models/ExpressStockLog');
const ExpressAuditLog = require('../../src/models/ExpressAuditLog');
const ExpressStoreManager = require('../../src/models/ExpressStoreManager');
const User = require('../../src/models/User');
const admin = require('../../src/controllers/expressAdminController');
const customer = require('../../src/controllers/expressCustomerController');
const owner = require('../../src/controllers/expressOwnerController');
ExpressAuditLog.create = async () => ({});

const req = (over = {}) => ({ body: {}, params: {}, query: {}, manager: { _id: 'M1', store: 'S1', name: 'Owner' }, managerRole: 'owner', ...over });

// ── 1. Customer catalogue hides items that are not approved ─────────────
test('AP-01 online catalogue shows approved + legacy (no status) items, hides pending and rejected', async () => {
  ExpressMarginConfig.findOne = () => chain({ isEnabled: true, deliveryTimeTiers: [] });
  ExpressStore.findOne = async () => ({ _id: 'S1' });
  const listing = (id, name) => ({ _id: `L${id}`, price: 50, product: { _id: id, unit: 'kg', name }, koyambeduProduct: null });
  ExpressOnlineListing.find = () => chain([listing('P1', 'Approved'), listing('P2', 'Legacy'), listing('P3', 'Pending'), listing('P4', 'Rejected')]);
  ExpressStoreProduct.find = () => chain([
    { product: 'P1', stockQty: 5, approval: { status: 'approved' } },
    { product: 'P2', stockQty: 5 },
    { product: 'P3', stockQty: 5, approval: { status: 'pending' } },
    { product: 'P4', stockQty: 5, approval: { status: 'rejected' } },
  ]);
  const res = fakeRes(); await customer.getOnlineCatalogue({ params: { storeId: 'S1' }, query: {} }, res);
  assert.equal(res.statusCode, 200);
  const names = (res.body.products || res.body.catalogue || []).map(p => p.product?.name).sort();
  assert.deepEqual(names, ['Approved', 'Legacy']);
});
test('AP-02 product detail of a pending item → 404 for customers', async () => {
  ExpressMarginConfig.findOne = () => chain({ isEnabled: true });
  ExpressStore.findOne = async () => ({ _id: 'S1' });
  ExpressOnlineListing.findOne = () => chain({ price: 50, product: { _id: 'P3', unit: 'kg', name: 'Pending' }, koyambeduProduct: null });
  ExpressStoreProduct.findOne = () => chain({ stockQty: 5, approval: { status: 'pending' } });
  const res = fakeRes(); await customer.getOnlineCatalogueItem({ params: { storeId: 'S1', productId: 'P3' } }, res);
  assert.equal(res.statusCode, 404);
});

// ── 2. Owner adds an item → starts pending ──────────────────────────────
const stubSave = ({ required, isAdmin = false } = {}) => {
  const seen = { upd: null };
  ExpressMarginConfig.findOne = () => chain(required === undefined ? null : { productApprovalRequired: required });
  admin.resolveExpressProduct = async () => ({ _id: 'EP1', unit: 'kg' });
  admin.upsertOnlineListing = async () => ({});
  ExpressStoreProduct.findOneAndUpdate = (f, u) => { seen.upd = u; return Promise.resolve({ _id: 'SP1', stockQty: 0, priceOverride: null }); };
  ExpressStoreProduct.findById = () => chain({ _id: 'SP1' });
  ExpressOnlineListing.findOne = () => chain(null);
  ExpressStockLog.create = async () => ({});
  return seen;
};
test('AP-10 new item added by owner is created as PENDING approval', async () => {
  const seen = stubSave({ required: true }); await owner.saveItem(req({ body: { koyambeduProductId: 'K1', price: 20, isOnline: true } }), fakeRes());
  assert.equal(seen.upd.$setOnInsert.approval.status, 'pending'); assert.ok(seen.upd.$setOnInsert.approval.requestedAt);
});
test('AP-11 default (no config saved yet) also requires approval', async () => {
  const seen = stubSave({}); await owner.saveItem(req({ body: { koyambeduProductId: 'K1' } }), fakeRes());
  assert.equal(seen.upd.$setOnInsert.approval.status, 'pending');
});
test('AP-12 kill-switch OFF → items go live without approval', async () => {
  const seen = stubSave({ required: false }); await owner.saveItem(req({ body: { koyambeduProductId: 'K1' } }), fakeRes());
  assert.equal(seen.upd.$setOnInsert.approval, undefined);
});
test('AP-13 super admin adding via owner view is auto-approved', async () => {
  const seen = stubSave({ required: true }); await owner.saveItem(req({ manager: { _id: 'A1', store: 'S1', name: 'Admin', isAdmin: true }, body: { koyambeduProductId: 'K1' } }), fakeRes());
  assert.equal(seen.upd.$setOnInsert.approval, undefined);
});
test('AP-14 existing approved row is not reset to pending (only set on insert)', async () => {
  const seen = stubSave({ required: true }); await owner.saveItem(req({ body: { koyambeduProductId: 'K1', price: 30 } }), fakeRes());
  assert.equal(seen.upd.$set?.approval, undefined); assert.equal(seen.upd.$set.priceOverride, 30);
});

// ── 3. Admin decisions ──────────────────────────────────────────────────
test('AP-20 approve selected items', async () => {
  let args; ExpressStoreProduct.updateMany = async (f, u) => { args = { f, u }; return { modifiedCount: 2 }; };
  const res = fakeRes(); await owner.adminDecideApprovals({ body: { ids: ['a', 'b'], decision: 'approve' }, user: { name: 'Admin' } }, res);
  assert.equal(res.statusCode, 200); assert.equal(res.body.updated, 2);
  assert.equal(args.u.$set['approval.status'], 'approved'); assert.equal(args.u.$set['approval.decidedBy'], 'Admin'); assert.deepEqual(args.f._id.$in, ['a', 'b']);
});
test('AP-21 reject needs a reason, then stores it', async () => {
  let args; ExpressStoreProduct.updateMany = async (f, u) => { args = u; return { modifiedCount: 1 }; };
  let res = fakeRes(); await owner.adminDecideApprovals({ body: { ids: ['a'], decision: 'reject', note: '  ' }, user: {} }, res); assert.equal(res.statusCode, 400);
  res = fakeRes(); await owner.adminDecideApprovals({ body: { ids: ['a'], decision: 'reject', note: 'Price too high' }, user: {} }, res);
  assert.equal(res.statusCode, 200); assert.equal(args.$set['approval.status'], 'rejected'); assert.equal(args.$set['approval.note'], 'Price too high');
});
test('AP-22 bad requests: no ids, unknown decision', async () => {
  let res = fakeRes(); await owner.adminDecideApprovals({ body: { ids: [], decision: 'approve' }, user: {} }, res); assert.equal(res.statusCode, 400);
  res = fakeRes(); await owner.adminDecideApprovals({ body: { ids: ['a'], decision: 'maybe' }, user: {} }, res); assert.equal(res.statusCode, 400);
});
test('AP-23 approving clears an earlier rejection note', async () => {
  let args; ExpressStoreProduct.updateMany = async (f, u) => { args = u; return { modifiedCount: 1 }; };
  await owner.adminDecideApprovals({ body: { ids: ['a'], decision: 'approve' }, user: {} }, fakeRes()); assert.equal(args.$set['approval.note'], null);
});
test('AP-24 approvals list: shape, margin info, pending filter', async () => {
  let filter; ExpressStoreProduct.find = (f) => { filter = f; return chain([{ _id: 'SP1', store: { _id: 'S1', name: 'Valasaravakkam' }, product: { _id: 'EP1', unit: 'kg', procurementBaseCost: 40, koyambeduProduct: { name: 'Tomato', currentPrice: 38 } }, priceOverride: 55, stockQty: 4, approval: { status: 'pending', requestedAt: new Date() } }]); };
  ExpressOnlineListing.find = () => chain([{ store: 'S1', product: 'EP1', isEnabled: true, price: 55 }]);
  ExpressMarginConfig.findOne = () => chain({ productApprovalRequired: true });
  const res = fakeRes(); await owner.adminListApprovals({ query: {} }, res);
  assert.equal(filter['approval.status'], 'pending'); const it = res.body.items[0];
  assert.equal(it.name, 'Tomato'); assert.equal(it.sellingPrice, 55); assert.equal(it.costPrice, 40); assert.equal(it.wantsOnline, true); assert.equal(it.source, 'Koyambedu product'); assert.equal(res.body.productApprovalRequired, true);
});
test('AP-25 approval kill-switch can be saved', async () => {
  let u; ExpressMarginConfig.updateOne = async (f, upd) => { u = upd; }; const res = fakeRes();
  await owner.adminSetApprovalRequired({ body: { required: false } }, res); assert.equal(u.$set.productApprovalRequired, false); assert.equal(res.body.productApprovalRequired, false);
});
test('AP-26 owner catalogue exposes approval status + rejection reason', async () => {
  admin.adminListOnlineCatalog = async (r, res) => res.json({ success: true, store: { _id: 'S1' }, items: [{ productId: 'EP1', name: 'X' }, { productId: 'EP2', name: 'Y' }] });
  ExpressStoreProduct.find = () => chain([{ product: 'EP1', stockQty: 1, approval: { status: 'rejected', note: 'Too pricey' } }, { product: 'EP2', stockQty: 1 }]);
  require('../../src/models/ExpressProduct').find = () => chain([]);
  const res = fakeRes(); await owner.listCatalog(req(), res);
  const [a, b] = res.body.items; assert.equal(a.approvalStatus, 'rejected'); assert.equal(a.approvalNote, 'Too pricey'); assert.equal(b.approvalStatus, 'approved');
});

// ── 4. Owner-managed delivery settings (forced to own store) ────────────
test('DL-01 owner updates delivery slots/fees/hold/online-shop — always for OWN store, never one from the body', async () => {
  const seen = [];
  for (const k of ['updateDeliverySlots', 'updateDeliveryFeeConfig', 'togglePauseStore', 'toggleOnlineShop']) admin[k] = async (r, res) => { seen.push({ k, storeId: r.params.storeId, body: r.body }); res.json({ success: true }); };
  // wrappers capture admin fns at module load, so re-require the owner controller afresh
  delete require.cache[require.resolve('../../src/controllers/expressOwnerController')];
  const fresh = require('../../src/controllers/expressOwnerController');
  for (const fn of ['updateMyDeliverySlots', 'updateMyDeliveryFee', 'toggleMyPause', 'toggleMyOnlineShop']) {
    const res = fakeRes(); await fresh[fn](req({ params: { storeId: 'HACK' }, body: { storeId: 'HACK', nextDayEnabled: false } }), res); assert.equal(res.statusCode, 200, fn);
  }
  assert.equal(seen.length, 4); assert.ok(seen.every(s => s.storeId === 'S1'), 'store must come from session');
});
test('DL-02 validation errors from the shared delivery logic are passed through', async () => {
  admin.updateDeliveryFeeConfig = async (r, res) => res.status(400).json({ success: false, message: 'minOrderForFreeDelivery must be a non-negative number' });
  delete require.cache[require.resolve('../../src/controllers/expressOwnerController')];
  const fresh = require('../../src/controllers/expressOwnerController');
  const res = fakeRes(); await fresh.updateMyDeliveryFee(req({ body: { minOrderForFreeDelivery: -1 } }), res); assert.equal(res.statusCode, 400);
});
test('DL-03 owner can read own store settings', async () => {
  ExpressStore.findById = () => chain({ _id: 'S1', deliverySlots: { windows: [] }, isPaused: false });
  const res = fakeRes(); await owner.getStoreSettings(req(), res); assert.equal(res.body.store._id, 'S1');
});

// ── 5. Super admin "view as owner" through the real middleware ──────────
const express = require('express');
const mgrCtrl = require('../../src/controllers/expressManagerController');
test('AV-01..06 admin act-as via x-express-store-id', async () => {
  // stub the dashboard handler to echo what the middleware attached
  mgrCtrl.getDashboard = (r, res) => res.json({ ok: true, store: String(r.manager.store), role: r.managerRole, isAdmin: !!r.manager.isAdmin });
  delete require.cache[require.resolve('../../src/routes/expressManager')];
  const router = require('../../src/routes/expressManager');
  const users = {
    superA: { _id: 'superA', name: 'Boss', role: 'superAdmin', permissions: [], isActive: true },
    expA: { _id: 'expA', name: 'Ex', role: 'admin', permissions: ['express'], isActive: true },
    noExpA: { _id: 'noExpA', name: 'No', role: 'admin', permissions: ['orders'], isActive: true },
    cust: { _id: 'cust', name: 'C', role: 'user', permissions: [], isActive: true },
    ownerU: { _id: 'ownerU', name: 'O', role: 'user', permissions: [], isActive: true },
  };
  User.findById = (id) => chain(users[id] || null);
  ExpressStoreManager.findOne = (q) => chain(q?.user === 'ownerU' ? { _id: 'm', store: 'OWN_STORE', role: 'owner', isActive: true } : null);
  const app = express(); app.use(express.json()); app.use('/m', router);
  const server = http.createServer(app); await new Promise(r => server.listen(0, r));
  const url = `http://127.0.0.1:${server.address().port}/m/dashboard`;
  const get = async (id, store) => { const r = await fetch(url, { headers: { Authorization: `Bearer ${sign({ id })}`, ...(store ? { 'x-express-store-id': store } : {}) } }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
  const SID = 'a'.repeat(24);
  try {
    let r = await get('superA', SID); assert.equal(r.status, 200, 'AV-01 super admin can open any store'); assert.equal(r.body.store, SID); assert.equal(r.body.role, 'owner'); assert.equal(r.body.isAdmin, true);
    r = await get('expA', SID); assert.equal(r.status, 200, 'AV-02 admin with Express permission can');
    r = await get('noExpA', SID); assert.equal(r.status, 403, 'AV-03 admin WITHOUT Express permission cannot');
    r = await get('cust', SID); assert.equal(r.status, 403, 'AV-04 a customer cannot spoof the header');
    r = await get('ownerU', 'b'.repeat(24)); assert.equal(r.status, 200); assert.equal(r.body.store, 'OWN_STORE', 'AV-05 a real owner is pinned to their own store even if they send another store id');
    r = await get('superA', 'not-an-id'); assert.equal(r.status, 400, 'AV-06 invalid store id rejected');
    r = await get('superA'); assert.equal(r.status, 403, 'AV-07 admin without a store selected is not an owner');
  } finally { server.close(); }
});
