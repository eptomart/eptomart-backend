const Invoice  = require('../models/Invoice');
const Order    = require('../models/Order');
const Seller   = require('../models/Seller');
const PDFDocument = require('pdfkit');
const { generateInvoicePDF, uploadInvoicePDF } = require('../utils/generateInvoicePDF');
const business = require('../../config/business');

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
    const fmt    = n => `Rs. ${(Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

    // Header
    doc.rect(0, 0, 595, 80).fill(DARK);
    doc.fontSize(22).font('Helvetica-Bold').fillColor(ORANGE).text('eptomart', 45, 22);
    doc.fontSize(10).font('Helvetica').fillColor('#94a3b8').text('Seller Payout Statement', 45, 52);
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

    // Payout calculation
    const commission    = parseFloat((itemsTotal * PLATFORM_COMMISSION_PCT / 100).toFixed(2));
    const gstOnComm     = parseFloat((commission * 18 / 100).toFixed(2));
    const netPayout     = parseFloat((itemsTotal - commission - gstOnComm).toFixed(2));

    const tRow = (label, val, bold = false, color = GRAY) => {
      doc.fontSize(9).font(bold ? 'Helvetica-Bold' : 'Helvetica').fillColor(bold ? DARK : color)
         .text(label, 350, y, { width: 120 })
         .text(val,   470, y, { width: 75, align: 'right' });
      y += 18;
    };

    tRow('Order Value',                fmt(itemsTotal));
    tRow(`Platform Commission (${PLATFORM_COMMISSION_PCT}%)`, `- ${fmt(commission)}`, false, '#dc2626');
    tRow('GST on Commission (18%)',    `- ${fmt(gstOnComm)}`, false, '#dc2626');

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
    doc.fontSize(22).font('Helvetica-Bold').fillColor(ORANGE).text('eptomart', 45, 22);
    doc.fontSize(10).font('Helvetica').fillColor('#94a3b8').text('Admin Financial Summary', 45, 52);
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

    const buffer = await generateSellerPayoutPDF(order, seller, myItems);
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

module.exports = { myInvoices, getInvoice, downloadPDF, allInvoices, regeneratePDF, downloadSellerInvoice, downloadAdminInvoice };
