const PDFDocument = require('pdfkit');
const cloudinary  = require('cloudinary').v2;
const { Readable } = require('stream');
const https  = require('https');
const http   = require('http');
const business = require('../../config/business');

const fmtINR = (n) => `Rs. ${(Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

// Fetch logo image as Buffer (resolves with Buffer or null on failure)
const fetchLogoBuffer = () => new Promise((resolve) => {
  try {
    const logoUrl = `${process.env.FRONTEND_URL || 'https://eptomart.pages.dev'}/logo-v3.png`;
    const client  = logoUrl.startsWith('https') ? https : http;
    client.get(logoUrl, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', () => resolve(null));
    }).on('error', () => resolve(null));
  } catch { resolve(null); }
});

// Human-readable order status labels
const ORDER_STATUS_LABELS = {
  placed:     'Order Placed — Awaiting Confirmation',
  confirmed:  'Confirmed by Seller',
  processing: 'Processing / Being Packed',
  shipped:    'Shipped — In Transit',
  delivered:  'Delivered',
  cancelled:  'Cancelled',
  returned:   'Returned',
};

const generateInvoicePDF = async (invoice) => {
  const logoBuf = await fetchLogoBuffer();

  return new Promise((resolve, reject) => {
  const doc    = new PDFDocument({ size: 'A4', margin: 40 });
  const chunks = [];
  doc.on('data', c => chunks.push(c));
  doc.on('end', () => resolve(Buffer.concat(chunks)));
  doc.on('error', reject);

  const W = 515; // usable width

  // ── Header ──────────────────────────────────────────────
  // Left: logo image (or fallback text) + address
  if (logoBuf && logoBuf.length > 500) {
    try {
      doc.image(logoBuf, 40, 36, { height: 32, fit: [180, 32] });
    } catch (_) {
      doc.fontSize(22).font('Helvetica-Bold').fillColor('#f97316').text('EPTOMART', 40, 40);
    }
  } else {
    doc.fontSize(22).font('Helvetica-Bold').fillColor('#f97316').text('EPTOMART', 40, 40);
  }
  doc.fontSize(9).font('Helvetica').fillColor('#666')
     .text(business.address, 40, 72)
     .text(`Phone: ${business.phone}  |  Email: ${business.email}  |  ${business.website}`, 40, 84);

  // Right: TAX INVOICE + meta
  doc.fontSize(18).font('Helvetica-Bold').fillColor('#333').text('TAX INVOICE', 380, 40, { align: 'right' });
  doc.fontSize(9).font('Helvetica').fillColor('#555')
     .text(`Invoice No: ${invoice.invoiceNumber}`, 380, 66, { align: 'right' })
     .text(`Date: ${new Date(invoice.generatedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`, 380, 78, { align: 'right' })
     .text(`Order ID: #${invoice.order?.orderId || invoice.order}`, 380, 90, { align: 'right' });

  doc.moveTo(40, 108).lineTo(555, 108).strokeColor('#f97316').lineWidth(1.5).stroke();

  // ── Billing / Shipping ────────────────────────────────
  const ba = invoice.billingAddress || {};
  const sa = invoice.shippingAddress || ba;

  // BILL TO: Name at top, address, phone at END
  doc.fontSize(9).font('Helvetica-Bold').fillColor('#333').text('BILL TO', 40, 118);
  doc.font('Helvetica-Bold').fillColor('#333').text(ba.fullName || ba.name || '', 40, 130);
  doc.font('Helvetica').fillColor('#555')
     .text([ba.addressLine1, ba.addressLine2].filter(Boolean).join(', '), 40, 141, { width: 220 })
     .text([ba.city, ba.state, ba.pincode].filter(Boolean).join(', '), 40, 152, { width: 220 })
     .text(ba.phone || '', 40, 163);                        // ← phone at the end

  // SHIP TO: same structure
  doc.fontSize(9).font('Helvetica-Bold').fillColor('#333').text('SHIP TO', 295, 118);
  doc.font('Helvetica-Bold').fillColor('#333').text(sa.fullName || sa.name || '', 295, 130);
  doc.font('Helvetica').fillColor('#555')
     .text([sa.addressLine1, sa.addressLine2].filter(Boolean).join(', '), 295, 141, { width: 220 })
     .text([sa.city, sa.state, sa.pincode].filter(Boolean).join(', '), 295, 152, { width: 220 })
     .text(sa.phone || '', 295, 163);                       // ← phone at the end

  const yAfterAddr = 180; // fixed Y after address block (name+addr+phone)

  // ── Items Table ────────────────────────────────────────
  const colX   = { item: 40, seller: 180, qty: 290, unit: 330, gst: 395, total: 460 };
  const hdrY   = yAfterAddr;

  doc.rect(40, hdrY, W, 18).fill('#f97316');
  doc.fontSize(8).font('Helvetica-Bold').fillColor('white')
     .text('ITEM',       colX.item,   hdrY + 5)
     .text('SELLER',     colX.seller, hdrY + 5)
     .text('QTY',        colX.qty,    hdrY + 5)
     .text('UNIT PRICE', colX.unit,   hdrY + 5)
     .text('GST',        colX.gst,    hdrY + 5)
     .text('TOTAL',      colX.total,  hdrY + 5);

  let rowY = hdrY + 20;
  let alt   = false;

  for (const item of (invoice.items || [])) {
    const rh = 28;
    if (alt) doc.rect(40, rowY, W, rh).fill('#fff8f0');
    alt = !alt;

    doc.fontSize(8).font('Helvetica').fillColor('#333')
       .text(item.productName, colX.item, rowY + 4, { width: 135, ellipsis: true })
       .text(item.sellerName  || 'Eptomart', colX.seller, rowY + 4, { width: 105 })
       .text(String(item.quantity), colX.qty, rowY + 4)
       .text(fmtINR(item.unitPriceExGst), colX.unit, rowY + 4)
       .text(`${item.gstRate}%\n${fmtINR(item.gstAmount)}`, colX.gst, rowY + 2, { lineGap: 1 })
       .text(fmtINR(item.lineGrandTotal), colX.total, rowY + 4);

    rowY += rh;
  }

  doc.moveTo(40, rowY).lineTo(555, rowY).strokeColor('#ddd').lineWidth(0.5).stroke();

  // ── Totals ────────────────────────────────────────────
  const totX  = 370;
  const valX  = 460;
  let totY    = rowY + 12;
  const tRow  = (label, value, bold = false) => {
    doc.fontSize(9)
       .font(bold ? 'Helvetica-Bold' : 'Helvetica')
       .fillColor(bold ? '#333' : '#555')
       .text(label, totX, totY)
       .text(value, valX, totY, { width: 95, align: 'right' });
    totY += 14;
  };

  tRow('Subtotal (excl. GST)', fmtINR(invoice.subtotal));
  if (invoice.gstType === 'intra') {
    tRow(`CGST`, fmtINR(invoice.cgstTotal));
    tRow(`SGST`, fmtINR(invoice.sgstTotal));
  } else {
    tRow('IGST', fmtINR(invoice.igstTotal));
  }
  if (invoice.shipping > 0) tRow('Shipping', fmtINR(invoice.shipping));
  if (invoice.discount > 0) tRow('Discount', `- ${fmtINR(invoice.discount)}`);

  doc.moveTo(totX, totY).lineTo(555, totY).strokeColor('#f97316').lineWidth(1).stroke();
  totY += 6;
  tRow('GRAND TOTAL', fmtINR(invoice.grandTotal), true);

  // ── Payment & Shipment Status box ─────────────────────
  totY += 14;
  const boxH = 46;
  doc.rect(40, totY, W, boxH).fill('#f0fdf4').stroke('#bbf7d0');

  // paymentMethod may live on invoice directly OR on the populated order
  const payMethod = (invoice.order?.paymentMethod || invoice.paymentMethod || '—').toUpperCase();
  const rawStatus = invoice.order?.paymentStatus || invoice.paymentStatus || 'pending';
  const isCod = (invoice.order?.paymentMethod || invoice.paymentMethod) === 'cod';
  const orderStatus   = invoice.order?.orderStatus || 'placed';
  const isDelivered   = orderStatus === 'delivered';

  let payStatusLabel;
  if (isCod && !isDelivered) {
    payStatusLabel = 'PENDING — Pay on Delivery';
  } else if (rawStatus === 'paid') {
    payStatusLabel = 'PAID';
  } else if (rawStatus === 'pending') {
    payStatusLabel = 'PENDING';
  } else {
    payStatusLabel = rawStatus.toUpperCase();
  }

  const shipLabel = ORDER_STATUS_LABELS[orderStatus] || orderStatus.toUpperCase();

  doc.fontSize(8).font('Helvetica-Bold').fillColor('#166534')
     .text('PAYMENT', 52, totY + 8)
     .text('SHIPMENT STATUS', 52, totY + 22);
  doc.fontSize(8).font('Helvetica').fillColor('#15803d')
     .text(`${payMethod}  —  ${payStatusLabel}`, 160, totY + 8)
     .text(shipLabel, 160, totY + 22);

  totY += boxH + 12;

  // ── Footer ────────────────────────────────────────────
  doc.fontSize(7).fillColor('#aaa')
     .text('This is a computer-generated invoice. No signature required.', 40, 760, { align: 'center', width: W });

  doc.end();
  }); // end new Promise
};

// Upload PDF buffer to Cloudinary and return { url, publicId }
const uploadInvoicePDF = (buffer, invoiceNumber) => new Promise((resolve, reject) => {
  const stream = cloudinary.uploader.upload_stream(
    {
      folder:        'eptomart/invoices',
      public_id:     `invoice-${invoiceNumber}`,
      resource_type: 'raw',
      format:        'pdf',
    },
    (err, result) => {
      if (err) return reject(err);
      resolve({ url: result.secure_url, publicId: result.public_id });
    }
  );
  Readable.from(buffer).pipe(stream);
});

module.exports = { generateInvoicePDF, uploadInvoicePDF };
