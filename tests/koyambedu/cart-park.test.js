// Koyambedu cart — unavailable items are parked (not lost) and restored automatically.
const test = require('node:test');
const assert = require('node:assert/strict');
const { fakeRes, chain } = require('../express/helpers');
const Cart = require('../../src/models/KoyambeduCart');
const Product = require('../../src/models/KoyambeduProduct');
const Activity = require('../../src/models/KoyambeduActivity');
const ctrl = require('../../src/controllers/koyambeduController');

const U = 'bbbbbbbbbbbbbbbbbbbbbbbb', P1 = 'p1p1p1p1p1p1p1p1p1p1p1p1', P2 = 'p2p2p2p2p2p2p2p2p2p2p2p2';
const seller = { isActive: true, status: 'approved' };
const prod = (id, over = {}) => ({ _id: id, name: id, isActive: true, isAvailable: true, seller, currentPrice: 10, unit: 'kg', minQty: 0, ...over });
const item = (p) => ({ product: p, name: p.name, unitPrice: 10, unit: 'kg', quantity: 2, deliveryType: 'tomorrow', gradeKey: null });

function cartDoc(items, parked = []) {
  const d = { user: U, items, parked, saved: 0,
    markModified() {}, async save() { d.saved++; }, async populate() { return d; },
    toObject() { return { items: d.items, parked: d.parked }; } };
  return d;
}
function run(doc, liveProducts = []) {
  Cart.findOne = () => ({ populate: async () => doc });
  Product.find = () => ({ select: () => ({ populate: async () => liveProducts }) });
  const logged = []; Activity.create = (d) => { logged.push(d); return Promise.resolve(d); };
  const res = fakeRes();
  return ctrl.getCart({ user: { _id: U }, headers: {}, body: {} }, res).then(() => ({ res, logged }));
}

test('CP-01 unavailable item is parked, not lost, and logged with the reason', async () => {
  const doc = cartDoc([item(prod(P1)), item(prod(P2, { isAvailable: false }))]);
  const { res, logged } = await run(doc);
  assert.equal(doc.items.length, 1);
  assert.equal(doc.parked.length, 1);
  assert.equal(String(doc.parked[0].product), P2);
  assert.equal(doc.parked[0].reason, 'product marked unavailable');
  assert.equal(logged[0].type, 'cart_pruned');
  assert.equal(res.body.success, true);
});

test('CP-02 parked item comes back when the product is available again', async () => {
  const doc = cartDoc([item(prod(P1))], [{ product: P2, name: 'p2', unitPrice: 10, unit: 'kg', quantity: 3, deliveryType: 'tomorrow', gradeKey: null, parkedAt: new Date(), reason: 'x' }]);
  await run(doc, [prod(P2)]);
  assert.equal(doc.items.length, 2);
  assert.equal(doc.items[1].quantity, 3);
  assert.equal(doc.parked.length, 0);
});

test('CP-03 still unavailable → stays parked; no duplicate parking', async () => {
  const bad = prod(P2, { isActive: false });
  const doc = cartDoc([item(prod(P1)), item(bad)], [{ product: P2, gradeKey: null, parkedAt: new Date(), reason: 'old' }]);
  await run(doc, [bad]);
  assert.equal(doc.items.length, 1);
  assert.equal(doc.parked.length, 1);
});

test('CP-04 parked items older than 14 days are dropped', async () => {
  const old = new Date(Date.now() - 15 * 24 * 3600 * 1000);
  const doc = cartDoc([item(prod(P1)), item(prod(P2, { isActive: false }))], [{ product: 'old1', parkedAt: old }]);
  await run(doc);
  assert.ok(!doc.parked.some(x => x.product === 'old1'));
});

test('CP-05 emptying the cart (order placed / clear) also clears parked items', async () => {
  let upd;
  Cart.findOneAndUpdate = async (f, u) => { upd = u; };
  await ctrl.clearCart({ user: { _id: U } }, fakeRes());
  assert.deepEqual(upd, { items: [], parked: [] });
});
