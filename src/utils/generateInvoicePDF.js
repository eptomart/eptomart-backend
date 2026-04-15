const PDFDocument = require('pdfkit');
const cloudinary  = require('cloudinary').v2;
const { Readable } = require('stream');
const business = require('../../config/business');

const fmtINR = (n) => `Rs. ${(Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

const generateInvoicePDF = (invoice) => new Promise((resolve, reject) => {
  const doc    = new PDFDocument({ size: 'A4', margin: 40 });
  const chunks = [];
  doc.on('data', c => chunks.push(c));
  doc.on('end', () => resolve(Buffer.concat(chunks)));
  doc.on('error', reject);

  const W = 515; // usable width

  // ── Header ──────────────────────────────────────────────
  doc.fontSize(22).font('Helvetica-Bold').fillColor('#f97316').text('EPTOMART', 40, 40);
  doc.fontSize(9).font('Helvetica').fillColor('#666')
     .text(business.address, 40, 66)
     .text(`Phone: ${business.phone}  |  Email: ${business.email}  |  ${business.website}`, 40, 78);

  doc.fontSize(18).font('Helvetica-Bold').fillColor('#333').text('TAX INVOICE', 380, 40, { align: 'right' });
  doc.fontSize(9).font('Helvetica').fillColor('#555')
     .text(`Invoice No: ${invoice.invoiceNumber}`, 380, 66, { align: 'right' })
     .text(`Date: ${new Date(invoice.generatedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`, 380, 78, { align: 'right' })
     .text(`Order ID: #${invoice.order?.orderId || invoice.order}`, 380, 90, { align: 'right' });

  doc.moveTo(40, 108).lineTo(555, 108).strokeColor('#f97316').lineWidth(1.5).stroke();

  // ── Billing / Shipping ────────────────────────────────
  const ba = invoice.billingAddress || {};
  const sa = invoice.shippingAddress || ba;

  doc.fontSize(9).font('Helvetica-Bold').fillColor('#333').text('BILL TO', 40, 118);
  doc.font('Helvetica').fillColor('#555')
     .text(ba.name || '', 40, 130)
     .text(ba.phone || '', 40, 141)
     .text([ba.addressLine1, ba.city, ba.state, ba.pincode].filter(Boolean).join(', '), 40, 152, { width: 220 });

  doc.fontSize(9).font('Helvetica-Bold').fillColor('#333').text('SHIP TO', 295, 118);
  doc.font('Helvetica').fillColor('#555')
     .text(sa.name || '', 295, 130)
     .text(sa.phone || '', 295, 141)
     .text([sa.addressLine1, sa.city, sa.state, sa.pincode].filter(Boolean).join(', '), 295, 152, { width: 220 });

  const yAfterAddr = doc.y + 16;

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

  for (const item of invoice.items) {
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

  // ── Payment info ──────────────────────────────────────
  totY += 10;
  doc.fontSize(8).font('Helvetica').fillColor('#888')
     .text(`Payment: ${invoice.paymentMethod || '—'}  |  Status: PAID`, 40, totY);

  // ── Footer ────────────────────────────────────────────
  doc.fontSize(7).fillColor('#aaa')
     .text('This is a computer-generated invoice. No signature required.', 40, 760, { align: 'center', width: W });

  doc.end();
});

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
