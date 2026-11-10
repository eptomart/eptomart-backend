// WhatsApp alerts: store-team numbers, buyer messages, and that every order
// status change fires them. WhatsApp senders and Mongoose lookups are stubbed.
const test = require('node:test');
const assert = require('node:assert/strict');
const { fakeRes, chain } = require('./helpers');

// capture outgoing WhatsApp BEFORE the controllers destructure the senders
const wa = require('../../src/utils/sendWhatsApp');
const sent = [];
let templateOk = true;
wa.sendTemplateWhatsApp = async (phone, tpl, comps) => { sent.push({ kind: 'template', phone, tpl, params: comps[0].parameters.map(p => p.text) }); return { success: templateOk }; };
wa.sendMetaWhatsApp = async (phone, text) => { sent.push({ kind: 'text', phone, text }); return { success: true }; };

const ExpressStore = require('../../src/models/ExpressStore');
const ExpressOrder = require('../../src/models/ExpressOrder');
const customer = require('../../src/controllers/expressCustomerController');

let storePhones = [];
ExpressStore.findById = () => chain({ name: 'Valasaravakkam', notifyPhones: storePhones });
const order = (over = {}) => ({
  orderId: 'EXP100', store: 'S1', isDemoOrder: false, orderStatus: 'confirmed',
  deliveryAddress: { name: 'Priya', phone: '9876543210' },
  pricing: { total: 480 }, items: [{ name: 'Tomato', quantity: 2, unit: 'kg' }, { name: 'Onion', quantity: 1, unit: 'kg' }],
  ...over,
});
const reset = (phones = [], tpl = 'status_tpl') => { sent.length = 0; storePhones = phones; templateOk = true; if (tpl) process.env.META_WHATSAPP_STATUS_TEMPLATE = tpl; else delete process.env.META_WHATSAPP_STATUS_TEMPLATE; };

test('WA-01 no alert numbers configured → nothing sent', async () => { reset([]); await customer.notifyExpressStoreTeam(order(), 'new'); assert.equal(sent.length, 0); });
test('WA-02 every alert number receives the message (template path)', async () => {
  reset(['9500050027', '9444444444']); await customer.notifyExpressStoreTeam(order(), 'new');
  assert.deepEqual(sent.map(s => s.phone), ['9500050027', '9444444444']);
  assert.equal(sent[0].kind, 'template');
  assert.equal(sent[0].params[1], 'EXP100');
  assert.match(sent[0].params[2], /New Order/);
  assert.match(sent[0].params[3], /Priya/);
  assert.match(sent[0].params[3], /Rs\.480/);
  assert.match(sent[0].params[3], /Tomato x2 kg/);
});
test('WA-03 duplicates and formatting (+91, spaces) collapse to one 10-digit send', async () => {
  reset(['+91 95000 50027', '9500050027', '09500050027']); await customer.notifyExpressStoreTeam(order(), 'delivered');
  assert.equal(sent.length, 1); assert.equal(sent[0].phone, '9500050027');
});
test('WA-04 invalid numbers are skipped', async () => { reset(['12345', 'abcdefghij', '9500050027']); await customer.notifyExpressStoreTeam(order(), 'new'); assert.equal(sent.length, 1); });
test('WA-05 template failure falls back to free text', async () => {
  reset(['9500050027']); templateOk = false; await customer.notifyExpressStoreTeam(order(), 'preparing');
  assert.equal(sent.map(s => s.kind).join(), 'template,text');
  assert.match(sent[1].text, /Being Prepared/);
});
test('WA-06 no template configured → free text only', async () => { reset(['9500050027'], null); await customer.notifyExpressStoreTeam(order(), 'new'); assert.equal(sent.length, 1); assert.equal(sent[0].kind, 'text'); });
test('WA-07 demo-account orders never alert the team', async () => { reset(['9500050027']); await customer.notifyExpressStoreTeam(order({ isDemoOrder: true }), 'new'); assert.equal(sent.length, 0); });
test('WA-08 each event has its own label', async () => {
  for (const [ev, label] of [['new', /New Order/], ['confirmed', /Confirmed/], ['preparing', /Prepared/], ['out_for_delivery', /Out for Delivery/], ['delivered', /Delivered/], ['cancelled', /Cancelled/]]) {
    reset(['9500050027']); await customer.notifyExpressStoreTeam(order(), ev); assert.match(sent[0].params[2], label, ev);
  }
});
test('WA-09 cancellation reason is included', async () => {
  reset(['9500050027']); await customer.notifyExpressStoreTeam(order({ cancelReason: 'Customer unreachable' }), 'cancelled');
  assert.match(sent[0].params[3], /Customer unreachable/);
});
test('WA-10 a thrown error inside the notifier never propagates', async () => {
  reset(['9500050027']); const prev = ExpressStore.findById; ExpressStore.findById = () => { throw new Error('db down'); };
  await assert.doesNotReject(customer.notifyExpressStoreTeam(order(), 'new')); ExpressStore.findById = prev;
});
test('WA-11 buyer status message goes to the customer, with order id + label', async () => {
  reset(['9500050027']); await customer.notifyExpressBuyer(order(), 'out_for_delivery');
  assert.equal(sent[0].phone, '9876543210'); assert.match(sent[0].params[2], /On the Way/);
});
test('WA-12 buyer message skipped when order has no phone', async () => { reset(); await customer.notifyExpressBuyer(order({ deliveryAddress: { name: 'X' } }), 'confirmed'); assert.equal(sent.length, 0); });

// ── Status changes by a manager fire BOTH buyer + team alerts ───────────
const mgr = require('../../src/controllers/expressManagerController');
const fakeOrder = (status) => { const o = order({ orderStatus: status, timeline: [], save: async function () { return this; } }); return o; };
const callStatus = async (current, next) => {
  const o = fakeOrder(current); ExpressOrder.findOne = async () => o;
  reset(['9500050027']); const res = fakeRes();
  await mgr.updateOrderStatus({ params: { orderId: 'x' }, body: { status: next }, manager: { store: 'S1', name: 'Ravi' }, managerRole: 'manager' }, res);
  await new Promise(r => setImmediate(r));
  return { res, o };
};
test('WA-20 manager moves confirmed → preparing: buyer + team both notified', async () => {
  const { res, o } = await callStatus('confirmed', 'preparing');
  assert.equal(res.statusCode, 200); assert.equal(o.orderStatus, 'preparing');
  assert.deepEqual(sent.map(s => s.phone).sort(), ['9500050027', '9876543210']);
});
test('WA-21 closing an order (out_for_delivery → delivered) alerts team with Delivered', async () => {
  const { res } = await callStatus('out_for_delivery', 'delivered');
  assert.equal(res.statusCode, 200); assert.ok(sent.some(s => s.phone === '9500050027' && /Delivered/.test(s.params[2])));
});
test('WA-22 status cannot go backwards → 400 and NO message sent', async () => {
  const { res } = await callStatus('delivered', 'confirmed'); assert.equal(res.statusCode, 400); assert.equal(sent.length, 0);
});
test('WA-23 same status again → 400', async () => { const { res } = await callStatus('preparing', 'preparing'); assert.equal(res.statusCode, 400); });
test('WA-24 invalid status value → 400', async () => { const { res } = await callStatus('confirmed', 'teleported'); assert.equal(res.statusCode, 400); });
test('WA-25 cancelled order cannot be advanced', async () => { const { res } = await callStatus('cancelled', 'preparing'); assert.equal(res.statusCode, 400); });
test('WA-26 order of another store → 404', async () => {
  ExpressOrder.findOne = async () => null; reset(['9500050027']); const res = fakeRes();
  await mgr.updateOrderStatus({ params: { orderId: 'x' }, body: { status: 'preparing' }, manager: { store: 'S1', name: 'R' } }, res);
  assert.equal(res.statusCode, 404);
});
test('WA-27 timeline records who/what role moved the order', async () => {
  const { o } = await callStatus('confirmed', 'preparing'); assert.match(o.timeline.at(-1).note, /Ravi \(manager\)/);
});

// ── Admin status changes also alert the team ────────────────────────────
const adminCtrl = require('../../src/controllers/expressAdminController');
test('WA-30 admin cancels an order → buyer + store team notified with Cancelled and reason', async () => {
  const o = order({ orderStatus: 'preparing', timeline: [], save: async function () { return this; } });
  ExpressOrder.findById = async () => o; reset(['9500050027']); const res = fakeRes();
  await adminCtrl.adminUpdateOrderStatus({ params: { orderId: 'x' }, body: { status: 'cancelled', note: 'Out of stock' }, user: { name: 'Admin' } }, res);
  await new Promise(r => setImmediate(r));
  assert.equal(res.statusCode, 200); assert.equal(o.orderStatus, 'cancelled');
  assert.ok(sent.some(s => s.phone === '9500050027' && /Cancelled/.test(s.params[2]) && /Out of stock/.test(s.params[3])));
  assert.ok(sent.some(s => s.phone === '9876543210'));
});
test('WA-31 admin forward move (confirmed → preparing) alerts the team too; backwards is refused', async () => {
  let o = order({ orderStatus: 'confirmed', timeline: [], save: async function () { return this; } });
  ExpressOrder.findById = async () => o; reset(['9500050027']); let res = fakeRes();
  await adminCtrl.adminUpdateOrderStatus({ params: { orderId: 'x' }, body: { status: 'preparing' }, user: {} }, res); await new Promise(r => setImmediate(r));
  assert.equal(res.statusCode, 200); assert.ok(sent.some(s => s.phone === '9500050027'));
  o = order({ orderStatus: 'out_for_delivery', timeline: [], save: async function () { return this; } }); reset(['9500050027']); res = fakeRes();
  await adminCtrl.adminUpdateOrderStatus({ params: { orderId: 'x' }, body: { status: 'preparing' }, user: {} }, res); assert.equal(res.statusCode, 400); assert.equal(sent.length, 0);
});
