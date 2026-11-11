// Koyambedu P&L — Loadman & Transport payments ledger + payer names.
const test = require('node:test');
const assert = require('node:assert/strict');
const { fakeRes, chain } = require('../express/helpers');

const Order = require('../../src/models/KoyambeduOrder');
const Daily = require('../../src/models/KoyambeduDailyExpense');
const Checklist = require('../../src/models/KoyambeduProcurementChecklist');
const Entry = require('../../src/models/KoyambeduDayExpense');
const Party = require('../../src/models/KoyambeduExpenseParty');
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
  assert.equal(b.paidByRollup[0].loadman, 100);
});

test('PP-03 day transport is split by revenue and added to cost', async () => {
  stub({ orders: [order('o1', 10, 100), order('o2', 30, 100)], entries: [{ kind: 'transport', amount: 400, paidBy: 'Ravi' }] });
  const b = await day();
  assert.equal(b.dayTransportCharge, 400);
  assert.equal(b.orders[0].dayTransportShare, 100);
  assert.equal(b.orders[1].dayTransportShare, 300);
  assert.equal(b.dayCost, 400);
  assert.equal(b.dayProfit, 4000 - 400);
});

test('PP-04 transport with no orders is reported unallocated', async () => {
  stub({ entries: [{ kind: 'transport', amount: 250 }] });
  const b = await day();
  assert.equal(b.transportUnallocated, 250);
});

test('PP-05 paid-by roll-up groups by name, blank becomes (not set)', async () => {
  stub({ orders: [order('o1', 1, 100)], entries: [
    { kind: 'loadman', amount: 10, paidBy: 'A' }, { kind: 'transport', amount: 20, paidBy: 'A' }, { kind: 'transport', amount: 5 }] });
  const b = await day();
  const a = b.paidByRollup.find(p => p.name === 'A');
  assert.deepEqual([a.loadman, a.transport, a.total], [10, 20, 30]);
  assert.ok(b.paidByRollup.find(p => p.name === '(not set)'));
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

test('PP-07 add payment saves and auto-registers a new payer name', async () => {
  let created, party;
  Entry.create = async (d) => { created = d; return d; };
  Party.updateOne = async (f, u) => { party = f; };
  const r = fakeRes();
  await ctrl.adminAddDayExpense({ body: { cycle: '2026-11-10', kind: 'transport', amount: '150', paidBy: ' Mani ', paidTo: 'Lorry' }, user: admin }, r);
  assert.equal(r.statusCode, 201);
  assert.equal(created.amount, 150);
  assert.equal(created.paidBy, 'Mani');
  assert.equal(party.name, 'Mani');
});

test('PP-08 delete payment: found and not found', async () => {
  Entry.findByIdAndDelete = async () => ({ _id: 'x' });
  let r = fakeRes(); await ctrl.adminDeleteDayExpense({ params: { id: 'x' } }, r);
  assert.equal(r.body.success, true);
  Entry.findByIdAndDelete = async () => null;
  r = fakeRes(); await ctrl.adminDeleteDayExpense({ params: { id: 'x' } }, r);
  assert.equal(r.statusCode, 404);
});

test('PP-09 names: add, list, delete; blank rejected; delete leaves entries alone', async () => {
  let names = [], deleted;
  Party.updateOne = async (f) => { names.push(f.name); };
  Party.deleteOne = async (f) => { deleted = f.name; names = names.filter(n => n !== f.name); };
  Party.find = () => chain(names.map(name => ({ name })));
  Entry.deleteMany = () => { throw new Error('must not touch entries'); };
  let r = fakeRes(); await ctrl.adminAddExpenseParty({ body: { name: '  ' }, user: admin }, r);
  assert.equal(r.statusCode, 400);
  r = fakeRes(); await ctrl.adminAddExpenseParty({ body: { name: 'Ravi' }, user: admin }, r);
  assert.deepEqual(r.body.names, ['Ravi']);
  r = fakeRes(); await ctrl.adminDeleteExpenseParty({ body: { name: 'Ravi' }, query: {} }, r);
  assert.equal(deleted, 'Ravi');
  assert.deepEqual(r.body.names, []);
  r = fakeRes(); await ctrl.adminDeleteExpenseParty({ body: {}, query: {} }, r);
  assert.equal(r.statusCode, 400);
});
