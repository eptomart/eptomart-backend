const Invoice  = require('../models/Invoice');
const Order    = require('../models/Order');
const Seller   = require('../models/Seller');
const PDFDocument = require('pdfkit');
const path     = require('path');
const fs       = require('fs');
const { generateInvoicePDF, uploadInvoicePDF } = require('../utils/generateInvoicePDF');
const business = require('../../config/business');

// Resolve logo path (backend/src/assets/logo.png)
const LOGO_PATH = path.join(__dirname, '../assets/logo.png');

// Platform commission rate (configurable via env)
const PLATFORM_COMMISSION_PCT = parseFloat(process.env.PLATFORM_COMMISSION_PCT || '10');

// ── Seller Payout Invoice PDF ────────────────
const generateSellerPayoutPDF = (order, seller, items) => {
  return new Promise((resolve, reject) => {
    const doc    = new PDFDocument({ size: 'A4', margin: 45 });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end',  () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const ORANGE = '#f97316';
    const DARK   = '#1e293b';
    const GRAY   = '#64748b';
    const GREEN  = '#16a34a';
    const RED    = '#dc2626';
    const fmt    = n => `Rs. ${(Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

    // Header
    doc.rect(0, 0, 595, 80).fill(DARK);
    // Logo image (774×244 px, 3.17:1 ratio — fit within 190×60 at y=10)
    if (fs.existsSync(LOGO_PATH)) {
      doc.image(LOGO_PATH, 45, 10, { fit: [190, 60] });
    } else {
      doc.fontSize(22).font('Helvetica-Bold').fillColor(ORANGE).text('eptomart', 45, 22);
    }
    doc.fontSize(8).font('Helvetica').fillColor('#94a3b8').text('Seller Payout Statement', 45, 66);
    doc.fontSize(14).font('Helvetica-Bold').fillColor('white')
       .text('SELLER INVOICE', 350, 28, { width: 200, align: 'right' });
    doc.fontSize(8).font('Helvetica').fillColor('#94a3b8')
       .text(`Order: #${order.orderId}  ·  Date: ${new Date(order.createdAt).toLocaleDateString('en-IN')}`, 350, 52, { width: 200, align: 'right' });

    // Seller info box
    doc.rect(45, 100, 505, 70).stroke('#e2e8f0');
    doc.fontSize(7).font('Helvetica-Bold').fillColor(GRAY).text('SELLER', 55, 110);
    doc.fontSize(11).font('Helvetica-Bold').fillColor(DARK).text(seller.businessName || 'Seller', 55, 122);
    doc.fontSize(8.5).font('Helvetica').fillColor(GRAY)
       .text(`${seller.address?.street || ''}, ${seller.address?.city || ''}, ${seller.address?.state || ''} — ${seller.address?.pincode || ''}`, 55, 138)
       .text(`GST: ${seller.gstNumber || 'N/A'}`, 55, 152);

    // Items table
    let y = 190;
    doc.rect(45, y, 505, 22).fill(DARK);
    doc.fontSize(8).font('Helvetica-Bold').fillColor('white')
       .text('PRODUCT',       50, y + 7)
       .text('QTY',          320, y + 7)
       .text('UNIT PRICE',   360, y + 7)
       .text('TOTAL',        460, y + 7, { width: 85, align: 'right' });
    y += 22;

    let itemsTotal = 0;
    let alt        = false;
    for (const item of items) {
      const lineTotal = (item.price || 0) * (item.quantity || 1);
      itemsTotal += lineTotal;
      doc.rect(45, y, 505, 28).fill(alt ? '#fafafa' : 'white');
      doc.rect(45, y, 3, 28).fill(ORANGE);
      doc.fontSize(9).font('Helvetica-Bold').fillColor(DARK).text(item.name, 52, y + 9, { width: 260, ellipsis: true });
      doc.fontSize(9).font('Helvetica').fillColor(GRAY)
         .text(String(item.quantity),        320, y + 9)
         .text(fmt(item.price),              360, y + 9)
         .text(fmt(lineTotal),               460, y + 9, { width: 85, align: 'right' });
      y += 28;
      alt = !alt;
    }

    doc.moveTo(45, y).lineTo(550, y).strokeColor('#e2e8f0').lineWidth(1).stroke();
    y += 16;

    // ── Use order.payout if available (pre-calculated), otherwise calculate from scratch ──
    const payout = order.payout;
    let grossAmount, gstAmount, baseAmount, platformFee, shippingCost, packingCharge = 0, customDeduction = 0, netPayout;

    if (payout && payout.baseAmount !== undefined) {
      // Use pre-calculated payout
      grossAmount   = payout.grossAmount || 0;
      gstAmount     = payout.gstAmount || 0;
      baseAmount    = payout.baseAmount || 0;
      platformFee   = payout.platformFee || 0;
      shippingCost  = payout.shippingCost || 0;
      packingCharge = payout.packingCharge || 0;
      customDeduction = payout.customDeduction || 0;
      netPayout     = payout.netPayout || 0;
    } else {
      // Fallback: recalculate (legacy support)
      grossAmount = itemsTotal;
      baseAmount = order.pricing?.subtotal || itemsTotal;
      gstAmount = order.pricing?.tax || 0;
      platformFee = parseFloat((baseAmount * PLATFORM_COMMISSION_PCT / 100).toFixed(2));
      shippingCost = order.shiprocket?.shippingCharge || order.pricing?.shipping || 0;
      netPayout = parseFloat((baseAmount - platformFee - shippingCost).toFixed(2));
    }

    // Helper for breakdown rows
    const tRow = (label, val, bold = false, color = GRAY) => {
      doc.fontSize(9).font(bold ? 'Helvetica-Bold' : 'Helvetica').fillColor(bold ? DARK : color)
         .text(label, 350, y, { width: 120 })
         .text(val,   470, y, { width: 75, align: 'right' });
      y += 18;
    };

    // ── Payout breakdown ──────────────────────────────────────────
    tRow('Gross Amount (GST-incl.)', fmt(grossAmount));
    if (gstAmount > 0) {
      tRow('GST Amount', `- ${fmt(gstAmount)}`, false, RED);
    }
    tRow('Base Amount (ex-GST)', fmt(baseAmount), true);
    y += 6;

    // Platform fee or bonus indicator
    // Show WAIVED if: explicit bonus flag OR platformFee is 0 (admin override / early orders)
    const feeWaived = payout?.isNewSellerBonus || platformFee === 0;
    if (feeWaived) {
      tRow('Platform Commission', '✓ WAIVED', false, GREEN);
      if (payout?.isNewSellerBonus) {
        doc.fontSize(7.5).font('Helvetica').fillColor(GREEN)
           .text('First 20 orders bonus — No platform fee', 350, y - 2, { width: 195, height: 16 });
        y += 8;
      }
    } else {
      tRow(`Platform Commission (${payout?.platformFeeRate || PLATFORM_COMMISSION_PCT}%)`, `- ${fmt(platformFee)}`, false, RED);
    }

    // Shipping cost
    if (shippingCost > 0) {
      tRow('Shipping / Logistics', `- ${fmt(shippingCost)}`, false, RED);
    }

    // Packing charge
    if (packingCharge > 0) {
      tRow('Packing Charge', `- ${fmt(packingCharge)}`, false, RED);
    }

    // Custom deduction
    if (customDeduction > 0) {
      tRow('Other Deduction', `- ${fmt(customDeduction)}`, false, RED);
      if (payout?.customDeductionNote) {
        doc.fontSize(7.5).font('Helvetica').fillColor(GRAY)
           .text(`(${payout.customDeductionNote})`, 350, y - 2, { width: 120, height: 16 });
        y += 6;
      }
    }

    // Net payout
    doc.moveTo(350, y).lineTo(550, y).strokeColor('#e2e8f0').lineWidth(0.5).stroke();
    y += 8;
    doc.rect(350, y, 200, 28).fill(DARK);
    doc.fontSize(11).font('Helvetica-Bold').fillColor('white')
       .text('NET PAYOUT', 356, y + 9, { width: 120 })
       .text(fmt(netPayout), 466, y + 9, { width: 79, align: 'right' });
    y += 42;

    // Payment method
    doc.fontSize(9).font('Helvetica').fillColor(GRAY)
       .text(`Payment Method: ${(order.paymentMethod || 'N/A').toUpperCase()}`, 45, y)
       .text(`Order Status: ${order.orderStatus || 'N/A'}`, 45, y + 14);

    // Finalization info (if finalized by admin)
    if (payout?.finalizedBy && payout?.finalizedAt) {
      doc.fontSize(8).fillColor(GRAY)
         .text(`Finalized on: ${new Date(payout.finalizedAt).toLocaleString('en-IN')}`, 45, y + 28);
    }

    // Footer
    doc.moveTo(45, 795).lineTo(550, 795).strokeColor('#e2e8f0').lineWidth(0.5).stroke();
    doc.fontSize(7.5).font('Helvetica').fillColor('#94a3b8')
       .text('This is a computer-generated seller payout statement. Contact support@eptomart.com for queries.', 45, 803, { align: 'center', width: 505 });

    doc.end();
  });
};

// ── Admin Summary Invoice PDF ────────────────
const generateAdminSummaryPDF = (order, items, invoice) => {
  return new Promise((resolve, reject) => {
    const doc    = new PDFDocument({ size: 'A4', margin: 45 });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end',  () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const ORANGE = '#f97316';
    const DARK   = '#1e293b';
    const GRAY   = '#64748b';
    const GREEN  = '#16a34a';
    const fmt    = n => `Rs. ${(Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

    // Header
    doc.rect(0, 0, 595, 80).fill(DARK);
    if (fs.existsSync(LOGO_PATH)) {
      doc.image(LOGO_PATH, 45, 10, { fit: [190, 60] });
    } else {
      doc.fontSize(22).font('Helvetica-Bold').fillColor(ORANGE).text('eptomart', 45, 22);
    }
    doc.fontSize(8).font('Helvetica').fillColor('#94a3b8').text('Admin Financial Summary', 45, 66);
    doc.fontSize(14).font('Helvetica-Bold').fillColor('white')
       .text('ADMIN INVOICE', 350, 28, { width: 200, align: 'right' });
    doc.fontSize(8).font('Helvetica').fillColor('#94a3b8')
       .text(`Order: #${order.orderId}  ·  ${new Date(order.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`, 350, 52, { width: 200, align: 'right' });

    // Customer + Delivery
    let y = 100;
    doc.rect(45, y, 245, 70).stroke('#e2e8f0');
    doc.fontSize(7).font('Helvetica-Bold').fillColor(GRAY).text('CUSTOMER', 55, y + 10);
    doc.fontSize(10).font('Helvetica-Bold').fillColor(DARK).text(order.shippingAddress?.fullName || 'N/A', 55, y + 22);
    doc.fontSize(8).font('Helvetica').fillColor(GRAY).text(`${order.shippingAddress?.city || ''}, ${order.shippingAddress?.state || ''} — ${order.shippingAddress?.pincode || ''}`, 55, y + 38);
    doc.fontSize(8).fillColor(GRAY).text(`Payment: ${(order.paymentMethod || '').toUpperCase()}`, 55, y + 52);

    doc.rect(305, y, 245, 70).stroke('#e2e8f0');
    doc.fontSize(7).font('Helvetica-Bold').fillColor(GRAY).text('INVOICE REF', 315, y + 10);
    doc.fontSize(10).font('Helvetica-Bold').fillColor(DARK).text(invoice?.invoiceNumber || '—', 315, y + 22);
    doc.fontSize(8).font('Helvetica').fillColor(GRAY).text(`Status: ${(order.paymentStatus || '').toUpperCase()}`, 315, y + 38);
    doc.fontSize(8).fillColor(GRAY).text(`Order Status: ${order.orderStatus || 'N/A'}`, 315, y + 52);

    // Items table
    y = 190;
    doc.rect(45, y, 505, 22).fill(DARK);
    doc.fontSize(8).font('Helvetica-Bold').fillColor('white')
       .text('ITEM',        50, y + 7)
       .text('SELLER',     260, y + 7)
       .text('QTY',        360, y + 7)
       .text('EX-GST',     395, y + 7)
       .text('TOTAL',      460, y + 7, { width: 85, align: 'right' });
    y += 22;

    let orderTotal = 0;
    let alt = false;
    for (const item of items) {
      const lineTotal = (item.price || 0) * (item.quantity || 1);
      orderTotal += lineTotal;
      doc.rect(45, y, 505, 28).fill(alt ? '#fafafa' : 'white');
      doc.rect(45, y, 3, 28).fill(ORANGE);
      doc.fontSize(9).font('Helvetica-Bold').fillColor(DARK).text(item.name, 52, y + 9, { width: 200, ellipsis: true });
      doc.fontSize(8.5).font('Helvetica').fillColor(GRAY)
         .text(item.sellerName || 'N/A', 260, y + 9, { width: 95, ellipsis: true })
         .text(String(item.quantity),     360, y + 9)
         .text(fmt(item.unitPriceExGst || item.price), 395, y + 9)
         .text(fmt(lineTotal),            460, y + 9, { width: 85, align: 'right' });
      y += 28;
      alt = !alt;
    }

    doc.moveTo(45, y).lineTo(550, y).strokeColor('#e2e8f0').lineWidth(1).stroke();
    y += 16;

    // Financial breakdown
    const subtotalExGst    = invoice?.subtotal      || order.gstBreakdown?.subtotalExGst || 0;
    const cgst             = invoice?.cgstTotal     || order.gstBreakdown?.cgstTotal     || 0;
    const sgst             = invoice?.sgstTotal     || order.gstBreakdown?.sgstTotal     || 0;
    const igst             = invoice?.igstTotal     || order.gstBreakdown?.igstTotal     || 0;
    const gstTotal         = cgst + sgst + igst;
    const shipping         = order.pricing?.shipping || 0;
    const grandTotal       = order.pricing?.total    || 0;
    const commission       = parseFloat((subtotalExGst * PLATFORM_COMMISSION_PCT / 100).toFixed(2));
    const gstOnComm        = parseFloat((commission * 18 / 100).toFixed(2));
    const sellerPayout     = parseFloat((subtotalExGst - commission - gstOnComm).toFixed(2));

    const tRow = (label, val, bold = false, color = GRAY) => {
      doc.fontSize(9).font(bold ? 'Helvetica-Bold' : 'Helvetica').fillColor(bold ? DARK : color)
         .text(label, 290, y, { width: 180 })
         .text(val,   470, y, { width: 75, align: 'right' });
      y += 18;
    };

    tRow('Subtotal (excl. GST)', fmt(subtotalExGst));
    if (cgst > 0 || sgst > 0) {
      tRow('CGST',  fmt(cgst));
      tRow('SGST',  fmt(sgst));
    } else {
      tRow('IGST',  fmt(igst));
    }
    tRow('Shipping', shipping > 0 ? fmt(shipping) : 'FREE');
    doc.moveTo(290, y).lineTo(550, y).strokeColor('#e2e8f0').lineWidth(0.5).stroke();
    y += 8;
    doc.rect(290, y, 260, 26).fill(DARK);
    doc.fontSize(11).font('Helvetica-Bold').fillColor('white')
       .text('GRAND TOTAL', 296, y + 8, { width: 160 })
       .text(fmt(grandTotal), 466, y + 8, { width: 79, align: 'right' });
    y += 40;

    // Platform margin breakdown
    doc.rect(45, y, 505, 110).stroke('#e2e8f0');
    doc.fontSize(9).font('Helvetica-Bold').fillColor(DARK).text('PLATFORM MARGIN BREAKDOWN', 55, y + 10);
    y += 30;
    const bRow = (label, val, color = GRAY) => {
      doc.fontSize(9).font('Helvetica').fillColor(color).text(label, 55, y).text(val, 400, y, { width: 140, align: 'right' });
      y += 18;
    };
    bRow('Order Subtotal (seller revenue base)', fmt(subtotalExGst));
    bRow(`Platform Commission (${PLATFORM_COMMISSION_PCT}%)`, `+ ${fmt(commission)}`, GREEN);
    bRow('GST on Platform Commission (18%)',    `+ ${fmt(gstOnComm)}`,  GREEN);
    bRow('Net Payout to Seller',               `- ${fmt(sellerPayout)}`, '#dc2626');
    y += 10;

    // Footer
    doc.moveTo(45, 795).lineTo(550, 795).strokeColor('#e2e8f0').lineWidth(0.5).stroke();
    doc.fontSize(7.5).font('Helvetica').fillColor('#94a3b8')
       .text('Eptomart Admin Financial Report — Confidential. Not for external distribution.', 45, 803, { align: 'center', width: 505 });

    doc.end();
  });
};

// ── Customer: own invoices list ──────────────────────────
const myInvoices = async (req, res) => {
  const { page = 1, limit = 10 } = req.query;
  const [invoices, total] = await Promise.all([
    Invoice.find({ customer: req.user._id, status: { $ne: 'cancelled' } })
      .select('invoiceNumber grandTotal generatedAt gstTotal status pdfUrl')
      .populate('order', 'orderId orderStatus paymentMethod paymentStatus')
      .sort({ generatedAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .lean(),
    Invoice.countDocuments({ customer: req.user._id }),
  ]);
  res.json({ success: true, invoices, total });
};

// ── Get invoice detail ───────────────────────────────────
const getInvoice = async (req, res) => {
  const invoice = await Invoice.findById(req.params.id)
    .populate('order',    'orderId orderStatus paymentMethod paymentStatus paymentDetails')
    .populate('customer', 'name email phone')
    .lean();

  if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found' });

  // Only admin/superAdmin or invoice owner can view
  const isAdmin = ['admin', 'superAdmin'].includes(req.user.role);
  if (!isAdmin && invoice.customer._id.toString() !== req.user._id.toString()) {
    return res.status(403).json({ success: false, message: 'Access denied' });
  }

  res.json({ success: true, invoice });
};

// ── Download PDF (redirect or regenerate on-the-fly) ─────
const downloadPDF = async (req, res) => {
  // Populate both order AND customer — customer.name is needed to patch old invoices
  // where billingAddress.name was empty (schema mismatch: Order uses fullName, Invoice uses name)
  const invoice = await Invoice.findById(req.params.id)
    .populate('order',    'orderId orderStatus paymentMethod paymentStatus paymentDetails')
    .populate('customer', 'name phone')
    .lean();
  if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found' });

  const isAdmin = ['admin', 'superAdmin'].includes(req.user.role);
  const customerId = invoice.customer?._id?.toString() || invoice.customer?.toString();
  if (!isAdmin && customerId !== req.user._id.toString()) {
    return res.status(403).json({ success: false, message: 'Access denied' });
  }

  // For COD orders: invoice PDF is only available after delivery
  const order = invoice.order;
  if (order?.paymentMethod === 'cod' && order?.orderStatus !== 'delivered') {
    return res.status(202).json({
      success: false,
      codPending: true,
      message: 'Invoice will be available for download after the order is delivered and payment is collected.',
    });
  }

  // Patch blank address names — old invoices were saved with empty name because
  // Order.shippingAddress uses `fullName` but Invoice.addressSnapshotSchema uses `name`.
  // Use the populated customer.name as the fallback for both address blocks.
  const fallbackName = invoice.customer?.name || '';
  if (!invoice.billingAddress?.name && fallbackName) {
    invoice.billingAddress  = { ...(invoice.billingAddress  || {}), name: fallbackName };
    invoice.shippingAddress = { ...(invoice.shippingAddress || {}), name: fallbackName };
  }

  // Always generate and stream PDF directly with Content-Disposition: attachment
  try {
    const buffer = await generateInvoicePDF(invoice);

    // Background upload to Cloudinary (non-blocking) so future requests get a cached URL
    if (!invoice.pdfUrl) {
      uploadInvoicePDF(buffer, invoice.invoiceNumber)
        .then(({ url, publicId }) => Invoice.findByIdAndUpdate(invoice._id, { pdfUrl: url, pdfPublicId: publicId }))
        .catch(e => console.error('[Invoice PDF] Background upload failed:', e.message));
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="invoice-${invoice.invoiceNumber}.pdf"`);
    return res.end(buffer);
  } catch (err) {
    console.error('[Invoice PDF] Generation failed:', err.message, err.stack);
    return res.status(500).json({ success: false, message: 'Failed to generate PDF. Please try again.' });
  }
};

// ── Admin: all invoices ──────────────────────────────────
const allInvoices = async (req, res) => {
  const { page = 1, limit = 20, search } = req.query;
  const filter = {};
  if (search) filter.invoiceNumber = { $regex: search, $options: 'i' };

  const [invoices, total] = await Promise.all([
    Invoice.find(filter)
      .populate('customer', 'name email phone')
      .populate('order',    'orderId orderStatus paymentMethod paymentStatus')
      .sort({ generatedAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .lean(),
    Invoice.countDocuments(filter),
  ]);

  res.json({ success: true, invoices, total });
};

// ── Admin: regenerate PDF ────────────────────────────────
const regeneratePDF = async (req, res) => {
  const invoice = await Invoice.findById(req.params.id)
    .populate('order', 'orderId orderStatus paymentMethod paymentStatus paymentDetails')
    .lean();
  if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found' });

  const buffer = await generateInvoicePDF(invoice);
  const { url, publicId } = await uploadInvoicePDF(buffer, invoice.invoiceNumber);

  await Invoice.findByIdAndUpdate(invoice._id, { pdfUrl: url, pdfPublicId: publicId });

  res.json({ success: true, pdfUrl: url });
};

// ── Shipping Label PDF (courier from/to) ────
const generateShippingLabelPDF = (order, seller) => {
  return new Promise((resolve, reject) => {
    const doc    = new PDFDocument({ size: [283, 425], margin: 0 }); // 10cm × 15cm label
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end',  () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const ORANGE = '#f97316';
    const DARK   = '#0f172a';
    const GRAY   = '#64748b';
    const W      = 283;

    const sa  = order.shippingAddress || {};
    const sp  = order.sellerPickup   || {};
    const isCOD = order.paymentMethod === 'cod';

    // ── Header band ──────────────────────────────────────
    doc.rect(0, 0, W, 36).fill(DARK);
    doc.fontSize(14).font('Helvetica-Bold').fillColor(ORANGE).text('eptomart', 10, 10);
    doc.fontSize(7).font('Helvetica').fillColor('#94a3b8').text('www.eptomart.com', 10, 26);

    if (isCOD) {
      doc.rect(160, 4, 115, 28).fill(ORANGE);
      doc.fontSize(9).font('Helvetica-Bold').fillColor('white')
         .text('💵 CASH ON DELIVERY', 163, 10)
         .text(`₹ ${Number(order.pricing?.total || 0).toLocaleString('en-IN')}`, 163, 22);
    }

    // ── Divider ───────────────────────────────────────────
    doc.moveTo(0, 36).lineTo(W, 36).strokeColor(ORANGE).lineWidth(2).stroke();

    // ── AWB / Tracking ────────────────────────────────────
    const awb = order.shiprocket?.awb || order.trackingNumber || '';
    let y = 44;

    doc.fontSize(7).font('Helvetica').fillColor(GRAY).text('AWB / TRACKING', 10, y);
    y += 10;
    doc.fontSize(awb ? 15 : 10).font('Helvetica-Bold').fillColor(DARK)
       .text(awb || 'Pending AWB Assignment', 10, y, { width: W - 20 });
    y += awb ? 20 : 14;

    doc.fontSize(7).font('Helvetica').fillColor(GRAY)
       .text(`Order: #${order.orderId}  ·  Date: ${new Date(order.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`, 10, y);
    y += 10;

    // ── Divider line ──────────────────────────────────────
    doc.moveTo(10, y + 4).lineTo(W - 10, y + 4).strokeColor('#e2e8f0').lineWidth(0.5).stroke();
    y += 14;

    // ── TO address (large — customer) ─────────────────────
    doc.rect(0, y, W, 6).fill(DARK);
    doc.fontSize(6).font('Helvetica-Bold').fillColor('white').text('▼ DELIVER TO', 10, y + 1);
    y += 10;

    doc.fontSize(12).font('Helvetica-Bold').fillColor(DARK)
       .text(sa.fullName || 'Customer', 10, y, { width: W - 20 });
    y += 16;

    doc.fontSize(8.5).font('Helvetica').fillColor('#334155');
    const addrLine1 = [sa.addressLine1, sa.addressLine2].filter(Boolean).join(', ');
    const addrLine2 = [sa.city, sa.state].filter(Boolean).join(', ');
    const addrLine3 = `PIN: ${sa.pincode || ''}${sa.phone ? '  Ph: ' + sa.phone : ''}`;
    if (addrLine1) { doc.text(addrLine1, 10, y, { width: W - 20 }); y += 12; }
    if (addrLine2) { doc.text(addrLine2, 10, y); y += 12; }
    doc.text(addrLine3, 10, y);
    y += 14;

    // ── Divider ───────────────────────────────────────────
    doc.moveTo(10, y).lineTo(W - 10, y).strokeColor('#e2e8f0').lineWidth(0.5).stroke();
    y += 8;

    // ── FROM address (seller / warehouse) ─────────────────
    doc.rect(0, y, W, 6).fill('#e2e8f0');
    doc.fontSize(6).font('Helvetica-Bold').fillColor(GRAY).text('▲ SHIPPED FROM', 10, y + 1);
    y += 10;

    const pickupName = sp.sellerName || seller?.businessName || 'Eptomart';
    const pickupAddr = [
      sp.street  || seller?.address?.street,
      sp.city    || seller?.address?.city,
      sp.state   || seller?.address?.state,
    ].filter(Boolean).join(', ');
    const pickupPin  = sp.pincode || seller?.address?.pincode || '';

    doc.fontSize(9).font('Helvetica-Bold').fillColor(DARK).text(pickupName, 10, y, { width: W - 20 });
    y += 12;
    if (pickupAddr) {
      doc.fontSize(7.5).font('Helvetica').fillColor(GRAY).text(pickupAddr, 10, y);
      y += 10;
    }
    doc.fontSize(7.5).font('Helvetica').fillColor(GRAY).text(`PIN: ${pickupPin}`, 10, y);
    y += 14;

    // ── Divider ───────────────────────────────────────────
    doc.moveTo(10, y).lineTo(W - 10, y).strokeColor('#e2e8f0').lineWidth(0.5).stroke();
    y += 8;

    // ── Items summary ────────────────────────────────────
    doc.fontSize(6.5).font('Helvetica-Bold').fillColor(GRAY).text('ITEMS', 10, y);
    y += 9;
    for (const item of (order.items || []).slice(0, 4)) {
      doc.fontSize(7.5).font('Helvetica').fillColor(DARK)
         .text(`${item.name} × ${item.quantity}`, 10, y, { width: W - 20, ellipsis: true });
      y += 10;
    }
    if (order.items?.length > 4) {
      doc.fontSize(7).font('Helvetica').fillColor(GRAY)
         .text(`+${order.items.length - 4} more item(s)`, 10, y);
      y += 10;
    }

    // ── Footer ────────────────────────────────────────────
    doc.rect(0, 400, W, 25).fill(DARK);
    doc.fontSize(6.5).font('Helvetica').fillColor('#94a3b8')
       .text(`${order.paymentMethod?.toUpperCase()} · ${order.orderStatus?.toUpperCase()} · eptomart.com`, 10, 409, { align: 'center', width: W - 20 });

    doc.end();
  });
};

// ── Download shipping label (admin only) ─────
const downloadShippingLabel = async (req, res) => {
  try {
    const order = await Order.findById(req.params.orderId)
      .populate({ path: 'items.product', select: 'name seller', populate: { path: 'seller', select: 'businessName address' } })
      .lean();
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    const seller = order.items?.[0]?.product?.seller || null;
    const buffer = await generateShippingLabelPDF(order, seller);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="shipping-label-${order.orderId}.pdf"`);
    return res.end(buffer);
  } catch (err) {
    console.error('[Shipping Label] Failed:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to generate shipping label' });
  }
};

// ── Seller: download payout statement PDF ────
const downloadSellerInvoice = async (req, res) => {
  try {
    const order = await Order.findById(req.params.orderId)
      .populate('items.product', 'name price seller')
      .lean();
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    const sellerDocId = req.user.sellerProfile;
    if (!sellerDocId) return res.status(403).json({ success: false, message: 'Seller profile not found' });

    const seller = await Seller.findById(sellerDocId).lean();
    if (!seller)  return res.status(403).json({ success: false, message: 'Seller not found' });

    // Filter items belonging to this seller
    const myItems = order.items.filter(item => {
      const itemSellerId = item.product?.seller?.toString() || '';
      return itemSellerId === sellerDocId.toString();
    });

    if (!myItems.length) return res.status(403).json({ success: false, message: 'No items in this order belong to your store' });

    // ── Live bonus re-check ───────────────────────────────────────────
    // Fixes old orders saved before isNewSellerBonus logic existed.
    // Count how many delivered orders this seller had BEFORE this order.
    const Product = require('../models/Product');
    const sellerProducts = await Product.find({ seller: sellerDocId }).select('_id').lean();
    const productIds     = sellerProducts.map(p => p._id);
    const deliveredBefore = await Order.countDocuments({
      'items.product': { $in: productIds },
      orderStatus: 'delivered',
      _id: { $ne: order._id },
    });
    const qualifiesForBonus = deliveredBefore < 20;

    // Clone payout and apply live bonus status — doesn't write to DB
    const livePayout = { ...(order.payout || {}) };
    if (qualifiesForBonus) {
      livePayout.isNewSellerBonus = true;
      livePayout.platformFee      = 0;
      livePayout.applyPlatformFee = false;
      // Recalculate net payout with fee zeroed
      const base     = livePayout.baseAmount    || 0;
      const shipping = livePayout.shippingCost  || 0;
      const packing  = livePayout.packingCharge || 0;
      const custom   = livePayout.customDeduction || 0;
      livePayout.netPayout = Math.max(0, base - shipping - packing - custom);
    }
    const orderForPDF = { ...order, payout: livePayout };

    const buffer = await generateSellerPayoutPDF(orderForPDF, seller, myItems);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="seller-invoice-${order.orderId}.pdf"`);
    return res.end(buffer);
  } catch (err) {
    console.error('[Seller Invoice] Generation failed:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to generate seller invoice' });
  }
};

// ── Admin: download full order financial summary ─
const downloadAdminInvoice = async (req, res) => {
  try {
    const order = await Order.findById(req.params.orderId)
      .populate({ path: 'items.product', select: 'name price seller', populate: { path: 'seller', select: 'businessName' } })
      .lean();
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    const invoice = await Invoice.findOne({ order: order._id }).lean();

    // Build enriched items with sellerName
    const enrichedItems = (order.items || []).map(item => ({
      ...item,
      sellerName:      item.product?.seller?.businessName || 'Eptomart',
      unitPriceExGst:  item.price / (1 + ((item.gstRate || 18) / 100)),
    }));

    const buffer = await generateAdminSummaryPDF(order, enrichedItems, invoice);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="admin-summary-${order.orderId}.pdf"`);
    return res.end(buffer);
  } catch (err) {
    console.error('[Admin Invoice] Generation failed:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to generate admin summary' });
  }
};

// ── Admin/Seller: download customer invoice by orderId ───
// Shared helper — find invoice by orderId and stream customer PDF
const _streamCustomerInvoiceByOrderId = async (orderId, res, label = 'Invoice') => {
  const invoice = await Invoice.findOne({ order: orderId })
    .populate('order',    'orderId orderStatus paymentMethod paymentStatus')
    .populate('customer', 'name email phone')
    .lean();
  if (!invoice) {
    return res.status(404).json({ success: false, message: 'Invoice not yet generated for this order. It is created automatically after payment.' });
  }
  const { generateInvoicePDF } = require('../utils/generateInvoicePDF');
  const buffer = await generateInvoicePDF(invoice);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="invoice-${invoice.invoiceNumber}.pdf"`);
  res.setHeader('Content-Length', buffer.length);
  return res.end(buffer);
};

// Admin: customer invoice by orderId
const downloadCustomerInvoiceByOrderIdAdmin = async (req, res) => {
  try {
    return await _streamCustomerInvoiceByOrderId(req.params.orderId, res, 'Customer Invoice');
  } catch (err) {
    console.error('[Admin Customer Invoice] Error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to generate invoice' });
  }
};

// ── Seller: download customer invoice by orderId ─────────
const downloadCustomerInvoiceBySeller = async (req, res) => {
  try {
    if (!req.user.sellerProfile) return res.status(403).json({ success: false, message: 'Seller access required' });
    return await _streamCustomerInvoiceByOrderId(req.params.orderId, res, 'Customer Invoice');
  } catch (err) {
    console.error('[Seller Customer Invoice] Error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to generate invoice' });
  }
};

module.exports = {
  myInvoices, getInvoice, downloadPDF, allInvoices, regeneratePDF,
  downloadSellerInvoice, downloadAdminInvoice,
  downloadShippingLabel,
  downloadCustomerInvoiceBySeller,
  downloadCustomerInvoiceByOrderIdAdmin,
};
