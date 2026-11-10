// Store GST profile (set once, locked after first invoice) and the GST
// invoice issued on behalf of the store.
const test = require('node:test');
const assert = require('node:assert/strict');
const { fakeRes, chain } = require('./helpers');

const ExpressStore = require('../../src/models/ExpressStore');
const ExpressProduct = require('../../src/models/ExpressProduct');
const ExpressAuditLog = require('../../src/models/ExpressAuditLog'); ExpressAuditLog.create = async () => ({});
const ExpressOrder = require('../../src/models/ExpressOrder');
const ExpressStoreProduct = require('../../src/models/ExpressStoreProduct');
const ExpressWallet = require('../../src/models/ExpressWallet');
const wallets = {};
ExpressWallet.findOne = (q) => chain(wallets[q.user] || null);
ExpressWallet.findOneAndUpdate = async (q, u) => { const w = (wallets[q.user] ||= { balance: 0, transactions: [] }); w.balance += u.$inc?.balance || 0; return { ...w }; };
ExpressWallet.updateOne = async () => ({});
ExpressStoreProduct.findOneAndUpdate = async () => ({});

const inv = require('../../src/utils/expressInvoice');
const refund = require('../../src/services/expressRefundService');
const owner = require('../../src/controllers/expressOwnerController');

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
    save: async function () { return this; }, markModified() {},
    ...over,
  };
};
const idOf = (o, name) => String(o.items.find(i => i.name === name)._id);
const store = (g = {}, extra = {}) => ({ _id: 'S1', name: 'Valasaravakkam', code: 'VALASA', address: '12 Main Rd', pincode: '600087', gst: { registered: true, gstin: '33ABCDE1234F1Z5', legalName: 'Sri Fresh Mart', stateCode: '33', defaultGstRate: 0, deliveryGstRate: 18, hsnDefault: '0709', ...g }, ...extra });
const pm = { P1: { gstRate: 5, hsnCode: '0702' } };
const approx = (a, b, m = '') => assert.ok(Math.abs(a - b) < 0.011, `${m} ${a} vs ${b}`);

// ── invoice content ─────────────────────────────────────────────────────
test('GI-01 registered store → TAX invoice in the store’s name with GSTIN, FSSAI and state', () => {
  const i = inv.buildInvoice(mkOrder(), store({ fssai: '12345678901234' }), pm);
  assert.equal(i.type, 'tax_invoice'); assert.equal(i.seller.name, 'Sri Fresh Mart'); assert.equal(i.seller.gstin, '33ABCDE1234F1Z5');
  assert.equal(i.seller.fssai, '12345678901234'); assert.equal(i.seller.stateCode, '33');
});
test('GI-02 per-product GST: Tomato 5 % (HSN 0702), others store default 0 %; prices tax-inclusive', () => {
  const i = inv.buildInvoice(mkOrder(), store(), pm); const t = i.lines.find(l => l.description === 'Tomato');
  assert.equal(t.rate, 5); assert.equal(t.hsn, '0702'); approx(t.taxable, 95.24); approx(t.cgst + t.sgst, 4.76); assert.equal(t.total, 100);
  assert.equal(i.lines.find(l => l.description === 'Onion').rate, 0);
});
test('GI-03 same state → CGST+SGST (half each); different state → IGST', () => {
  const o = mkOrder(); let t = inv.buildInvoice(o, store(), pm).lines.find(l => l.description === 'Tomato');
  approx(t.cgst, t.sgst, 'cgst=sgst'); assert.equal(t.igst, 0);
  o.deliveryAddress.pincode = '560001'; const i2 = inv.buildInvoice(o, store(), pm); t = i2.lines.find(l => l.description === 'Tomato');
  assert.equal(i2.interState, true); assert.equal(t.cgst, 0); approx(t.igst, 4.76);
});
test('GI-04 delivery charge is the store’s supply at its delivery GST % (SAC 9965)', () => {
  const d = inv.buildInvoice(mkOrder(), store(), pm).lines.find(l => l.description === 'Delivery charges');
  assert.equal(d.hsn, '9965'); assert.equal(d.rate, 18); approx(d.taxable, 25.42);
});
test('GI-05 platform fee is NOT on the store’s invoice (shown separately); payable reconciles to amount paid', () => {
  const o = mkOrder(); const i = inv.buildInvoice(o, store(), pm);
  assert.equal(i.platform.amount, 25); assert.ok(!i.lines.some(l => /platform/i.test(l.description)));
  assert.ok(Math.abs(i.payable - o.pricing.total) <= 0.5);
});
test('GI-06 coupon is spread over item lines; totals still reconcile', () => {
  const o = mkOrder(); o.pricing.couponDiscount = 20; o.pricing.total = 235; const i = inv.buildInvoice(o, store(), pm);
  assert.ok(Math.abs(i.payable - 235) <= 0.5); approx(i.lines.reduce((a, l) => a + l.total, 0), 200 - 20 + 30);
});
test('GI-07 declined line excluded from supply, listed separately; net paid reflects the refund', async () => {
  const o = mkOrder(); await refund.declineItems(o, { itemIds: [idOf(o, 'Onion')], actorName: 'R' });
  const i = inv.buildInvoice(o, store(), pm);
  assert.ok(!i.lines.some(l => l.description === 'Onion')); assert.equal(i.declined[0].name, 'Onion'); assert.equal(i.declined[0].refund, 40);
  assert.equal(i.payment.refunded, 40); assert.equal(i.payment.netPaid, 215); assert.ok(Math.abs(i.payable - 215) <= 0.5);
});
test('GI-08 everything declined → no invoice', async () => {
  const o = mkOrder(); await refund.declineItems(o, { itemIds: o.items.map(i => String(i._id)), actorName: 'R' });
  assert.equal(inv.buildInvoice(o, store(), pm), null);
});
test('GI-09 unregistered store → BILL OF SUPPLY: no tax, no GSTIN, legal name still shown', () => {
  const i = inv.buildInvoice(mkOrder(), store({ registered: false, gstin: null }), pm);
  assert.equal(i.type, 'bill_of_supply'); assert.equal(i.seller.gstin, null);
  assert.ok(i.lines.every(l => l.rate === 0 && l.cgst + l.sgst + l.igst === 0)); assert.equal(i.seller.name, 'Sri Fresh Mart');
});
test('GI-10 registered but every line 0 % (exempt produce) and no delivery → Bill of Supply', () => {
  const o = mkOrder(); o.pricing.deliveryFee = 0; o.pricing.total = 225;
  assert.equal(inv.buildInvoice(o, store(), {}).type, 'bill_of_supply');
});
test('GI-11 units map to GST UQC codes', () => {
  const i = inv.buildInvoice(mkOrder(), store(), pm);
  assert.equal(i.lines.find(l => l.description === 'Tomato').uqc, 'KGS'); assert.equal(i.lines.find(l => l.description === 'Coriander').uqc, 'BND');
});
test('GI-12 round-off: grand total is a whole rupee', () => {
  const i = inv.buildInvoice(mkOrder(), store(), pm);
  assert.equal(Number.isInteger(i.totals.grand), true); approx(i.totals.grand - i.totals.total, i.totals.roundOff);
});
test('GI-13 place of supply from delivery pincode', () => {
  assert.equal(inv.stateFromPin('600042'), '33'); assert.equal(inv.stateFromPin('560001'), '29'); assert.equal(inv.stateFromPin('682001'), '32'); assert.equal(inv.stateFromPin('999999'), null);
});
test('GI-14 GSTIN format validation', () => {
  assert.ok(inv.GSTIN_RE.test('33ABCDE1234F1Z5'));
  for (const bad of ['33ABCDE1234F1Z', '99ZZZZZ', '00ABCDE1234F1Z5', '33abcde1234f1z5', '']) assert.ok(!inv.GSTIN_RE.test(bad), bad);
});
test('GI-15 store without a GST profile still gets a valid Bill of Supply under the store name', () => {
  const i = inv.buildInvoice(mkOrder(), { _id: 'S1', name: 'Anna Nagar Store', code: 'ANN', address: 'Anna Nagar', pincode: '600040', gst: undefined }, pm);
  assert.equal(i.type, 'bill_of_supply'); assert.equal(i.seller.name, 'Anna Nagar Store');
});

// ── proforma → final ────────────────────────────────────────────────────
test('GI-20 PROFORMA before delivery (no number); FINAL on delivery with running number, frozen, GST profile locked, idempotent', async () => {
  const st = store(); let counter = 0; let lockedSet = false;
  ExpressStore.findById = () => chain(st);
  ExpressStore.findByIdAndUpdate = () => chain({ ...st, gst: { ...st.gst, invoicePrefix: null, invoiceCounter: ++counter } });
  ExpressStore.updateOne = async (f, u) => { if (u.$set?.['gst.lockedAt']) lockedSet = true; };
  ExpressProduct.find = () => chain([{ _id: 'P1', gstRate: 5, hsnCode: '0702' }]);
  const o = mkOrder();
  let r = await inv.getOrIssueInvoice(o);
  assert.equal(r.isFinal, false); assert.equal(r.number, null); assert.match(r.label, /PROFORMA/); assert.equal(counter, 0);
  o.orderStatus = 'delivered'; r = await inv.getOrIssueInvoice(o);
  assert.equal(r.isFinal, true); assert.match(r.number, /^VALASA\/\d{4}\/00001$/); assert.equal(lockedSet, true); assert.equal(o.taxInvoice.number, r.number);
  const again = await inv.getOrIssueInvoice(o); assert.equal(again.number, r.number); assert.equal(counter, 1);
});
test('GI-21 invoice endpoint: buyer OK; stranger 403; unpaid 400; fully refunded → 404', async () => {
  const customer = require('../../src/controllers/expressCustomerController');
  const ExpressStoreManager = require('../../src/models/ExpressStoreManager');
  ExpressStoreManager.findOne = () => chain(null);
  ExpressStore.findById = () => chain(store()); ExpressProduct.find = () => chain([]);
  const o = mkOrder(); ExpressOrder.findOne = async () => o;
  let res = fakeRes(); await customer.getInvoice({ params: { orderId: 'EX-TEST' }, user: { _id: 'U1', role: 'user' } }, res);
  assert.equal(res.statusCode, 200); assert.equal(res.body.invoice.seller.gstin, '33ABCDE1234F1Z5'); assert.equal(res.body.buyer.name, 'Priya');
  res = fakeRes(); await customer.getInvoice({ params: { orderId: 'EX-TEST' }, user: { _id: 'STRANGER', role: 'user' } }, res); assert.equal(res.statusCode, 403);
  o.paymentStatus = 'pending'; res = fakeRes(); await customer.getInvoice({ params: { orderId: 'EX-TEST' }, user: { _id: 'U1', role: 'user' } }, res); assert.equal(res.statusCode, 400);
  const o2 = mkOrder(); await refund.declineItems(o2, { itemIds: o2.items.map(i => String(i._id)), actorName: 'R' }); ExpressOrder.findOne = async () => o2;
  res = fakeRes(); await customer.getInvoice({ params: { orderId: 'EX-TEST' }, user: { _id: 'U1', role: 'user' } }, res); assert.equal(res.statusCode, 404);
});
test('GI-22 store team member and Express admin may view the invoice', async () => {
  const customer = require('../../src/controllers/expressCustomerController');
  const ExpressStoreManager = require('../../src/models/ExpressStoreManager');
  ExpressStore.findById = () => chain(store()); ExpressProduct.find = () => chain([]); ExpressOrder.findOne = async () => mkOrder();
  ExpressStoreManager.findOne = () => chain({ _id: 'm' });
  let res = fakeRes(); await customer.getInvoice({ params: { orderId: 'EX-TEST' }, user: { _id: 'STAFF', role: 'user' } }, res); assert.equal(res.statusCode, 200);
  ExpressStoreManager.findOne = () => chain(null);
  res = fakeRes(); await customer.getInvoice({ params: { orderId: 'EX-TEST' }, user: { _id: 'A', role: 'admin', permissions: ['express'] } }, res); assert.equal(res.statusCode, 200);
  res = fakeRes(); await customer.getInvoice({ params: { orderId: 'EX-TEST' }, user: { _id: 'A', role: 'admin', permissions: ['orders'] } }, res); assert.equal(res.statusCode, 403);
});

// ── GST profile (owner sets once) ───────────────────────────────────────
const mkStore = (gst = {}) => ({
  name: 'V', address: '12 Main Rd', pincode: '600087',
  gst: { ...gst, toObject() { return { ...gst }; } }, sets: {}, set(k, v) { this.sets[k] = v; }, async save() { return this; },
});
const saveGst = async (st, body, manager = { store: 'S1', name: 'Owner' }) => {
  ExpressStore.findById = async () => st; const res = fakeRes(); await owner.saveGst({ body, manager }, res); return res;
};
test('GS-01 register: valid GSTIN fixes the state from the GSTIN; PAN derived; profile marked complete', async () => {
  const st = mkStore(); const res = await saveGst(st, { registered: true, gstin: '33abcde1234f1z5', legalName: 'Sri Fresh Mart', address: '12 Main Rd, Chennai' });
  assert.equal(res.statusCode, 200); assert.equal(st.sets['gst.gstin'], '33ABCDE1234F1Z5'); assert.equal(st.sets['gst.stateCode'], '33');
  assert.equal(st.sets['gst.pan'], 'ABCDE1234F'); assert.ok(st.sets['gst.completedAt']);
});
test('GS-02 invalid GSTIN rejected', async () => {
  const res = await saveGst(mkStore(), { registered: true, gstin: '33BAD', legalName: 'X', address: 'Y' });
  assert.equal(res.statusCode, 400); assert.match(res.body.message, /GSTIN/);
});
test('GS-03 legal name and address are mandatory', async () => {
  let res = await saveGst(mkStore(), { registered: false, address: 'Y' }); assert.equal(res.statusCode, 400);
  const bare = mkStore(); bare.address = ''; bare.pincode = '';
  res = await saveGst(bare, { registered: false, legalName: 'X' }); assert.equal(res.statusCode, 400);
});
test('GS-04 not registered: GSTIN cleared, state from pincode, accepted (Bill of Supply profile)', async () => {
  const st = mkStore(); const res = await saveGst(st, { registered: false, legalName: 'Home Kitchen', address: 'Anna Nagar', pincode: '600040', gstin: '33ABCDE1234F1Z5' });
  assert.equal(res.statusCode, 200); assert.equal(st.sets['gst.gstin'], null); assert.equal(st.sets['gst.stateCode'], '33');
});
test('GS-05 rates must be 0–28, HSN 4–8 digits, pincode 6 digits, PAN format', async () => {
  const base = { registered: false, legalName: 'X', address: 'Y' };
  for (const extra of [{ defaultGstRate: 40 }, { deliveryGstRate: -1 }, { hsnDefault: '12' }, { pincode: '60' }, { pan: 'BAD' }]) {
    assert.equal((await saveGst(mkStore(), { ...base, ...extra })).statusCode, 400, JSON.stringify(extra));
  }
});
const lockedStore = () => mkStore({ registered: true, gstin: '33ABCDE1234F1Z5', legalName: 'Sri Fresh Mart', stateCode: '33', lockedAt: new Date() });
test('GS-06 once an invoice is issued the GST identity is LOCKED for the owner', async () => {
  let res = await saveGst(lockedStore(), { legalName: 'Changed Name' }); assert.equal(res.statusCode, 403); assert.match(res.body.message, /locked/);
  assert.equal((await saveGst(lockedStore(), { gstin: '29ABCDE1234F1Z5' })).statusCode, 403);
});
test('GS-07 …but FSSAI, rates and address can still be updated; and super admin can change the identity', async () => {
  assert.equal((await saveGst(lockedStore(), { fssai: '12345678901234', defaultGstRate: 5, address: 'New addr' })).statusCode, 200);
  assert.equal((await saveGst(lockedStore(), { legalName: 'Renamed Pvt Ltd' }, { store: 'S1', name: 'Admin', isAdmin: true })).statusCode, 200);
});
test('GS-08 own-product GST validation (owner product form)', async () => {
  ExpressProduct.findOne = () => chain(null); let doc; ExpressProduct.create = async (d) => { doc = d; return d; };
  const mgr = { store: 'S1', name: 'O' };
  let res = fakeRes(); await owner.createOwnProduct({ body: { name: 'Pickle', procurementBaseCost: 10, gstRate: 40 }, manager: mgr, managerRole: 'owner' }, res); assert.equal(res.statusCode, 400);
  res = fakeRes(); await owner.createOwnProduct({ body: { name: 'Pickle', procurementBaseCost: 10, gstRate: 12, hsnCode: '2001' }, manager: mgr, managerRole: 'owner' }, res);
  assert.equal(res.statusCode, 201); assert.equal(doc.gstRate, 12); assert.equal(doc.hsnCode, '2001');
});

// ── accounts are NET of refunds ─────────────────────────────────────────
test('AC-01 owner overview counts online revenue NET of refunds', async () => {
  const agg = []; for (const M of [ExpressOrder, require('../../src/models/ExpressBill')]) M.aggregate = async (p) => { agg.push(JSON.stringify(p)); return [{ t: 0, n: 0 }]; };
  ExpressStoreProduct.countDocuments = async () => 0; require('../../src/models/ExpressOnlineListing').countDocuments = async () => 0;
  const res = fakeRes(); await owner.overview({ manager: { store: 'S1' } }, res);
  assert.ok(agg.some(a => a.includes('refundedAmount')), 'order revenue subtracts pricing.refundedAmount');
});
