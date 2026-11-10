// ============================================
// Express — GST invoice issued on behalf of the STORE
// • Seller = the store's GST profile (legal name, GSTIN, address, FSSAI)
// • Prices are GST-inclusive; tax is backed out per line
// • CGST+SGST when store and delivery state match, else IGST
// • Delivery charge is the store's service (SAC 9965); the Eptomart platform
//   fee is NOT the store's supply, so it is shown separately
// • Before delivery it is a PROFORMA (can change if items are declined);
//   at delivery it is frozen as the FINAL invoice with a running number
// • Unregistered store (or all lines 0 %) → "Bill of Supply"
// ============================================
const ExpressStore = require('../models/ExpressStore');
const ExpressProduct = require('../models/ExpressProduct');

const r2 = (n) => Math.round(((Number(n) || 0) + Number.EPSILON) * 100) / 100;
const UQC = { kg: 'KGS', gram: 'GMS', piece: 'PCS', bunch: 'BND', litre: 'LTR', dozen: 'DOZ' };

// First two digits of an Indian PIN → GST state code (good enough for intra/inter-state)
const PIN_STATE = [
  ['11', '07'], ['12', '06'], ['13', '06'], ['14', '03'], ['15', '03'], ['16', '04'], ['17', '02'], ['18', '01'], ['19', '01'],
  ['20', '09'], ['21', '09'], ['22', '09'], ['23', '09'], ['24', '05'], ['25', '09'], ['26', '09'], ['27', '09'], ['28', '09'],
  ['30', '08'], ['31', '08'], ['32', '08'], ['33', '08'], ['34', '08'], ['36', '24'], ['37', '24'], ['38', '24'], ['39', '24'],
  ['40', '27'], ['41', '27'], ['42', '27'], ['43', '27'], ['44', '27'], ['45', '23'], ['46', '23'], ['47', '23'], ['48', '23'], ['49', '22'],
  ['50', '36'], ['51', '37'], ['52', '37'], ['53', '37'], ['56', '29'], ['57', '29'], ['58', '29'], ['59', '29'],
  ['60', '33'], ['61', '33'], ['62', '33'], ['63', '33'], ['64', '33'], ['67', '32'], ['68', '32'], ['69', '32'],
  ['70', '19'], ['71', '19'], ['72', '19'], ['73', '19'], ['74', '19'], ['75', '21'], ['76', '21'], ['77', '21'], ['78', '18'], ['79', '18'], ['80', '10'], ['81', '10'], ['82', '20'], ['83', '20'], ['84', '10'], ['85', '10'],
];
const stateFromPin = (pin) => { const p = String(pin || '').slice(0, 2); const m = PIN_STATE.find(([k]) => k === p); return m ? m[1] : null; };
const GSTIN_RE = /^(0[1-9]|[1-2]\d|3[0-8]|97|99)[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

function fyOf(d = new Date()) { const y = d.getFullYear(); const a = d.getMonth() >= 3 ? y : y - 1; return `${String(a).slice(2)}${String(a + 1).slice(2)}`; }

function sellerBlock(store) {
  const g = store.gst || {};
  const registered = !!(g.registered && g.gstin);
  return {
    registered,
    name: g.legalName || g.tradeName || store.name,
    brand: g.tradeName || store.name,
    gstin: registered ? g.gstin : null,
    pan: g.pan || (registered ? g.gstin.slice(2, 12) : null),
    fssai: g.fssai || null,
    address: g.address || store.address || '',
    pincode: g.pincode || store.pincode || '',
    stateCode: g.stateCode || (registered ? g.gstin.slice(0, 2) : null) || stateFromPin(g.pincode || store.pincode) || '33',
    profileComplete: !!(g.legalName && (g.address || store.address)),
  };
}

/** Pure: build invoice content from an order + store + product GST map. */
function buildInvoice(order, store, productMap = {}) {
  const items = order.items || [];
  const active = items.filter((i) => i.status !== 'declined');
  if (!active.length) return null; // everything declined → no supply, no invoice
  const seller = sellerBlock(store);
  const g = store.gst || {};
  const buyerState = stateFromPin(order.deliveryAddress?.pincode) || seller.stateCode;
  const inter = seller.stateCode !== buyerState;
  const p = order.pricing || {};
  const originalSub = items.reduce((a, i) => a + (i.lineTotal || 0), 0) || 1;
  const coupon = p.couponDiscount || 0;

  let anyTax = false;
  const mk = (description, gross, qty, uqc, hsn, rate) => {
    const taxable = r2(gross / (1 + rate / 100));
    const tax = r2(gross - taxable);
    let cgst = 0, sgst = 0, igst = 0;
    if (rate > 0) { anyTax = true; if (inter) igst = tax; else { cgst = r2(tax / 2); sgst = r2(tax - cgst); } }
    return { description, hsn, qty, uqc, rate, taxable, cgst, sgst, igst, total: r2(gross) };
  };
  const lines = active.map((it) => {
    const prod = productMap[String(it.product)] || {};
    const gross = (it.lineTotal || 0) - (coupon * (it.lineTotal || 0)) / originalSub;
    const rate = seller.registered ? (prod.gstRate != null ? Number(prod.gstRate) : Number(g.defaultGstRate) || 0) : 0;
    return mk(it.name, gross, it.quantity, UQC[it.unit] || 'NOS', prod.hsnCode || g.hsnDefault || '0709', rate);
  });
  if ((p.deliveryFee || 0) > 0) {
    lines.push(mk('Delivery charges', p.deliveryFee, 1, 'NOS', '9965', seller.registered ? (Number(g.deliveryGstRate) || 0) : 0));
  }
  const totals = lines.reduce((t, l) => ({ taxable: r2(t.taxable + l.taxable), cgst: r2(t.cgst + l.cgst), sgst: r2(t.sgst + l.sgst), igst: r2(t.igst + l.igst), total: r2(t.total + l.total) }), { taxable: 0, cgst: 0, sgst: 0, igst: 0, total: 0 });
  totals.roundOff = r2(Math.round(totals.total) - totals.total);
  totals.grand = Math.round(totals.total);

  const declined = items.filter((i) => i.status === 'declined').map((i) => ({ name: i.name, quantity: i.quantity, unit: i.unit, amount: i.lineTotal, refund: i.refundAmount, reason: i.declineReason }));
  const platformFee = r2(p.platformFee || 0);
  const walletPaid = r2(p.walletApplied || 0);
  const refunded = r2(p.refundedAmount || 0);
  const netPaid = r2((p.total || 0) - refunded);

  return {
    type: anyTax ? 'tax_invoice' : 'bill_of_supply',
    seller, placeOfSupply: buyerState, interState: inter,
    lines, totals, declined,
    platform: platformFee > 0 ? { description: 'Platform service fee (Eptomart Express — billed separately by Eptomart)', amount: platformFee } : null,
    payable: r2(totals.grand + platformFee),
    payment: { total: r2(p.total), walletPaid, cardPaid: r2((p.total || 0) - walletPaid), refunded, netPaid, method: order.paymentMethod },
    refunds: (order.refunds || []).map((r) => ({ amount: r.amount, mode: r.mode, status: r.status, at: r.at, fallbackToWallet: r.fallbackToWallet })),
  };
}

async function nextNumber(storeId) {
  const s = await ExpressStore.findByIdAndUpdate(storeId, { $inc: { 'gst.invoiceCounter': 1 } }, { new: true }).lean();
  const prefix = (s.gst?.invoicePrefix || s.code || 'EXP').toString().replace(/[^A-Z0-9]/gi, '').slice(0, 6).toUpperCase() || 'EXP';
  return `${prefix}/${fyOf()}/${String(s.gst.invoiceCounter).padStart(5, '0')}`;
}

/**
 * The invoice the customer sees. Proforma until delivery; at delivery it is
 * numbered, stored and frozen (and the store's GST profile is locked).
 */
async function getOrIssueInvoice(order) {
  if (order.taxInvoice?.isFinal) return order.taxInvoice;
  const store = await ExpressStore.findById(order.store).lean();
  if (!store) return null;
  const products = await ExpressProduct.find({ _id: { $in: (order.items || []).map((i) => i.product) } }).select('gstRate hsnCode').lean();
  const pmap = Object.fromEntries(products.map((x) => [String(x._id), x]));
  const inv = buildInvoice(order, store, pmap);
  if (!inv) return null;
  inv.orderId = order.orderId; inv.placedAt = order.createdAt;
  if (order.orderStatus !== 'delivered') return { ...inv, isFinal: false, number: null, label: 'PROFORMA — final tax invoice is issued on delivery' };

  inv.isFinal = true; inv.number = await nextNumber(order.store); inv.issuedAt = new Date();
  await ExpressStore.updateOne({ _id: order.store, 'gst.lockedAt': null }, { $set: { 'gst.lockedAt': new Date() } });
  order.taxInvoice = inv;
  order.markModified('taxInvoice');
  await order.save();
  return inv;
}

module.exports = { buildInvoice, getOrIssueInvoice, sellerBlock, stateFromPin, GSTIN_RE, r2 };
