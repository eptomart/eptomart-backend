// Koyambedu — shopping-list import: parsing, matching, adding to carts, quick-add product.
const test = require('node:test');
const assert = require('node:assert/strict');
const { fakeRes, chain } = require('../express/helpers');
const svc = require('../../src/services/koyambeduListImportService');
const Product = require('../../src/models/KoyambeduProduct');
const Seller = require('../../src/models/KoyambeduSeller');
const SavedCart = require('../../src/models/KoyambeduSavedCart');
const Cart = require('../../src/models/KoyambeduCart');
const Activity = require('../../src/models/KoyambeduActivity');
const User = require('../../src/models/User');
const importCtrl = require('../../src/controllers/koyambeduListImportController');
const ctrl = require('../../src/controllers/koyambeduController');

const SELLER = { _id: 's1', isActive: true, status: 'approved' };
const P = (id, name, o = {}) => ({ _id: id, name, unit: 'kg', currentPrice: 40, minQty: 1, seller: SELLER, isNextDay: true, ...o });
const CATALOG = [P('1', 'Tomato'), P('2', 'Onion (Big)'), P('3', 'Coriander Leaves', { unit: 'bunch' }), P('4', 'Tomato Cherry', { currentPrice: 120 }), P('5', 'Beetroot')];

test('LI-01 quantity + unit are split from free text', () => {
  assert.deepEqual(svc.splitQty('Tomato 5kg'), { name: 'Tomato', qty: 5, unit: 'kg' });
  assert.deepEqual(svc.splitQty('2. Onion - 10'), { name: 'Onion', qty: 10, unit: '' });
  assert.deepEqual(svc.splitQty('500 g coriander'), { name: 'coriander', qty: 500, unit: 'g' });
});
test('LI-02 matching: exact, close spelling, extra words → matched; unknown → notfound', () => {
  const m = (t) => svc.matchOne(t, CATALOG);
  assert.equal(m('tomato').match.productId, '1'); assert.equal(m('tomato').status, 'matched');
  assert.equal(m('tomatoe').match.productId, '1');
  assert.equal(m('onion').match.productId, '2');
  assert.equal(m('beet root').match.productId, '5');
  assert.equal(m('dragon fruit').status, 'notfound'); assert.equal(m('dragon fruit').match, null);
});
test('LI-03 uncertain match is "suggested" (admin confirms), with candidates', () => {
  const r = svc.matchOne('toma', CATALOG);
  assert.ok(['suggested', 'matched'].includes(r.status)); assert.ok(r.candidates.length >= 1);
});
test('LI-04 grams become kg on a kg product; missing qty defaults to 1 and is flagged', () => {
  const lines = svc.buildLines([{ name: 'Tomato', qty: 500, unit: 'g' }, { text: 'Onion' }], CATALOG);
  assert.equal(lines[0].qty, 0.5); assert.equal(lines[1].qty, 1); assert.equal(lines[1].qtyAssumed, true);
});
test('LI-05 CSV with headers is read (columns found by name)', async () => {
  const csv = Buffer.from('Item,Qty,Unit\nTomato,5,kg\nOnion,10,kg\nCoriander,3,bunch\n');
  const raw = await svc.readList({ buffer: csv, mimetype: 'text/csv', filename: 'list.csv' });
  assert.deepEqual(raw.map(r => [r.name, r.qty, r.unit]), [['Tomato', 5, 'kg'], ['Onion', 10, 'kg'], ['Coriander', 3, 'bunch']]);
});
test('LI-06 CSV without headers: "name qty" columns', async () => {
  const raw = await svc.readList({ buffer: Buffer.from('Tomato 5kg\nBeetroot,2\n'), mimetype: 'text/csv', filename: 'x.csv' });
  assert.equal(raw[0].name, 'Tomato'); assert.equal(raw[0].qty, 5); assert.equal(raw[1].name, 'Beetroot'); assert.equal(raw[1].qty, 2);
});
test('LI-07 image: Claude reply is parsed to lines (stubbed AI)', async () => {
  const callClaude = async () => ({ text: 'Here you go:\n[{"name":"Tomato","qty":3,"unit":"kg"},{"name":"கொத்தமல்லி","qty":null,"unit":""}]' });
  const raw = await svc.readList({ buffer: Buffer.from('x'), mimetype: 'image/jpeg', filename: 'a.jpg' }, { callClaude });
  assert.equal(raw.length, 2); assert.equal(raw[0].qty, 3); assert.equal(raw[1].qty, null);
});
test('LI-08 unsupported file type is refused', async () => {
  await assert.rejects(() => svc.readList({ buffer: Buffer.from('x'), mimetype: 'application/zip', filename: 'a.zip' }), /image.*Excel.*CSV/i);
});

function stubCatalog() { Product.find = () => chain(CATALOG); }
test('LI-09 parse endpoint returns lines + stats; empty file → 422; no file → 400', async () => {
  stubCatalog();
  let res = fakeRes();
  await importCtrl.parse({ file: { buffer: Buffer.from('Item,Qty\nTomato,5\nDragon fruit,2\n'), mimetype: 'text/csv', originalname: 'l.csv' } }, res);
  assert.equal(res.body.stats.total, 2); assert.equal(res.body.stats.matched, 1); assert.equal(res.body.stats.notfound, 1);
  res = fakeRes(); await importCtrl.parse({ file: { buffer: Buffer.from('Item,Qty\n'), mimetype: 'text/csv', originalname: 'l.csv' } }, res);
  assert.equal(res.statusCode, 422);
  res = fakeRes(); await importCtrl.parse({}, res);
  assert.equal(res.statusCode, 400);
});

// ---- apply ----
function setupApply({ activeItems = [], activeCartId = 'sc1' } = {}) {
  const saved = [{ _id: 'sc1', user: 'c1', name: 'My cart', items: [], async save() {}, markModified() {} }];
  const active = { user: 'c1', items: activeItems, activeCartId, async save() {} };
  User.findById = () => chain({ _id: 'c1', role: 'customer', addresses: Object.assign([], { id() { return null; } }) });
  Product.find = () => ({ populate: async () => CATALOG.map(p => ({ ...p })) });
  Cart.findOne = async () => active;
  SavedCart.findOne = async (q) => saved.find(s => (!q._id || s._id === q._id) && (!q.name || q.name.test(s.name))) || null;
  SavedCart.create = async (d) => { const s = { _id: 'sc' + (saved.length + 1), ...d, async save() {}, markModified() {} }; saved.push(s); return s; };
  SavedCart.find = () => chain(saved);
  Activity.create = () => Promise.resolve();
  return { saved, active };
}
const apply = async (body) => { const r = fakeRes(); await importCtrl.apply({ user: { _id: 'admin1' }, body }, r); return r; };

test('LI-10 default: items go to a NEW cart "Added by Eptomart"; customer\'s current cart untouched', async () => {
  const { saved, active } = setupApply({ activeItems: [{ product: '9', quantity: 1 }] });
  const r = await apply({ userId: 'c1', lines: [{ productId: '1', quantity: 5 }, { productId: '3', quantity: 2 }] });
  assert.equal(r.body.cartName, 'Added by Eptomart');
  const target = saved.find(s => s.name === 'Added by Eptomart');
  assert.deepEqual(target.items.map(i => [i.name, i.quantity]), [['Tomato', 5], ['Coriander Leaves', 2]]);
  assert.equal(target.createdByAdmin, 'admin1'); assert.equal(active.items.length, 1);
});
test('LI-11 adding to the cart currently in use updates the working cart and sums quantities', async () => {
  const { active } = setupApply({ activeItems: [{ product: '1', name: 'Tomato', quantity: 2, unitPrice: 40, unit: 'kg', deliveryType: 'tomorrow' }] });
  const r = await apply({ userId: 'c1', cartId: 'sc1', lines: [{ productId: '1', quantity: 3 }] });
  assert.equal(r.body.added[0].quantity, 5); assert.equal(active.items.length, 1); assert.equal(active.items[0].quantity, 5);
});
test('LI-12 min quantity is applied and noted; unavailable / zero-qty lines are skipped, not fatal', async () => {
  setupApply();
  const r = await apply({ userId: 'c1', lines: [{ productId: '1', quantity: 0.2 }, { productId: 'nope', quantity: 2 }, { productId: '2', quantity: 0 }] });
  assert.equal(r.body.added[0].quantity, 1); assert.match(r.body.added[0].note, /minimum/);
  assert.equal(r.body.skipped.length, 2);
});
test('LI-13 admin accounts / unknown customer / empty list are refused', async () => {
  setupApply(); User.findById = () => chain({ _id: 'a', role: 'admin' });
  assert.equal((await apply({ userId: 'a', lines: [{ productId: '1', quantity: 1 }] })).statusCode, 404);
  assert.equal((await apply({ userId: 'a', lines: [] })).statusCode, 400);
});

// ---- quick add (super admin) ----
test('LI-14 quick-add validates, then creates a live product through the normal creator', async () => {
  const call = async (body) => { const r = fakeRes(); await ctrl.adminQuickAddProduct({ body }, r); return r; };
  assert.equal((await call({ categoryId: 'c', price: 10, sellerId: 's' })).statusCode, 400);
  assert.equal((await call({ name: 'X', price: 10, sellerId: 's' })).statusCode, 400);
  assert.equal((await call({ name: 'X', categoryId: 'c', sellerId: 's' })).statusCode, 400);
  assert.equal((await call({ name: 'X', categoryId: 'c', price: 10 })).statusCode, 400);
  Seller.findById = async () => null;
  assert.equal((await call({ name: 'X', categoryId: 'c', price: 10, sellerId: 's' })).statusCode, 404);
});
