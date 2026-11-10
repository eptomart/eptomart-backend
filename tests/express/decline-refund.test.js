// Declined items → refund (wallet / original payment), Express wallet,
// refund preference, and wallet use at payment confirmation.
const test = require('node:test');
const assert = require('node:assert/strict');
const { fakeRes, chain } = require('./helpers');

// ── in-memory fake wallet collection ────────────────────────────────────
const ExpressWallet = require('../../src/models/ExpressWallet');
const wallets = {};
const wget = (u) => (wallets[u] ||= { user: u, balance: 0, transactions: [] });
ExpressWallet.findOne = (q) => chain(wallets[q.user] || null);
ExpressWallet.findOneAndUpdate = async (q, u) => {
  const w = wget(q.user);
  if (q.balance?.$gte !== undefined && w.balance < q.balance.$gte) return null;
  if (u.$inc?.balance) w.balance = Math.round((w.balance + u.$inc.balance) * 100) / 100;
  return { ...w };
};
ExpressWallet.updateOne = async (q, u) => { if (u.$push?.transactions) wget(q.user).transactions.push(u.$push.transactions); };

const ExpressStoreProduct = require('../../src/models/ExpressStoreProduct');
const stockOps = [];
ExpressStoreProduct.findOneAndUpdate = async (f, u) => { stockOps.push({ f, u }); return {}; };

const walletSvc = require('../../src/services/expressWalletService');
const refund = require('../../src/services/expressRefundService');

let n = 0;
const mkOrder = (over = {}) => {
  const id = () => `I${++n}`;
  return {
    orderId: 'EX-TEST', buyer: 'U1', store: 'S1', paymentStatus: 'paid', orderStatus: 'confirmed', isDemoOrder: false,
    razorpayPaymentId: 'pay_123', refundPreference: 'wallet', paymentMethod: 'razorpay',
    items: [
      { _id: id(), product: 'P1', name: 'Tomato', unit: 'kg', unitPrice: 50, quantity: 2, lineTotal: 100, status: 'active' },
      { _id: id(), product: 'P2', name: 'Onion', unit: 'kg', unitPrice: 40, quantity: 1, lineTotal: 40, status: 'active' },
      { _id: id(), product: 'P3', name: 'Coriander', unit: 'bunch', unitPrice: 10, quantity: 6, lineTotal: 60, status: 'active' },
    ],
    pricing: { subtotal: 200, deliveryFee: 30, platformFee: 25, couponDiscount: 0, total: 255, itemsProcurementCost: 120, walletApplied: 0, refundedAmount: 0 },
    refunds: [], timeline: [], deliveryAddress: { pincode: '600042', name: 'Priya', phone: '9876543210' },
    save: async function () { return this; },
    ...over,
  };
};
const reset = () => { for (const k of Object.keys(wallets)) delete wallets[k]; stockOps.length = 0; };
const idOf = (o, name) => String(o.items.find(i => i.name === name)._id);
const fakeRzp = (impl) => ({ payments: { refund: impl } });
const expectFail = async (p, code, re) => { try { await p; assert.fail('should have thrown'); } catch (e) { assert.equal(e.statusCode, code); if (re) assert.match(e.message, re); } };

// ── computeRefund ───────────────────────────────────────────────────────
test('RF-01 partial decline refunds just that line', () => {
  const o = mkOrder(); const c = refund.computeRefund(o, [idOf(o, 'Onion')]);
  assert.equal(c.amount, 40); assert.equal(c.fullDecline, false);
});
test('RF-02 coupon is shared pro-rata (₹20 off ₹200 → Onion refund 36)', () => {
  const o = mkOrder(); o.pricing.couponDiscount = 20; o.pricing.total = 235;
  assert.equal(refund.computeRefund(o, [idOf(o, 'Onion')]).amount, 36);
});
test('RF-03 declining EVERY line refunds the lot incl. delivery + platform fee', () => {
  const o = mkOrder(); const c = refund.computeRefund(o, o.items.map(i => String(i._id)));
  assert.equal(c.fullDecline, true); assert.equal(c.amount, 255);
});
test('RF-04 refund can never exceed what is left to refund', () => {
  const o = mkOrder(); o.pricing.refundedAmount = 230; assert.equal(refund.computeRefund(o, [idOf(o, 'Tomato')]).amount, 25);
});
test('RF-05 already-declined lines are ignored', () => {
  const o = mkOrder(); o.items[1].status = 'declined'; assert.equal(refund.computeRefund(o, [idOf(o, 'Onion')]).amount, 0);
});

// ── guards ──────────────────────────────────────────────────────────────
test('RF-10 unpaid order cannot have items declined', async () => {
  reset(); const o = mkOrder({ paymentStatus: 'pending' });
  await expectFail(refund.declineItems(o, { itemIds: [idOf(o, 'Onion')], actorName: 'R' }), 400, /paid/);
});
test('RF-11 not possible once out for delivery / delivered / cancelled / not yet confirmed', async () => {
  for (const st of ['out_for_delivery', 'delivered', 'cancelled', 'placed']) {
    reset(); const o = mkOrder({ orderStatus: st });
    await expectFail(refund.declineItems(o, { itemIds: [idOf(o, 'Onion')], actorName: 'R' }), 400, /confirmed or being prepared/);
  }
});
test('RF-12 must select items; unknown/already declined ids rejected', async () => {
  reset(); const o = mkOrder();
  await expectFail(refund.declineItems(o, { itemIds: [], actorName: 'R' }), 400);
  await expectFail(refund.declineItems(o, { itemIds: ['nope'], actorName: 'R' }), 400, /already declined|not on this order/);
});

// ── money ───────────────────────────────────────────────────────────────
test('RF-20 customer chose WALLET → wallet credited, no gateway call, balance + transaction recorded', async () => {
  reset(); const o = mkOrder(); let called = false;
  const r = await refund.declineItems(o, { itemIds: [idOf(o, 'Onion')], code: 'out_of_stock', reason: 'Sold out', actorName: 'Ravi', razorpay: fakeRzp(async () => { called = true; }) });
  assert.equal(called, false); assert.equal(r.amount, 40); assert.equal(r.toWallet, 40); assert.equal(r.toSource, 0);
  assert.equal(wallets.U1.balance, 40); assert.equal(wallets.U1.transactions[0].category, 'item_declined');
  assert.equal(o.pricing.refundedAmount, 40); assert.equal(o.items[1].status, 'declined'); assert.equal(o.items[1].declinedBy, 'Ravi'); assert.equal(o.refunds[0].mode, 'wallet');
});
test('RF-21 customer chose ORIGINAL PAYMENT → Razorpay partial refund in paise, wallet untouched', async () => {
  reset(); const o = mkOrder({ refundPreference: 'source' }); let args;
  const r = await refund.declineItems(o, { itemIds: [idOf(o, 'Onion')], actorName: 'R', razorpay: fakeRzp(async (pid, body) => { args = { pid, body }; return { id: 'rfnd_1' }; }) });
  assert.equal(args.pid, 'pay_123'); assert.equal(args.body.amount, 4000); assert.equal(r.toSource, 40); assert.equal(r.toWallet, 0);
  assert.equal(wallets.U1, undefined); assert.equal(o.refunds[0].razorpayRefundId, 'rfnd_1'); assert.equal(o.refunds[0].status, 'initiated');
});
test('RF-22 source refund FAILS → money falls back to the wallet (never lost), failure recorded', async () => {
  reset(); const o = mkOrder({ refundPreference: 'source' });
  const r = await refund.declineItems(o, { itemIds: [idOf(o, 'Onion')], actorName: 'R', razorpay: fakeRzp(async () => { throw new Error('gateway down'); }) });
  assert.equal(r.fallback, true); assert.equal(r.toWallet, 40); assert.equal(r.toSource, 0); assert.equal(wallets.U1.balance, 40);
  assert.deepEqual(o.refunds.map(x => [x.mode, x.status]), [['source', 'failed'], ['wallet', 'completed']]);
  assert.equal(wallets.U1.transactions[0].category, 'refund_fallback');
});
test('RF-23 no gateway configured + source preference → wallet fallback', async () => {
  reset(); const o = mkOrder({ refundPreference: 'source' });
  const r = await refund.declineItems(o, { itemIds: [idOf(o, 'Onion')], actorName: 'R', razorpay: null });
  assert.equal(r.fallback, true); assert.equal(wallets.U1.balance, 40);
});
test('RF-24 demo order: source refund is simulated (no gateway call)', async () => {
  reset(); const o = mkOrder({ refundPreference: 'source', isDemoOrder: true }); let called = false;
  const r = await refund.declineItems(o, { itemIds: [idOf(o, 'Onion')], actorName: 'R', razorpay: fakeRzp(async () => { called = true; }) });
  assert.equal(called, false); assert.equal(r.toSource, 40);
});
test('RF-25 wallet-paid part always returns to the wallet, even if customer chose source', async () => {
  reset(); const o = mkOrder({ refundPreference: 'source' }); o.pricing.walletApplied = 200; // only ₹55 was paid by card
  let paise;
  const r = await refund.declineItems(o, { itemIds: [idOf(o, 'Tomato')], actorName: 'R', razorpay: fakeRzp(async (p, b) => { paise = b.amount; return { id: 'r' }; }) }); // refund ₹100
  assert.equal(r.toSource, 55); assert.equal(paise, 5500); assert.equal(r.toWallet, 45); assert.equal(wallets.U1.balance, 45);
});
test('RF-26 fully wallet-paid order + source preference → all to wallet', async () => {
  reset(); const o = mkOrder({ refundPreference: 'source', paymentMethod: 'wallet', razorpayPaymentId: 'wallet_EX' }); o.pricing.walletApplied = 255;
  const r = await refund.declineItems(o, { itemIds: [idOf(o, 'Onion')], actorName: 'R', razorpay: fakeRzp(async () => { throw new Error('must not call'); }) });
  assert.equal(r.toWallet, 40); assert.equal(r.fallback, false);
});
test('RF-27 second decline: cumulative refunds tracked, each source refund recorded', async () => {
  reset(); const o = mkOrder({ refundPreference: 'source' }); const rz = fakeRzp(async () => ({ id: 'r' }));
  await refund.declineItems(o, { itemIds: [idOf(o, 'Onion')], actorName: 'R', razorpay: rz });
  const r2 = await refund.declineItems(o, { itemIds: [idOf(o, 'Tomato')], actorName: 'R', razorpay: rz });
  assert.equal(o.pricing.refundedAmount, 140); assert.equal(r2.amount, 100); assert.equal(o.refunds.filter(x => x.mode === 'source').length, 2);
});
test('RF-28 declining everything cancels the order and refunds delivery + platform fee too', async () => {
  reset(); const o = mkOrder();
  const r = await refund.declineItems(o, { itemIds: o.items.map(i => String(i._id)), actorName: 'R' });
  assert.equal(r.fullyCancelled, true); assert.equal(r.amount, 255); assert.equal(o.orderStatus, 'cancelled'); assert.match(o.cancelReason, /All items unavailable/);
  assert.equal(wallets.U1.transactions[0].category, 'order_cancelled');
});
test('RF-29 "out of stock" zeroes the shelf; other reasons put stock back', async () => {
  reset(); let o = mkOrder(); await refund.declineItems(o, { itemIds: [idOf(o, 'Onion')], code: 'out_of_stock', actorName: 'R' });
  assert.deepEqual(stockOps[0].u, { $set: { stockQty: 0 } });
  reset(); o = mkOrder(); await refund.declineItems(o, { itemIds: [idOf(o, 'Tomato')], code: 'quality', actorName: 'R' });
  assert.deepEqual(stockOps[0].u, { $inc: { stockQty: 2 } });
});
test('RF-30 cost-of-goods snapshot shrinks with what is actually supplied', async () => {
  reset(); const o = mkOrder(); await refund.declineItems(o, { itemIds: [idOf(o, 'Coriander')], actorName: 'R' }); // 60 of 200 removed → 70 % remains
  assert.equal(o.pricing.itemsProcurementCost, 84);
});
test('RF-31 timeline records the decline with amount', async () => {
  reset(); const o = mkOrder(); await refund.declineItems(o, { itemIds: [idOf(o, 'Onion')], actorName: 'Ravi', reason: 'Sold out' });
  assert.match(o.timeline.at(-1).note, /Onion declined by Ravi.*₹40/);
});

// ── wallet service ──────────────────────────────────────────────────────
test('WL-01 credit then debit up to balance (cannot go negative)', async () => {
  reset(); await walletSvc.credit('U9', 50, 'item_declined', { orderId: 'X' });
  assert.equal(await walletSvc.debitUpTo('U9', 80, 'wallet_applied'), 50); assert.equal(wallets.U9.balance, 0);
  assert.equal(await walletSvc.debitUpTo('U9', 10, 'wallet_applied'), 0);
});
test('WL-02 zero / negative amounts are ignored', async () => {
  reset(); assert.equal(await walletSvc.credit('U9', 0, 'item_declined'), null); assert.equal(await walletSvc.debitUpTo('U9', -5, 'wallet_applied'), 0); assert.equal(wallets.U9, undefined);
});

// ── manager decline endpoints ───────────────────────────────────────────
const ExpressOrder = require('../../src/models/ExpressOrder');
const mgr = require('../../src/controllers/expressManagerController');
const ExpressAuditLog = require('../../src/models/ExpressAuditLog'); ExpressAuditLog.create = async () => ({});
test('RF-40 decline endpoint: other store’s order → 404', async () => {
  ExpressOrder.findOne = async () => null; const res = fakeRes();
  await mgr.declineOrderItems({ params: { orderId: 'x' }, body: { itemIds: ['a'] }, manager: { store: 'S1', name: 'R' }, managerRole: 'manager' }, res);
  assert.equal(res.statusCode, 404);
});
test('RF-41 decline endpoint: refunds + summary; service errors become 400', async () => {
  reset(); const o = mkOrder(); ExpressOrder.findOne = async () => o; let res = fakeRes();
  await mgr.declineOrderItems({ params: { orderId: 'x' }, body: { itemIds: [idOf(o, 'Onion')], code: 'out_of_stock' }, manager: { store: 'S1', name: 'Ravi' }, managerRole: 'manager' }, res);
  assert.equal(res.statusCode, 200); assert.equal(res.body.refund.amount, 40); assert.match(o.items[1].declinedBy, /Ravi \(manager\)/);
  res = fakeRes(); await mgr.declineOrderItems({ params: { orderId: 'x' }, body: { itemIds: [] }, manager: { store: 'S1', name: 'R' } }, res);
  assert.equal(res.statusCode, 400);
});
test('RF-42 preview shows the amount and the split before confirming', async () => {
  const o = mkOrder({ refundPreference: 'source' }); o.pricing.walletApplied = 200; ExpressOrder.findOne = async () => o; const res = fakeRes();
  await mgr.previewDecline({ params: { orderId: 'x' }, query: { itemIds: idOf(o, 'Tomato') }, manager: { store: 'S1' } }, res);
  assert.equal(res.body.amount, 100); assert.equal(res.body.refundPreference, 'source'); assert.equal(res.body.paidByWallet, 200); assert.equal(res.body.paidByCard, 55);
});

// ── customer: refund preference, wallet, confirmation with wallet ───────
const customer = require('../../src/controllers/expressCustomerController');
test('RF-50 customer can switch refund preference until the order closes', async () => {
  const o = mkOrder(); ExpressOrder.findOne = async () => o; let res = fakeRes();
  await customer.setRefundPreference({ params: { orderId: 'x' }, body: { preference: 'source' }, user: { _id: 'U1' } }, res);
  assert.equal(res.statusCode, 200); assert.equal(o.refundPreference, 'source');
  res = fakeRes(); await customer.setRefundPreference({ params: { orderId: 'x' }, body: { preference: 'cash' }, user: { _id: 'U1' } }, res); assert.equal(res.statusCode, 400);
  o.orderStatus = 'delivered'; res = fakeRes();
  await customer.setRefundPreference({ params: { orderId: 'x' }, body: { preference: 'wallet' }, user: { _id: 'U1' } }, res); assert.equal(res.statusCode, 400);
});
test('RF-51 wallet endpoint returns balance + latest transactions first', async () => {
  reset(); await walletSvc.credit('U1', 40, 'item_declined', { orderId: 'A' }); await walletSvc.credit('U1', 10, 'item_declined', { orderId: 'B' });
  ExpressWallet.findOne = (q) => chain(wallets[q.user] || null);
  const res = fakeRes(); await customer.getMyWallet({ user: { _id: 'U1' } }, res);
  assert.equal(res.body.balance, 50); assert.equal(res.body.transactions[0].orderId, 'B');
});
const ExpressCart = require('../../src/models/ExpressCart'); ExpressCart.findOneAndUpdate = async () => ({});
test('WP-01 part-wallet order: wallet debited once on confirmation; gateway fee only on the card part', async () => {
  reset(); await walletSvc.credit('U1', 100, 'manual_credit');
  const o = mkOrder({ paymentStatus: 'pending', orderStatus: 'placed' }); o.pricing.walletApplied = 60; o.pricing.walletDebited = false;
  await customer.confirmExpressPayment(o, { razorpayPaymentId: 'pay_9' });
  assert.equal(wallets.U1.balance, 40); assert.equal(o.pricing.walletDebited, true); assert.equal(o.pricing.razorpayFee, 3.9); assert.equal(o.paymentStatus, 'paid');
  await customer.confirmExpressPayment(o, { razorpayPaymentId: 'pay_9' }); // a repeat confirmation must not debit again
  assert.equal(wallets.U1.balance, 40);
});
test('WP-02 wallet shortfall at confirmation is flagged on the order, not silently ignored', async () => {
  reset(); await walletSvc.credit('U1', 10, 'manual_credit');
  const o = mkOrder({ paymentStatus: 'pending', orderStatus: 'placed' }); o.pricing.walletApplied = 60; o.notes = '';
  await customer.confirmExpressPayment(o, { razorpayPaymentId: 'pay_9' });
  assert.match(o.notes, /Wallet shortfall ₹50/);
});
