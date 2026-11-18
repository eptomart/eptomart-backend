// Koyambedu P&L — Loadman & Transport payments ledger + payer names.
const test = require('node:test');
const assert = require('node:assert/strict');
const { fakeRes, chain } = require('../express/helpers');

const Order = require('../../src/models/KoyambeduOrder');
const Daily = require('../../src/models/KoyambeduDailyExpense');
const Checklist = require('../../src/models/KoyambeduProcurementChecklist');
const Entry = require('../../src/models/KoyambeduDayExpense');
const Party = require('../../src/models/KoyambeduExpenseParty');
const Procurer = require('../../src/models/KoyambeduProcurer');
const ctrl = require('../../src/controllers/koyambeduController');

const admin = { _id: 'aaaaaaaaaaaaaaaaaaaaaaaa' };
const line = (qty, price) => ({ name: 'Onion', product: 'p1', quantity: qty, finalPrice: price, unit: 'kg', itemStatus: 'ok' });
const order = (id, qty, price) => ({ _id: id, orderId: id, items: [line(qty, price)], pricing: { total: qty * price }, adminCosts: {}, paymentMethod: 'cod' });

function stub({ orders = [], entries = [], legacy = 0 } = {}) {
  Order.find = () => chain(orders);
  Daily.findOne = () => chain(legacy ? { loadmanCharge: legacy } : null);
  Checklist.find = () => chain([]);
  Entry.find = () => chain(entries);
}
const day = async () => { const r = fakeRes(); await ctrl.adminPnLDay({ query: { cycle: '2026-11-10' } }, r); return r.body; };

test('PP-01 legacy loadmanCharge still used when no ledger entries', async () => {
  stub({ orders: [order('o1', 10, 100)], legacy: 100 });
  const b = await day();
  assert.equal(b.loadmanCharge, 100);
  assert.equal(b.dayTransportCharge, 0);
});

test('PP-02 ledger loadman entries sum and override legacy', async () => {
  stub({ orders: [order('o1', 10, 100)], legacy: 999, entries: [
    { kind: 'loadman', amount: 60, paidBy: 'Ravi' }, { kind: 'loadman', amount: 40, paidBy: 'Ravi' }] });
  const b = await day();
  assert.equal(b.loadmanCharge, 100);
  assert.equal(b.settlement.find(p => p.name === 'Ravi').loadman, 100);
});

test('PP-03 day transport / misc are DAY overheads — not pushed onto bills', async () => {
  stub({ orders: [order('o1', 10, 100), order('o2', 30, 100)], entries: [
    { kind: 'transport', amount: 400, paidBy: 'Ravi' }, { kind: 'misc', category: 'Stationery', amount: 100, paidBy: 'Ravi', note: 'bill books' }] });
  const b = await day();
  assert.equal(b.dayTransportCharge, 400);
  assert.equal(b.miscTotal, 100);
  assert.equal(b.orders[0].totalCost, 0);              // bills untouched
  assert.equal(b.orderCostTotal, 0);
  assert.equal(b.dayOverheads, 500);
  assert.equal(b.grossProfit, 4000);
  assert.equal(b.dayCost, 500);
  assert.equal(b.dayProfit, 3500);
  assert.deepEqual(b.miscByCategory, [{ category: 'Stationery', amount: 100 }]);
});

test('PP-03b loadman is a day overhead, never allocated to items', async () => {
  stub({ orders: [order('o1', 10, 100)], entries: [{ kind: 'loadman', amount: 100, paidBy: 'A' }] });
  const b = await day();
  assert.equal(b.loadmanCharge, 100);
  assert.equal(b.orders[0].loadmanCost, 0);
  assert.equal(b.itemRollup[0].loadmanCost, 0);
  assert.equal(b.dayOverheads, 100);
  assert.equal(b.dayProfit, 900);
});

test('PP-04 overheads on a day with no orders still reduce the day result', async () => {
  stub({ entries: [{ kind: 'transport', amount: 250 }, { kind: 'misc', amount: 50 }] });
  const b = await day();
  assert.equal(b.dayCost, 300); assert.equal(b.dayProfit, -300);
});

test('PP-05 settlement: who paid what out of pocket (procurement, loadman, transport, misc, bill costs)', async () => {
  const o = order('o1', 1, 100); o.adminCosts = { transportCharge: 20, packingCharge: 5, costPaidBy: 'A' };
  stub({ orders: [o], entries: [
    { kind: 'loadman', amount: 10, paidBy: 'A' }, { kind: 'misc', amount: 7, paidBy: 'A' }, { kind: 'transport', amount: 5 }] });
  const b = await day();
  const a = b.settlement.find(p => p.name === 'A');
  assert.deepEqual([a.loadman, a.misc, a.billCosts, a.total], [10, 7, 25, 42]);
  assert.ok(b.settlement.find(p => p.name === '(not set)'));
});

test('PP-06 add payment validates cycle, kind and amount', async () => {
  for (const body of [
    { cycle: 'bad', kind: 'loadman', amount: 5 },
    { cycle: '2026-11-10', kind: 'fuel', amount: 5 },
    { cycle: '2026-11-10', kind: 'loadman', amount: 0 },
    { cycle: '2026-11-10', kind: 'loadman', amount: 'abc' }]) {
    const r = fakeRes(); await ctrl.adminAddDayExpense({ body, user: admin }, r);
    assert.equal(r.statusCode, 400);
  }
});

test('PP-07 add expense saves; transport is refused (bill level only)', async () => {
  let created;
  Entry.create = async (d) => { created = d; return d; };
  let r = fakeRes();
  await ctrl.adminAddDayExpense({ body: { cycle: '2026-11-10', kind: 'loadman', amount: '150', paidBy: ' Mani ', paidTo: 'Gate' }, user: admin }, r);
  assert.equal(r.statusCode, 201); assert.equal(created.amount, 150); assert.equal(created.paidBy, 'Mani'); assert.equal(created.category, '');
  r = fakeRes();
  await ctrl.adminAddDayExpense({ body: { cycle: '2026-11-10', kind: 'transport', amount: 100 }, user: admin }, r);
  assert.equal(r.statusCode, 400); assert.match(r.body.message, /per bill/i);
});

test('PP-08 delete payment: found and not found', async () => {
  Entry.findByIdAndDelete = async () => ({ _id: 'x' });
  let r = fakeRes(); await ctrl.adminDeleteDayExpense({ params: { id: 'x' } }, r);
  assert.equal(r.body.success, true);
  Entry.findByIdAndDelete = async () => null;
  r = fakeRes(); await ctrl.adminDeleteDayExpense({ params: { id: 'x' } }, r);
  assert.equal(r.statusCode, 404);
});

test('PP-09 ONE people list: add, list, delete from the same list; old paid-by names merged in', async () => {
  let procs = [{ name: 'Ravi' }], parties = [{ name: 'OldPayer' }];
  Procurer.find = () => chain(procs); Party.find = () => chain(parties);
  Procurer.updateOne = async (f) => { if (!procs.some(p => p.name === f.name)) procs.push({ name: f.name }); };
  Procurer.deleteOne = async (f) => { procs = procs.filter(p => p.name !== f.name); };
  Party.deleteOne = async (f) => { parties = parties.filter(p => p.name !== f.name); };
  let r = fakeRes(); await ctrl.adminListProcurers({}, r);
  assert.deepEqual(r.body.names, ['OldPayer', 'Ravi']);                 // merged
  r = fakeRes(); await ctrl.adminAddExpenseParty({ body: { name: '  ' }, user: admin }, r);
  assert.equal(r.statusCode, 400);
  r = fakeRes(); await ctrl.adminAddProcurer({ body: { name: 'Mani' }, user: admin }, r);
  assert.deepEqual(r.body.names, ['Mani', 'OldPayer', 'Ravi']);
  r = fakeRes(); await ctrl.adminDeleteExpenseParty({ body: {}, query: { name: 'OldPayer' } }, r);   // via the "paid by" route
  assert.deepEqual(r.body.names, ['Mani', 'Ravi']);
  r = fakeRes(); await ctrl.adminDeleteProcurer({ body: {}, query: { name: 'Ravi' } }, r);          // via the "procured by" route
  assert.deepEqual(r.body.names, ['Mani']);
  r = fakeRes(); await ctrl.adminDeleteProcurer({ body: {}, query: {} }, r);
  assert.equal(r.statusCode, 400);
});

test('PP-10 misc payment keeps category + comment; blank category → Other', async () => {
  let created;
  Entry.create = async (d) => { created = d; return d; }; Party.updateOne = async () => {};
  let r = fakeRes();
  await ctrl.adminAddDayExpense({ body: { cycle: '2026-11-10', kind: 'misc', amount: 80, category: 'Packing material', note: 'tape rolls', paidBy: 'Mani' }, user: admin }, r);
  assert.equal(created.category, 'Packing material'); assert.equal(created.note, 'tape rolls');
  r = fakeRes();
  await ctrl.adminAddDayExpense({ body: { cycle: '2026-11-10', kind: 'misc', amount: 10 }, user: admin }, r);
  assert.equal(created.category, 'Other');
});

test('PP-11 per-bill costs can record who paid', async () => {
  const Order2 = require('../../src/models/KoyambeduOrder');
  let saved; const doc = { adminCosts: {}, async save() { saved = this.adminCosts; } };
  Order2.findById = async () => doc;
  await ctrl.adminUpdateOrderCosts({ params: { orderId: 'x' }, body: { transportCharge: 30, costPaidBy: ' Ravi ' }, user: admin }, fakeRes());
  assert.equal(saved.costPaidBy, 'Ravi'); assert.equal(saved.transportCharge, 30);
});

test('PP-12 edit an expense: amount, paid by, comments; bad amount rejected; kind cannot change', async () => {
  const doc = { kind: 'misc', amount: 10, paidBy: 'A', note: '', category: 'Fuel', async save() { this.saved = true; } };
  Entry.findById = async () => doc;
  let r = fakeRes();
  await ctrl.adminUpdateDayExpense({ params: { id: 'x' }, body: { amount: '75', paidBy: ' B ', note: 'tape', category: 'Stationery', kind: 'loadman' } }, r);
  assert.equal(doc.amount, 75); assert.equal(doc.paidBy, 'B'); assert.equal(doc.note, 'tape'); assert.equal(doc.category, 'Stationery'); assert.equal(doc.kind, 'misc');
  r = fakeRes(); await ctrl.adminUpdateDayExpense({ params: { id: 'x' }, body: { amount: 0 } }, r);
  assert.equal(r.statusCode, 400);
  Entry.findById = async () => null;
  r = fakeRes(); await ctrl.adminUpdateDayExpense({ params: { id: 'x' }, body: {} }, r);
  assert.equal(r.statusCode, 404);
});

test('PP-13 saving procurement rows does not bring a deleted Procured-By name back', async () => {
  const Procurer = require('../../src/models/KoyambeduProcurer');
  let touched = false; Procurer.updateOne = async () => { touched = true; };
  const Checklist2 = require('../../src/models/KoyambeduProcurementChecklist');
  Checklist2.findOneAndUpdate = async () => ({}); Checklist2.bulkWrite = async () => ({});
  Checklist2.find = () => chain([]);
  try {
    await ctrl.adminBulkUpdateProcurementItems({ body: { cycle: '2026-11-10', items: [{ productKey: 'p', productName: 'P', purchasedByName: 'Ghost' }] }, user: admin }, fakeRes());
  } catch (_) { /* other stubs may be missing — only the name registration matters */ }
  await new Promise(r => setTimeout(r, 10));
  assert.equal(touched, false);
});
