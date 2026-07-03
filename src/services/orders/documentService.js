// ============================================
// UNIFIED ORDER DOCUMENT SERVICE (Stage C)
//
// One renderer for the 3-stage invoice workflow,
// for every vertical, driven by the canonical
// OrderDTO — the same data the v2 API serves.
//
//   Stage 1  proforma      — at order placement
//   Stage 2  confirmation  — after Super Admin approval
//   Stage 3  tax           — after successful delivery
//                            (delivered items ONLY — declined
//                             items never appear as sold)
// ============================================
'use strict';

const PDFDocument = require('pdfkit');
const { getVertical } = require('../../config/verticals');

const BUSINESS = {
  name:    'Eptomart',
  address: 'No.2, 3rd St, Janaki Nagar, Karthikeyan Nagar, Maduravoyal, Chennai, Tamil Nadu – 600095',
  phone:   '+91 6369 129 995',
  email:   'support@eptomart.com',
  website: 'www.eptomart.com',
};

const PROFORMA_DISCLAIMER =
  "This is a Proforma Invoice generated from the customer's order request. " +
  'Final Tax Invoice will be generated after successful delivery.';

// Canonical statuses at/after Super Admin approval
// ('closed' comes after delivery — documents must stay available)
const CONFIRMED_OR_LATER = ['confirmed', 'packing', 'packed', 'out_for_delivery', 'delivered', 'reported', 'closed'];

// ══════════════════════════════════════════════════════════════════
// DOCUMENT AVAILABILITY — single source of truth
// ══════════════════════════════════════════════════════════════════

/**
 * Compute the documents[] list for a canonical order DTO.
 * Merges adapter-supplied metadata (stored numbers / external PDFs)
 * with availability rules + v2 render URLs.
 */
function computeDocuments(verticalKey, dto) {
  const vertical = getVertical(verticalKey);
  if (!vertical) return dto.documents || [];
  const stages = vertical.features.invoiceStages || [];
  const adapterDocs = new Map((dto.documents || []).map(d => [d.type, d]));
  const out = [];

  for (const type of stages) {
    const prev = adapterDocs.get(type) || {};
    let available = false;
    let note = null;
    let label = { proforma: 'Proforma Invoice', confirmation: 'Order Confirmation', tax: 'Final Tax Invoice' }[type];

    if (type === 'proforma') {
      available = dto.status !== 'payment_pending';
    } else if (type === 'confirmation') {
      available = CONFIRMED_OR_LATER.includes(dto.status);
      if (!available) note = 'Available after order is confirmed';
    } else if (type === 'tax') {
      // Tax invoice exists from delivery onwards — closing the order
      // afterwards must never revoke access to it.
      available = ['delivered', 'reported', 'closed'].includes(dto.status);
      if (!available) note = 'Available after delivery';
      if (verticalKey === 'uzhavar') label = 'Booking Fee Receipt (Tax Invoice)';
    }

    // Keep externally stored PDFs (parent-app Invoice model, uzhavar cloud URL)
    const keepAdapterUrl = prev.url && (
      (verticalKey === 'eptomart' && type === 'tax') || /^https?:\/\//.test(prev.url)
    );
    // Parent-app COD rule: tax invoice only after delivery (already in status rule)

    out.push({
      type,
      label,
      number:      prev.number || defaultNumber(type, dto.orderId),
      generatedAt: prev.generatedAt || null,
      url:         keepAdapterUrl ? prev.url : `/api/v2/orders/${verticalKey}/${dto.id}/documents/${type}`,
      available,
      note:        available ? null : note,
    });
  }

  // Preserve adapter docs of types outside the stage list (safety)
  for (const [type, d] of adapterDocs) {
    if (!stages.includes(type)) out.push(d);
  }

  return out;
}

function defaultNumber(type, orderId) {
  const prefix = { proforma: 'PF', confirmation: 'CONF', tax: 'INV' }[type] || 'DOC';
  return `${prefix}-${orderId}`;
}

// ══════════════════════════════════════════════════════════════════
// PDF RENDERER
// ══════════════════════════════════════════════════════════════════

const TITLES = {
  proforma:     'PROFORMA INVOICE',
  confirmation: 'ORDER CONFIRMATION',
  tax:          'TAX INVOICE',
};

/**
 * Render a document as PDF into a writable stream (e.g. Express res).
 * @param {String} type - proforma | confirmation | tax
 * @param {Object} dto  - canonical order detail DTO
 * @param {Stream} stream
 */
function renderOrderDocument(type, dto, stream) {
  const vertical = getVertical(dto.vertical) || {};
  const docMeta  = (dto.documents || []).find(d => d.type === type) || {};
  const number   = docMeta.number || defaultNumber(type, dto.orderId);
  const color    = '#065f46';

  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  doc.pipe(stream);

  // ── Header ──────────────────────────────────
  doc.fontSize(20).font('Helvetica-Bold').fillColor(color).text(BUSINESS.name.toUpperCase(), 50, 50);
  doc.fontSize(10).font('Helvetica').fillColor('#6b7280').text(vertical.name || '', 50, 75);
  doc.fontSize(15).font('Helvetica-Bold').fillColor('#111827').text(TITLES[type] || type.toUpperCase(), 300, 50, { width: 245, align: 'right' });
  doc.fontSize(9).font('Helvetica').fillColor('#6b7280')
    .text(`No: ${number}`, 300, 72, { width: 245, align: 'right' })
    .text(`Date: ${fmtDate(new Date())}`, 300, 85, { width: 245, align: 'right' })
    .text(`Order: #${dto.orderId} · ${fmtDate(dto.placedAt)}`, 300, 98, { width: 245, align: 'right' });

  doc.moveTo(50, 118).lineTo(545, 118).strokeColor('#e5e7eb').lineWidth(1).stroke();

  // ── Parties ─────────────────────────────────
  // Lines can wrap (long addresses) — advance by the REAL rendered
  // height of each line, never a fixed step, so nothing overlaps.
  const writeLines = (lines, x, startY, width, align) => {
    let yy = startY;
    doc.fontSize(9).font('Helvetica').fillColor('#374151');
    for (const l of lines.filter(Boolean)) {
      const h = doc.heightOfString(String(l), { width });
      doc.text(String(l), x, yy, { width, align });
      yy += h + 3;
    }
    return yy;
  };

  let y = 130;
  doc.fontSize(9).font('Helvetica-Bold').fillColor('#374151').text('BILL TO', 50, y);
  const addr = dto.address || {};
  const yLeft = writeLines([
    dto.customer?.name || addr.fullName || addr.name || '-',
    [addr.addressLine1 || addr.addressLine, addr.addressLine2].filter(Boolean).join(', '),
    [addr.city, addr.state, addr.pincode].filter(Boolean).join(', '),
    addr.phone ? `Phone: ${addr.phone}` : null,
  ], 50, y + 14, 235);

  doc.fontSize(9).font('Helvetica-Bold').fillColor('#374151').text('SELLER', 305, y, { width: 240, align: 'right' });
  const yRight = writeLines([
    dto.seller?.name || BUSINESS.name,
    BUSINESS.address,
    BUSINESS.phone,
    BUSINESS.email,
  ], 305, y + 14, 240, 'right');

  y = Math.max(yLeft, yRight) + 14;

  // ── Body per document type ──────────────────
  if (type === 'proforma') {
    y = itemsTable(doc, y, 'Items Ordered', dto.itemsOrdered, color);
    y = totalsBlock(doc, y, proformaTotals(dto), color, 'Estimated Total');
    y = noteBlock(doc, y, PROFORMA_DISCLAIMER);
  }

  if (type === 'confirmation') {
    y = itemsTable(doc, y, 'Items Ordered (original request)', dto.itemsOrdered, color);
    if (dto.itemsDeclined?.length) {
      y = declinedTable(doc, y, dto.itemsDeclined);
    }
    y = itemsTable(doc, y, 'Items Confirmed (deliverable)', dto.itemsConfirmed, color);
    y = totalsBlock(doc, y, confirmationTotals(dto), color, 'Final Payable Amount',
      dto.paymentSummary?.finalPaidAmount);
    if (dto.refund?.amount > 0 || dto.paymentSummary?.refundAmount > 0) {
      const amt    = dto.refund?.amount || dto.paymentSummary.refundAmount;
      const method = dto.refund?.method ? ` via ${String(dto.refund.method).replace(/_/g, ' ')}` : '';
      y = noteBlock(doc, y, `Refund summary: ₹${amt.toFixed(2)}${method}. ` +
        (dto.paymentMethod === 'cod'
          ? 'The declined amount is deducted from your Cash-on-Delivery payable.'
          : 'The declined amount is refunded to your wallet / original payment method.'));
    }
  }

  if (type === 'tax') {
    // Delivered items ONLY — declined items must never appear as sold.
    const delivered = dto.itemsConfirmed?.length ? dto.itemsConfirmed : dto.itemsOrdered;
    if (dto.vertical === 'uzhavar') {
      y = itemsTable(doc, y, 'Produce Delivered (paid directly to farmer)', delivered, color);
      y = noteBlock(doc, y, 'Produce is paid to the farmer at delivery and is not part of this invoice. ' +
        'This receipt covers the Eptomart booking fee only.');
      y = totalsBlock(doc, y, [
        ['Booking Fee', dto.paymentSummary.platformFee],
        ['GST (18%)', dto.paymentSummary.gst],
      ], color, 'Grand Total', dto.paymentSummary.finalPaidAmount);
    } else {
      y = itemsTable(doc, y, 'Items Delivered', delivered, color);
      y = totalsBlock(doc, y, taxTotals(dto), color, 'Grand Total');
    }
    y = noteBlock(doc, y,
      `Payment Method: ${String(dto.paymentMethod || '-').toUpperCase()} · Payment Status: ${dto.paymentStatus || '-'}.` +
      (dto.paymentSummary?.gst > 0 ? '' : ' GST: 0% (exempt category).'));
  }

  // ── Footer ──────────────────────────────────
  doc.fontSize(8).font('Helvetica').fillColor('#9ca3af')
    .text(`Thank you for shopping with ${BUSINESS.name} — ${vertical.name || ''}`, 50, 760, { align: 'center', width: 495 })
    .text('This is a computer-generated document and does not require a signature.', 50, 772, { align: 'center', width: 495 });

  doc.end();
  return doc;
}

// ── Layout helpers ────────────────────────────

function fmtDate(d) {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function money(n) { return `Rs ${(Number(n) || 0).toFixed(2)}`; }

function ensureSpace(doc, y, needed = 60) {
  if (y > 700 - needed) { doc.addPage(); return 50; }
  return y;
}

function itemsTable(doc, y, title, items = [], color) {
  y = ensureSpace(doc, y, 80);
  doc.fontSize(10).font('Helvetica-Bold').fillColor('#111827').text(title, 50, y);
  y += 16;
  // NOTE: rect().fill(color) changes the current fill color — the white
  // header text color must be set AFTER filling the bar, not before.
  doc.rect(50, y, 495, 18).fill(color);
  doc.fontSize(8).font('Helvetica-Bold').fillColor('#ffffff');
  doc.text('Item', 55, y + 5, { width: 235 });
  doc.text('Qty', 300, y + 5);
  doc.text('Unit Price', 370, y + 5);
  doc.text('Amount', 470, y + 5);
  y += 18;

  items.forEach((it, idx) => {
    y = ensureSpace(doc, y, 20);
    doc.rect(50, y, 495, 16).fill(idx % 2 === 0 ? '#f9fafb' : '#ffffff');
    doc.fontSize(8).font('Helvetica').fillColor('#111827');
    doc.text(`${it.name}${it.variantLabel ? ` (${it.variantLabel})` : ''}`, 55, y + 4, { width: 235, ellipsis: true });
    doc.text(`${it.quantity}${it.unit ? ` ${it.unit}` : ''}`, 300, y + 4);
    doc.text(money(it.unitPrice), 370, y + 4);
    doc.text(money(it.lineTotal), 470, y + 4);
    y += 16;
  });
  if (!items.length) {
    doc.fontSize(8).font('Helvetica').fillColor('#9ca3af').text('— none —', 55, y + 4);
    y += 16;
  }
  return y + 12;
}

function declinedTable(doc, y, items = []) {
  y = ensureSpace(doc, y, 80);
  doc.fontSize(10).font('Helvetica-Bold').fillColor('#b45309').text('Items Declined / Quantity Reduced', 50, y);
  y += 16;
  doc.rect(50, y, 495, 18).fill('#b45309');
  doc.fontSize(8).font('Helvetica-Bold').fillColor('#ffffff');
  doc.text('Item', 55, y + 5, { width: 175 });
  doc.text('Declined Qty', 240, y + 5);
  doc.text('Unit Price', 320, y + 5);
  doc.text('Refund', 400, y + 5);
  doc.text('Reason', 460, y + 5);
  y += 18;

  items.forEach((it, idx) => {
    y = ensureSpace(doc, y, 20);
    doc.rect(50, y, 495, 16).fill(idx % 2 === 0 ? '#fffbeb' : '#ffffff');
    doc.fontSize(8).font('Helvetica').fillColor('#111827');
    doc.text(it.name, 55, y + 4, { width: 175, ellipsis: true });
    doc.text(`${it.declinedQty}${it.unit ? ` ${it.unit}` : ''}`, 240, y + 4);
    doc.text(money(it.unitPrice), 320, y + 4);
    doc.text(money(it.refundAmount), 400, y + 4);
    doc.text(String(it.reason || '-'), 460, y + 4, { width: 82, ellipsis: true });
    y += 16;
  });
  return y + 12;
}

function totalsBlock(doc, y, rows, color, totalLabel, totalOverride) {
  y = ensureSpace(doc, y, rows.length * 14 + 40);
  const clean = rows.filter(r => r && r[1] != null && r[1] !== 0);
  clean.forEach(([label, val, negative]) => {
    doc.fontSize(9).font('Helvetica').fillColor('#374151')
      .text(label, 330, y, { width: 120 })
      .text(`${negative ? '- ' : ''}${money(Math.abs(val))}`, 455, y, { width: 90, align: 'right' });
    y += 14;
  });
  const total = totalOverride != null
    ? totalOverride
    : clean.reduce((s, [, v, neg]) => s + (neg ? -v : v), 0);
  y += 4;
  doc.moveTo(330, y).lineTo(545, y).strokeColor('#e5e7eb').lineWidth(0.5).stroke();
  y += 6;
  doc.fontSize(11).font('Helvetica-Bold').fillColor(color)
    .text(totalLabel, 330, y, { width: 120 })
    .text(money(total), 435, y, { width: 110, align: 'right' });
  return y + 26;
}

function noteBlock(doc, y, text) {
  y = ensureSpace(doc, y, 40);
  doc.fontSize(8).font('Helvetica-Oblique').fillColor('#92400e')
    .text(text, 50, y, { width: 495 });
  return doc.y + 14;
}

// ── Totals derivations (from central paymentSummary) ──

function proformaTotals(dto) {
  const s = dto.paymentSummary || {};
  return [
    ['Order Value', s.originalOrderValue],
    ['Platform Fee', s.platformFee],
    ['Packing & Logistics', s.packingFee],
    ['Delivery Charge (est.)', s.deliveryCharge],
    ['GST (est.)', s.gst],
    ['Coupon Discount', s.couponDiscount, true],
  ];
}

function confirmationTotals(dto) {
  // Informational rows — the Final Payable Amount comes from the
  // central calculation service (totalOverride), never re-derived here.
  const s = dto.paymentSummary || {};
  const confirmedTotal = (dto.itemsConfirmed || []).reduce((t, it) => t + (it.lineTotal || 0), 0);
  return [
    ['Original Order Value', s.originalOrderValue],
    ['Refund (declined items)', s.refundAmount, true],
    ['Confirmed Items Total', confirmedTotal],
    ['Platform Fee', s.platformFee],
    ['Packing & Logistics', s.packingFee],
    ['Delivery Charge', s.deliveryCharge],
    ['GST', s.gst],
    ['Coupon Discount', s.couponDiscount, true],
    ['Wallet Adjustment', s.walletAdjustment, true],
  ];
}

function taxTotals(dto) {
  const s = dto.paymentSummary || {};
  const deliveredTotal = (dto.itemsConfirmed?.length ? dto.itemsConfirmed : dto.itemsOrdered || [])
    .reduce((t, it) => t + (it.lineTotal || 0), 0);
  return [
    ['Items Total', deliveredTotal],
    ['Platform Fee', s.platformFee],
    ['Packing & Logistics', s.packingFee],
    ['Delivery Charge', s.deliveryCharge],
    ['GST', s.gst],
    ['Coupon Discount', s.couponDiscount, true],
    ['Wallet Adjustment', s.walletAdjustment, true],
  ];
}

module.exports = { computeDocuments, renderOrderDocument, PROFORMA_DISCLAIMER };
