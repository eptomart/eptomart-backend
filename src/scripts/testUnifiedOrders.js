// ============================================
// SMOKE TEST — unified orders adapters & calc
// Run: node src/scripts/testUnifiedOrders.js
// No DB required: tests pure mapping functions
// with representative sample documents.
// ============================================
'use strict';

const assert = require('assert');
const { toCanonical, statusLabel } = require('../services/orders/statusMap');
const { buildPaymentSummary, calculateOrderTotals } = require('../utils/orderCalculationService');
const eptomart  = require('../services/orders/adapters/eptomartAdapter');
const koyambedu = require('../services/orders/adapters/koyambeduAdapter');
const eptofresh = require('../services/orders/adapters/eptofreshAdapter');
const uzhavar   = require('../services/orders/adapters/uzhavarAdapter');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); failed++; }
}

// ── Status mapping ───────────────────────────
console.log('statusMap');
test('koyambedu sa_review_submitted → changes_pending_approval', () =>
  assert.equal(toCanonical('koyambedu', 'sa_review_submitted'), 'changes_pending_approval'));
test('eptofresh picked_up → out_for_delivery', () =>
  assert.equal(toCanonical('eptofresh', 'picked_up'), 'out_for_delivery'));
test('uzhavar auto_cancelled → cancelled + label override', () => {
  assert.equal(toCanonical('uzhavar', 'auto_cancelled'), 'cancelled');
  assert.equal(statusLabel('uzhavar', 'auto_cancelled'), 'Cancelled (Not Confirmed in Time)');
});
test('unknown status passes through without throwing', () =>
  assert.equal(toCanonical('eptomart', 'weird_legacy_status'), 'weird_legacy_status'));

// ── Koyambedu: partial decline scenario (5kg tomato, 3 available) ──
console.log('koyambedu adapter — partial decline');
const kbdOrder = {
  _id: '64b000000000000000000001',
  orderId: 'KBDTEST1',
  orderStatus: 'confirmed',
  paymentStatus: 'paid',
  paymentMethod: 'razorpay',
  createdAt: new Date('2026-06-30'),
  placedAt:  new Date('2026-06-30'),
  deliveryDate: new Date('2026-07-01'),
  deliverySlot: '09:00 AM – 11:59 AM',
  shippingAddress: { fullName: 'Test Buyer', phone: '9000000000', city: 'Chennai' },
  itemsOrdered: [
    { name: 'Tomato', unit: 'kg', orderedQty: 5, unitPrice: 40, lineTotal: 200 },
    { name: 'Onion',  unit: 'kg', orderedQty: 2, unitPrice: 30, lineTotal: 60 },
  ],
  items: [
    { name: 'Tomato', unit: 'kg', orderedQty: 5, confirmedQty: 3, declinedQty: 2,
      orderedPrice: 40, itemStatus: 'partial', declinedReason: 'only 3kg available' },
    { name: 'Onion', unit: 'kg', orderedQty: 2, confirmedQty: 2, declinedQty: 0,
      orderedPrice: 30, itemStatus: 'confirmed' },
  ],
  pricing: { subtotal: 260, deliveryCharge: 49, platformFee: 15, packingLogisticsFee: 10, discount: 0, total: 334 },
  saReview: { pendingRefundAmount: 80, refundMethod: 'wallet' },
  adminApproval: { status: 'approved', approvedAt: new Date('2026-06-30T12:00:00Z') },
  invoices: { proforma: { number: 'PF-KBDTEST1', isAvailable: true, generatedAt: new Date() },
              confirmation: { number: 'CONF-KBDTEST1', isAvailable: true, generatedAt: new Date() },
              tax: { isAvailable: false } },
  timeline: [
    { event: 'order_placed', timestamp: new Date('2026-06-30T08:00:00Z'), actor: { role: 'customer' } },
    { event: 'qty_reduced', description: 'Tomato 5→3', timestamp: new Date('2026-06-30T10:00:00Z'), actor: { role: 'seller_admin' } },
    { event: 'admin_approved', timestamp: new Date('2026-06-30T12:00:00Z'), actor: { role: 'super_admin' } },
  ],
};

const kbdDetail = koyambedu.toDetail(kbdOrder, { walletHistory: [] });

test('original order never changes: itemsOrdered shows 5kg tomato', () => {
  const t = kbdDetail.itemsOrdered.find(i => i.name === 'Tomato');
  assert.equal(t.quantity, 5);
  assert.equal(t.lineTotal, 200);
});
test('declined section: 2kg tomato, ₹80 refund, reason preserved', () => {
  assert.equal(kbdDetail.itemsDeclined.length, 1);
  const d = kbdDetail.itemsDeclined[0];
  assert.equal(d.declinedQty, 2);
  assert.equal(d.refundAmount, 80);
  assert.equal(d.reason, 'only 3kg available');
});
test('confirmed section: 3kg tomato + 2kg onion only', () => {
  assert.equal(kbdDetail.itemsConfirmed.length, 2);
  assert.equal(kbdDetail.itemsConfirmed.find(i => i.name === 'Tomato').quantity, 3);
});
test('payment summary from central calc service', () => {
  const s = kbdDetail.paymentSummary;
  assert.equal(s.originalOrderValue, 260);
  assert.equal(s.refundAmount, 80);
  // confirmed 3*40 + 2*30 = 180; + fees 15 + 10 + 49 = 254
  assert.equal(s.finalPaidAmount, 254);
});
test('documents only include available ones (no tax invoice yet)', () => {
  assert.deepEqual(kbdDetail.documents.map(d => d.type).sort(), ['confirmation', 'proforma']);
});
test('refund block derived from SA review when order.refund absent', () => {
  assert.equal(kbdDetail.refund.amount, 80);
  assert.equal(kbdDetail.refund.method, 'wallet');
  assert.equal(kbdDetail.refund.status, 'processed');
});
test('card shows canonical status + declined flag', () => {
  const card = koyambedu.toCard(kbdOrder);
  assert.equal(card.status, 'confirmed');
  assert.equal(card.hasDeclinedItems, true);
});

// ── COD deduction rule ───────────────────────
console.log('calculation service — COD');
test('COD: declined amount deducted from final payable', () => {
  const codOrder = { ...kbdOrder, paymentMethod: 'cod' };
  const calc = calculateOrderTotals(codOrder);
  assert.equal(calc.finalPayableAmount, 254); // same math; deduction happens by charging confirmed only
  const s = buildPaymentSummary('koyambedu', codOrder);
  assert.ok(s.notes[0].includes('Cash on Delivery'));
});

// ── Eptomart adapter ─────────────────────────
console.log('eptomart adapter');
const eptOrder = {
  _id: '64b000000000000000000002',
  orderId: 'EPT12345678',
  orderStatus: 'shipped',
  paymentStatus: 'paid',
  paymentMethod: 'razorpay',
  createdAt: new Date('2026-06-28'),
  items: [{ name: 'Ghee 1L', price: 650, quantity: 2, itemStatus: 'shipped' }],
  pricing: { subtotal: 1300, shipping: 0, tax: 0, total: 1300 },
  gstBreakdown: { subtotalExGst: 1238.1, gstTotal: 61.9, cgstTotal: 30.95, sgstTotal: 30.95, gstType: 'intra' },
  shippingAddress: { fullName: 'A', phone: '9', addressLine1: 'x', city: 'Chennai', state: 'TN', pincode: '600001' },
  statusHistory: [
    { status: 'placed', timestamp: new Date('2026-06-28') },
    { status: 'shipped', timestamp: new Date('2026-06-29') },
  ],
  shiprocket: { awb: 'AWB123', courier: 'Delhivery', trackingUrl: 'https://track/x' },
  invoice: { _id: '64b00000000000000000000f', invoiceNumber: 'INV-1', generatedAt: new Date() },
};
test('shipped → out_for_delivery, tracking exposed', () => {
  const d = eptomart.toDetail(eptOrder);
  assert.equal(d.status, 'out_for_delivery');
  assert.equal(d.delivery.trackingId, 'AWB123');
  assert.equal(d.paymentSummary.finalPaidAmount, 1300);
  assert.equal(d.paymentSummary.gst, 61.9);
  assert.equal(d.documents[0].available, true);
});
test('COD invoice gated until delivery', () => {
  const d = eptomart.toDetail({ ...eptOrder, paymentMethod: 'cod' });
  assert.equal(d.documents[0].available, false);
});

// ── EptoFresh Proteins adapter ────────────────────────
console.log('eptofresh (EptoFresh Proteins) adapter');
const epfOrder = {
  _id: '64b000000000000000000003',
  orderId: 'EPFTEST1',
  orderStatus: 'rejected',
  paymentStatus: 'paid',
  paymentMethod: 'razorpay',
  createdAt: new Date(),
  seller: { shopName: 'Fresh Meats' },
  items: [{ productName: 'Chicken Curry Cut', quantity: 2, unitPrice: 180, totalPrice: 360, variant: { label: '500g' }, cutType: 'curry cut' }],
  pricing: { subtotal: 360, deliveryCharge: 40, deliveryDiscount: 0, walletApplied: 0, couponDiscount: 0, total: 400 },
  sellerAction: { accepted: false, rejectReason: 'Out of stock' },
  refund: { status: 'initiated', amount: 400, initiatedAt: new Date() },
  statusHistory: [{ status: 'placed', timestamp: new Date() }, { status: 'rejected', timestamp: new Date() }],
};
test('rejected order → all items declined with reason, none confirmed', () => {
  const d = eptofresh.toDetail(epfOrder, { walletHistory: [] });
  assert.equal(d.status, 'cancelled');
  assert.equal(d.itemsDeclined.length, 1);
  assert.equal(d.itemsDeclined[0].reason, 'Out of stock');
  assert.equal(d.itemsConfirmed.length, 0);
  assert.equal(d.refund.amount, 400);
});

// ── Farmer Fresh adapter ─────────────────────
console.log('uzhavar (Farmer Fresh) adapter');
const ufOrder = {
  _id: '64b000000000000000000004',
  orderNumber: 'UF123456001',
  status: 'farmer_accepted',
  paymentStatus: 'paid',
  paymentMethod: 'razorpay',
  createdAt: new Date(),
  farmer: { name: 'Murugan' },
  items: [{ name: 'Bananas', unit: 'dozen', quantity: 2, pricePerUnit: 60, lineTotal: 120 }],
  subtotal: 120,
  bookingFee: { base: 21, gst: 3.78, total: 24.78 },
  grandTotal: 144.78,
  balancePayableToFarmer: 120,
  farmerAcceptedAt: new Date(),
  deliveryAddress: { name: 'B', phone: '9' },
};
test('booking-fee model: online paid = fee only, farmer paid on delivery', () => {
  const d = uzhavar.toDetail(ufOrder);
  assert.equal(d.paymentSummary.finalPaidAmount, 24.78);
  assert.equal(d.paymentSummary.gst, 3.78);
  assert.ok(d.paymentSummary.notes[0].includes('120'));
  assert.equal(d.payFarmerOnDelivery, 120);
  assert.equal(d.statusLabel, 'Farmer Accepted — Confirm Now');
});

// ── Legacy order safety ──────────────────────
console.log('legacy safety');
test('koyambedu legacy order (no itemsOrdered/timeline) still maps', () => {
  const legacy = {
    _id: '64b000000000000000000005', orderId: 'KBDLEGACY', orderStatus: 'delivered',
    paymentStatus: 'paid', paymentMethod: 'cod', createdAt: new Date('2026-01-01'),
    items: [{ name: 'Carrot', unit: 'kg', quantity: 3, finalPrice: 50 }],
    pricing: { subtotal: 150, deliveryCharge: 49, platformFee: 15, total: 214 },
    deliveredAt: new Date('2026-01-02'),
  };
  const d = koyambedu.toDetail(legacy, { walletHistory: [] });
  assert.equal(d.itemsOrdered[0].quantity, 3);
  assert.equal(d.itemsDeclined.length, 0);
  assert.ok(d.timeline.length >= 2); // synthesized placed + delivered
  assert.equal(d.paymentSummary.finalPaidAmount, 214);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
