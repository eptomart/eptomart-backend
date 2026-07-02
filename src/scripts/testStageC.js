// ============================================
// SMOKE TEST — Stage C (3-stage documents)
// Run: node src/scripts/testStageC.js
// ============================================
'use strict';

const assert = require('assert');
const zlib = require('zlib');
const { Writable } = require('stream');

/**
 * Extract readable text from a PDF buffer: inflates FlateDecode streams,
 * pulls the strings out of Tj/TJ operators, and strips ALL whitespace
 * (pdfkit splits phrases into kerned segments, so contiguous substring
 * matching is only reliable whitespace-insensitively).
 * Match against it with norm('some phrase').
 */
function pdfText(buf) {
  let raw = '';
  let idx = 0;
  while (true) {
    const s = buf.indexOf('stream', idx);
    if (s === -1) break;
    let start = s + 6;
    if (buf[start] === 0x0d) start++;
    if (buf[start] === 0x0a) start++;
    const e = buf.indexOf('endstream', start);
    if (e === -1) break;
    try { raw += zlib.inflateSync(buf.slice(start, e)).toString('latin1'); }
    catch { raw += buf.slice(start, e).toString('latin1'); }
    idx = e + 9;
  }
  // Pull strings out of text-show operators: pdfkit emits hex strings
  // (<48656c6c6f>) inside TJ arrays; also handle literal (…) strings.
  let text = '';
  for (const m of raw.match(/<[0-9a-fA-F]+>/g) || []) {
    const hex = m.slice(1, -1);
    for (let i = 0; i + 1 < hex.length; i += 2) {
      text += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
    }
  }
  for (const p of raw.match(/\((?:\\.|[^\\()])*\)/g) || []) {
    text += p.slice(1, -1).replace(/\\([()\\])/g, '$1');
  }
  return text.replace(/\s+/g, '');
}

/** Whitespace-insensitive needle for pdfText output. */
function norm(s) { return String(s).replace(/\s+/g, ''); }
const { computeDocuments, renderOrderDocument, PROFORMA_DISCLAIMER } = require('../services/orders/documentService');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); failed++; }
}

// Representative Koyambedu DTO with partial decline (5kg tomato → 3kg)
function kbdDto(status) {
  return {
    id: '64b000000000000000000001',
    vertical: 'koyambedu',
    orderId: 'KBDTEST1',
    placedAt: new Date('2026-06-30'),
    status,
    paymentStatus: 'paid',
    paymentMethod: 'razorpay',
    customer: { name: 'Test Buyer' },
    seller: { name: 'Koyambedu Market' },
    address: { fullName: 'Test Buyer', addressLine1: '1 Main St', city: 'Chennai', pincode: '600001', phone: '9000000000' },
    itemsOrdered: [
      { name: 'Tomato', unit: 'kg', quantity: 5, unitPrice: 40, lineTotal: 200 },
      { name: 'Onion',  unit: 'kg', quantity: 2, unitPrice: 30, lineTotal: 60 },
    ],
    itemsDeclined: [
      { name: 'Tomato', unit: 'kg', quantity: 5, unitPrice: 40, lineTotal: 120, declinedQty: 2, refundAmount: 80, reason: 'only 3kg available' },
    ],
    itemsConfirmed: [
      { name: 'Tomato', unit: 'kg', quantity: 3, unitPrice: 40, lineTotal: 120 },
      { name: 'Onion',  unit: 'kg', quantity: 2, unitPrice: 30, lineTotal: 60 },
    ],
    paymentSummary: {
      originalOrderValue: 260, refundAmount: 80, platformFee: 15, packingFee: 10,
      logisticsFee: 0, deliveryCharge: 49, gst: 0, couponDiscount: 0,
      walletAdjustment: 0, finalPaidAmount: 254, currency: 'INR', notes: [],
    },
    refund: { status: 'processed', amount: 80, method: 'wallet' },
    documents: [
      { type: 'proforma', label: 'Proforma Invoice', number: 'PF-KBDTEST1', generatedAt: new Date(), url: '/api/koyambedu/orders/x/invoice?type=proforma', available: true },
    ],
  };
}

// ── Availability rules ───────────────────────
console.log('document availability');
test('placed order: proforma available, confirmation/tax locked', () => {
  const docs = computeDocuments('koyambedu', kbdDto('placed'));
  const byType = Object.fromEntries(docs.map(d => [d.type, d]));
  assert.equal(byType.proforma.available, true);
  assert.equal(byType.confirmation.available, false);
  assert.equal(byType.tax.available, false);
});
test('confirmed order: confirmation unlocked, tax still locked', () => {
  const byType = Object.fromEntries(computeDocuments('koyambedu', kbdDto('confirmed')).map(d => [d.type, d]));
  assert.equal(byType.confirmation.available, true);
  assert.equal(byType.tax.available, false);
  assert.ok(byType.tax.note.includes('delivery'));
});
test('delivered order: all three available', () => {
  const docs = computeDocuments('koyambedu', kbdDto('delivered'));
  assert.equal(docs.filter(d => d.available).length, 3);
});
test('stored number preserved, buggy legacy URL replaced with v2 URL', () => {
  const byType = Object.fromEntries(computeDocuments('koyambedu', kbdDto('delivered')).map(d => [d.type, d]));
  assert.equal(byType.proforma.number, 'PF-KBDTEST1');
  assert.ok(byType.proforma.url.startsWith('/api/v2/orders/koyambedu/'));
  assert.ok(byType.tax.url.includes('/documents/tax'));
});
test('eptomart keeps stored Invoice PDF url for tax', () => {
  const dto = { ...kbdDto('delivered'), vertical: 'eptomart', documents: [
    { type: 'tax', label: 'Tax Invoice', number: 'INV-7', url: '/api/invoices/abc/download', available: true },
  ]};
  const byType = Object.fromEntries(computeDocuments('eptomart', dto).map(d => [d.type, d]));
  assert.equal(byType.tax.url, '/api/invoices/abc/download');
  assert.equal(byType.tax.number, 'INV-7');
});
test('uzhavar: only booking-fee receipt, after delivery', () => {
  const dto = { ...kbdDto('delivered'), vertical: 'uzhavar', documents: [] };
  const docs = computeDocuments('uzhavar', dto);
  assert.equal(docs.length, 1);
  assert.equal(docs[0].type, 'tax');
  assert.ok(docs[0].label.includes('Booking Fee'));
});

// ── PDF rendering ────────────────────────────
console.log('pdf rendering');
function renderToBuffer(type, dto) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const sink = new Writable({
      write(chunk, enc, cb) { chunks.push(chunk); cb(); },
    });
    sink.on('finish', () => resolve(Buffer.concat(chunks)));
    sink.on('error', reject);
    renderOrderDocument(type, dto, sink);
  });
}

(async () => {
  try {
    const proforma = await renderToBuffer('proforma', kbdDto('placed'));
    test('proforma renders valid PDF with disclaimer', () => {
      assert.ok(proforma.slice(0, 5).toString() === '%PDF-', 'not a PDF');
      assert.ok(proforma.length > 1000);
    });

    const confirmation = await renderToBuffer('confirmation', kbdDto('confirmed'));
    test('confirmation renders valid PDF', () =>
      assert.ok(confirmation.slice(0, 5).toString() === '%PDF-' && confirmation.length > 1000));

    const tax = await renderToBuffer('tax', kbdDto('delivered'));
    test('tax invoice renders valid PDF', () =>
      assert.ok(tax.slice(0, 5).toString() === '%PDF-' && tax.length > 1000));

    // Extract text streams naively to assert content rules
    const taxText = pdfText(tax);
    test('tax invoice contains delivered items section, not declined section', () => {
      assert.ok(taxText.includes(norm('Items Delivered')), 'missing Items Delivered');
      assert.ok(!taxText.includes(norm('Items Declined')), 'tax invoice must not contain declined section');
    });
    const confText = pdfText(confirmation);
    test('confirmation contains ordered/declined/confirmed sections + refund note', () => {
      assert.ok(confText.includes(norm('Items Ordered')));
      assert.ok(confText.includes(norm('Items Declined')));
      assert.ok(confText.includes(norm('Items Confirmed')));
      assert.ok(confText.includes(norm('Refund summary')));
    });
    const proText = pdfText(proforma);
    test('proforma includes required disclaimer text', () =>
      assert.ok(proText.includes(norm('Proforma Invoice generated from the customer'))));

    // Uzhavar booking-fee receipt
    const ufDto = {
      ...kbdDto('delivered'), vertical: 'uzhavar', orderId: 'UF001',
      itemsConfirmed: [{ name: 'Bananas', unit: 'dozen', quantity: 2, unitPrice: 60, lineTotal: 120 }],
      itemsDeclined: [],
      paymentSummary: { originalOrderValue: 120, refundAmount: 0, platformFee: 21, packingFee: 0, logisticsFee: 0, deliveryCharge: 0, gst: 3.78, couponDiscount: 0, walletAdjustment: 0, finalPaidAmount: 24.78, notes: [] },
      documents: [],
    };
    const uf = await renderToBuffer('tax', ufDto);
    test('uzhavar receipt: booking fee only, farmer-paid note', () => {
      const t = pdfText(uf);
      assert.ok(t.includes(norm('paid directly to farmer')) || t.includes(norm('paid to the farmer')));
      assert.ok(t.includes(norm('Booking Fee')));
    });

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
  } catch (e) {
    console.error('Render harness error:', e);
    process.exit(1);
  }
})();
