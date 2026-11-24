// Koyambedu named carts — in-memory fake of the two cart collections.
const test = require('node:test');
const assert = require('node:assert/strict');
const { fakeRes, chain } = require('../express/helpers');
const Cart = require('../../src/models/KoyambeduCart');
const Saved = require('../../src/models/KoyambeduSavedCart');
const User = require('../../src/models/User');
const ctrl = require('../../src/controllers/koyambeduCartsController');

const U = 'u1', A1 = 'addr1', A2 = 'addr2';
let seq, db, active;
const item = (n, q = 1, p = 10) => ({ product: n, name: n, quantity: q, unitPrice: p });
function reset(items = []) {
  seq = 0; db = [];
  active = { user: U, items, activeCartId: null, addressId: '', async save() { return this; } };
  Cart.findOne = async () => active;
  Cart.prototype.save = async function () { return this; };
  Saved.create = async (d) => { const doc = mkSaved({ _id: 's' + (++seq), ...d }); db.push(doc); return doc; };
  Saved.findOne = async (q) => db.find(d => (!q.user || d.user === q.user) && (!q._id || (q._id.$ne ? d._id !== q._id.$ne : d._id === q._id)) && (!q.name || q.name.test(d.name))) || null;
  Saved.find = (q) => chain(db.filter(d => d.user === q.user).sort((a, b) => a.createdAt - b.createdAt).map(d => ({ ...d })));
  Saved.deleteOne = async ({ _id }) => { db = db.filter(d => d._id !== _id); };
  User.findById = () => chain({ addresses: Object.assign([{ _id: A1, label: 'Home', addressLine1: '1 St', city: 'Chennai', pincode: '600087', lat: 1, lng: 2 }, { _id: A2, label: 'Shop', addressLine1: '2 St', city: 'Chennai', pincode: '600095' }], { id(i) { return this.find(a => String(a._id) === String(i)); } }) });
}
function mkSaved(d) { return { user: U, addressId: '', items: [], createdAt: ++seq, lastUsedAt: 0, markModified() {}, async save() { return this; }, ...d }; }
const call = async (fn, req) => { const r = fakeRes(); await fn({ user: { _id: U }, body: {}, params: {}, ...req }, r); return r; };

test('NC-01 first list creates "My cart" holding the current items', async () => {
  reset([item('Tomato', 2)]);
  const r = await call(ctrl.listCarts);
  assert.equal(r.body.carts.length, 1); assert.equal(r.body.carts[0].name, 'My cart'); assert.equal(r.body.carts[0].isActive, true);
  assert.equal(r.body.carts[0].itemCount, 1); assert.equal(r.body.carts[0].total, 20);
});
test('NC-02 new cart: current items saved aside, working cart becomes empty and active', async () => {
  reset([item('Tomato', 2)]);
  const r = await call(ctrl.createCart, { body: { name: 'Shop', addressId: A2 } });
  assert.equal(r.statusCode, 201); assert.equal(active.items.length, 0); assert.equal(active.addressId, A2);
  const mine = db.find(d => d.name === 'My cart'); assert.equal(mine.items[0].name, 'Tomato');
  assert.equal(r.body.carts.find(c => c.name === 'Shop').isActive, true);
  assert.equal(r.body.carts.find(c => c.name === 'Shop').place.label, 'Shop');
});
test('NC-03 switching swaps items back and forth without losing any', async () => {
  reset([item('Tomato', 2)]);
  await call(ctrl.createCart, { body: { name: 'Shop' } });
  active.items = [item('Onion', 5)];
  const my = db.find(d => d.name === 'My cart');
  await call(ctrl.switchCart, { params: { id: my._id } });
  assert.deepEqual(active.items.map(i => i.name), ['Tomato']);
  assert.deepEqual(db.find(d => d.name === 'Shop').items.map(i => i.name), ['Onion']);
});
test('NC-04 duplicate / empty names and unknown address are refused', async () => {
  reset();
  await call(ctrl.createCart, { body: { name: 'Home' } });
  assert.equal((await call(ctrl.createCart, { body: { name: ' home ' } })).statusCode, 409);
  assert.equal((await call(ctrl.createCart, { body: { name: '  ' } })).statusCode, 400);
  assert.equal((await call(ctrl.createCart, { body: { name: 'X', addressId: 'nope' } })).statusCode, 400);
});
test('NC-05 deleting the active cart switches to another; the last cart cannot be deleted', async () => {
  reset([item('Tomato')]);
  await call(ctrl.createCart, { body: { name: 'Shop' } });
  const shop = db.find(d => d.name === 'Shop'), my = db.find(d => d.name === 'My cart');
  const r = await call(ctrl.deleteCart, { params: { id: shop._id } });
  assert.equal(r.body.carts.length, 1); assert.deepEqual(active.items.map(i => i.name), ['Tomato']);
  assert.equal((await call(ctrl.deleteCart, { params: { id: my._id } })).statusCode, 400);
});
test('NC-06 rename + tag address; active cart address follows', async () => {
  reset();
  await call(ctrl.listCarts);
  const my = db[0];
  const r = await call(ctrl.updateCartMeta, { params: { id: my._id }, body: { name: 'Home', addressId: A1 } });
  assert.equal(r.body.carts[0].name, 'Home'); assert.equal(r.body.carts[0].place.pinned, true); assert.equal(active.addressId, A1);
});
test('NC-07 admin-created cart can be made without switching the customer, and is flagged', async () => {
  reset([item('Tomato')]);
  const r = await call(ctrl.createCart, { body: { name: 'For Priya', activate: false }, actingAdmin: { _id: 'admin1' } });
  assert.equal(active.items.length, 1);                                   // customer's working cart untouched
  assert.equal(r.body.carts.find(c => c.name === 'For Priya').byAdmin, true);
  assert.equal(r.body.carts.find(c => c.name === 'For Priya').isActive, false);
});
