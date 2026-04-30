const PDFDocument      = require('pdfkit');
const cloudinary       = require('cloudinary').v2;
const { Readable }     = require('stream');
const path             = require('path');
const fs               = require('fs');
const BusinessSettings = require('../models/BusinessSettings');

const fmtINR = (n) => `Rs. ${(Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

// logo-nav.png — full horizontal logo, transparent background, 774x244
const LOGO_PATH = path.join(__dirname, '../assets/logo.png');
const fetchLogoBuffer = () => {
  try { if (fs.existsSync(LOGO_PATH)) return fs.readFileSync(LOGO_PATH); } catch (_) {}
  return null;
};

const ORDER_STATUS_LABELS = {
  placed:     'Order Placed — Awaiting Confirmation',
  confirmed:  'Confirmed by Seller',
  processing: 'Processing / Being Packed',
  shipped:    'Shipped — In Transit',
  delivered:  'Delivered',
  cancelled:  'Cancelled',
  returned:   'Returned',
};

const DARK   = '#1e293b';
const GRAY   = '#64748b';
const ORANGE = '#f97316';
const BORDER = '#e2e8f0';

const generateInvoicePDF = async (invoice) => {
  const logoBuf  = fetchLogoBuffer();
  const business = await BusinessSettings.getSettings();

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0 });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end',  () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const PW = 595, ML = 45, MR = 550, CW = 505;

    // ── LOGO — full branding, transparent, top left ────────────
    // logo-nav is 774×244 → height 48 → width ≈ 152px
    const LOGO_H = 48;
    const LOGO_W = Math.round(LOGO_H * (774 / 244));
    if (logoBuf && logoBuf.length > 500) {
      try {
        doc.image(logoBuf, ML, 20, { width: LOGO_W, height: LOGO_H });
      } catch (_) {
        doc.fontSize(22).font('Helvetica-Bold').fillColor(ORANGE).text('eptomart', ML, 28);
      }
    } else {
      doc.fontSize(22).font('Helvetica-Bold').fillColor(ORANGE).text('eptomart', ML, 28);
    }

    // ── TAX INVOICE — top right ────────────────────────────────
    doc.fontSize(20).font('Helvetica-Bold').fillColor(DARK)
       .text('TAX INVOICE', 310, 24, { width: 235, align: 'right' });

    // Invoice meta — label | bold value
    const mY = [52, 65, 78];
    ['Invoice No', 'Date', 'Order ID'].forEach((l, i) =>
      doc.fontSize(8).font('Helvetica').fillColor(GRAY).text(l, 372, mY[i])
    );
    [
      invoice.invoiceNumber,
      new Date(invoice.generatedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
      `#${invoice.order?.orderId || invoice.order}`,
    ].forEach((v, i) =>
      doc.fontSize(8).font('Helvetica-Bold').fillColor(DARK).text(v, 430, mY[i], { width: 118, align: 'right' })
    );

    // ── BUSINESS ADDRESS — below logo (logo ends y≈68, gap to y=76) ──
    doc.fontSize(7.5).font('Helvetica').fillColor(GRAY)
       .text(business.address, ML, 76, { lineBreak: false });
    doc.fontSize(7.5).font('Helvetica').fillColor(GRAY)
       .text(`Ph: ${business.phone}   ·   ${business.email}   ·   ${business.website}`, ML, 87, { lineBreak: false });
    if (business.gstNo) {
      doc.fontSize(7.5).font('Helvetica').fillColor(GRAY)
         .text(`GSTIN: ${business.gstNo}`, ML, 98, { lineBreak: false });
    }

    // ── HEADER DIVIDER ─────────────────────────────────────────
    const divY = business.gstNo ? 110 : 102;
    doc.moveTo(ML, divY).lineTo(MR, divY).strokeColor(BORDER).lineWidth(1).stroke();

    // ── BILL TO / SHIP TO / SOLD BY ───────────────────────────
    // If all items share the same seller GSTIN, show a "SOLD BY" block on the right.
    // Otherwise show SHIP TO on the right (standard layout).
    const ba  = invoice.billingAddress  || {};
    const sa  = invoice.shippingAddress || ba;

    // Deduplicate seller GSTINs across all invoice items
    const sellerGstins  = [...new Set((invoice.items || []).map(i => i.sellerGstNo).filter(Boolean))];
    const sellerNames   = [...new Set((invoice.items || []).map(i => i.sellerName).filter(Boolean))];
    const singleSeller  = sellerGstins.length === 1; // one seller for this invoice

    const bsH = singleSeller ? 94 : 82;
    const bsY = divY + 6;

    doc.fontSize(7).font('Helvetica-Bold').fillColor(GRAY).text('BILL TO', ML, bsY);
    doc.fontSize(9.5).font('Helvetica-Bold').fillColor(DARK).text(ba.fullName || ba.name || '', ML, bsY + 12);
    doc.fontSize(8).font('Helvetica').fillColor(GRAY)
       .text([ba.addressLine1, ba.addressLine2].filter(Boolean).join(', '), ML, bsY + 25, { width: 225, lineBreak: false })
       .text([ba.city, ba.state, ba.pincode].filter(Boolean).join(', '), ML, bsY + 37, { width: 225 })
       .text(ba.phone || '', ML, bsY + 49);

    doc.moveTo(PW / 2, bsY + 2).lineTo(PW / 2, bsY + bsH - 8).strokeColor(BORDER).lineWidth(0.5).stroke();

    const shipX = PW / 2 + 10;

    if (singleSeller) {
      // Right block: SOLD BY (seller info with GSTIN)
      doc.fontSize(7).font('Helvetica-Bold').fillColor(GRAY).text('SOLD BY', shipX, bsY);
      doc.fontSize(9.5).font('Helvetica-Bold').fillColor(DARK)
         .text(sellerNames[0] || 'Seller', shipX, bsY + 12, { width: 225, ellipsis: true });
      doc.fontSize(8).font('Helvetica').fillColor(GRAY)
         .text(`GSTIN: ${sellerGstins[0]}`, shipX, bsY + 27)
         .text('Ship To:', shipX, bsY + 42, { continued: false });
      doc.fontSize(8).font('Helvetica').fillColor(GRAY)
         .text(`${sa.fullName || sa.name || ''}`, shipX, bsY + 54, { width: 225, ellipsis: true })
         .text([sa.city, sa.state, sa.pincode].filter(Boolean).join(', '), shipX, bsY + 67, { width: 225 });
    } else {
      // Standard: SHIP TO on the right
      doc.fontSize(7).font('Helvetica-Bold').fillColor(GRAY).text('SHIP TO', shipX, bsY);
      doc.fontSize(9.5).font('Helvetica-Bold').fillColor(DARK).text(sa.fullName || sa.name || '', shipX, bsY + 12);
      doc.fontSize(8).font('Helvetica').fillColor(GRAY)
         .text([sa.addressLine1, sa.addressLine2].filter(Boolean).join(', '), shipX, bsY + 25, { width: 225, lineBreak: false })
         .text([sa.city, sa.state, sa.pincode].filter(Boolean).join(', '), shipX, bsY + 37, { width: 225 })
         .text(sa.phone || '', shipX, bsY + 49);
    }

    doc.moveTo(ML, bsY + bsH).lineTo(MR, bsY + bsH).strokeColor(BORDER).lineWidth(1).stroke();

    // ── ITEMS TABLE ────────────────────────────────────────────
    // valX/valW shared by both table TOTAL column and subtotals — keeps right edges identical
    const totX = 310, labW = 130, valX = 450, valW = 95;

    const tblY = bsY + bsH + 4;
    // Column x-positions (HSN shown as sub-line under product name; seller GSTIN under seller)
    const col  = { item: ML, seller: 200, qty: 316, unit: 352, gst: 415 };

    doc.rect(ML, tblY, CW, 22).fill(DARK);
    doc.fontSize(7.5).font('Helvetica-Bold').fillColor('white')
       .text('ITEM / HSN',       col.item,   tblY + 7)
       .text('SELLER / GSTIN',   col.seller,  tblY + 7)
       .text('QTY',              col.qty,     tblY + 7)
       .text('UNIT (ex-GST)',    col.unit,    tblY + 7)
       .text('GST',              col.gst,     tblY + 7)
       .text('TOTAL',            valX,        tblY + 7, { width: valW, align: 'right' });

    let rowY = tblY + 22, alt = false;
    for (const item of (invoice.items || [])) {
      // Row height: 44 if there's a sub-line (HSN or GSTIN), else 34
      const hasHsn    = Boolean(item.hsnCode);
      const hasGstin  = Boolean(item.sellerGstNo);
      const hasSub    = hasHsn || hasGstin;
      const RH        = hasSub ? 46 : 34;
      const nameY     = hasSub ? rowY + 8  : rowY + 12;
      const subY      = rowY + 24;
      const midY      = rowY + (RH / 2) - 4; // vertically centred for single-line cols

      doc.rect(ML, rowY, CW, RH).fill(alt ? '#fafafa' : 'white');
      doc.rect(ML, rowY, 3, RH).fill(ORANGE);
      alt = !alt;

      // Product name
      doc.fontSize(9).font('Helvetica-Bold').fillColor(DARK)
         .text(item.productName, col.item + 4, nameY, { width: 152, ellipsis: true });
      // HSN code below product name
      if (hasHsn) {
        doc.fontSize(7).font('Helvetica').fillColor(GRAY)
           .text(`HSN: ${item.hsnCode}`, col.item + 4, subY, { width: 152 });
      }

      // Seller name
      doc.fontSize(8).font('Helvetica').fillColor(GRAY)
         .text(item.sellerName || 'Eptomart', col.seller, hasGstin ? nameY : midY, { width: 112, ellipsis: true });
      // Seller GSTIN below seller name
      if (hasGstin) {
        doc.fontSize(7).font('Helvetica').fillColor(GRAY)
           .text(`GSTIN: ${item.sellerGstNo}`, col.seller, subY, { width: 112 });
      }

      // Quantity, unit price, GST rate+amount, line total — vertically centred
      doc.fontSize(8).font('Helvetica').fillColor(GRAY)
         .text(String(item.quantity),        col.qty,  midY)
         .text(fmtINR(item.unitPriceExGst), col.unit, midY);
      doc.fontSize(7.5).font('Helvetica').fillColor(GRAY)
         .text(`${item.gstRate}%`,           col.gst,  rowY + (RH / 2) - 9)
         .text(fmtINR(item.gstAmount),       col.gst,  rowY + (RH / 2) + 3);
      // Right-align item total to same edge as subtotals
      doc.fontSize(9).font('Helvetica-Bold').fillColor(DARK)
         .text(fmtINR(item.lineGrandTotal),  valX, midY, { width: valW, align: 'right' });
      rowY += RH;
    }
    doc.moveTo(ML, rowY).lineTo(MR, rowY).strokeColor(BORDER).lineWidth(1).stroke();

    // ── TOTALS ─────────────────────────────────────────────────
    let totY = rowY + 16;

    const tRow = (label, val, bold = false) => {
      doc.fontSize(9).font(bold ? 'Helvetica-Bold' : 'Helvetica').fillColor(bold ? DARK : GRAY)
         .text(label, totX, totY, { width: labW })
         .text(val, valX, totY, { width: valW, align: 'right' });
      totY += 16;
    };

    tRow('Subtotal (excl. GST)', fmtINR(invoice.subtotal));
    // Determine GST type from actual stored amounts (more reliable than gstType string)
    const hasIntraGst = (Number(invoice.cgstTotal) > 0 || Number(invoice.sgstTotal) > 0);
    if (hasIntraGst) {
      tRow('CGST', fmtINR(invoice.cgstTotal));
      tRow('SGST', fmtINR(invoice.sgstTotal));
    } else {
      tRow('IGST', fmtINR(invoice.igstTotal || invoice.gstTotal));
    }
    if (invoice.shipping > 0) tRow('Shipping', fmtINR(invoice.shipping));
    if (invoice.discount > 0) tRow('Discount', `- ${fmtINR(invoice.discount)}`);

    doc.moveTo(totX - 8, totY).lineTo(MR + 5, totY).strokeColor(BORDER).lineWidth(0.5).stroke();
    totY += 6;

    // Grand Total — dark band spanning both columns
    doc.rect(totX - 8, totY, MR - totX + 13, 26).fill(DARK);
    doc.fontSize(10.5).font('Helvetica-Bold').fillColor('white')
       .text('GRAND TOTAL', totX, totY + 8, { width: labW })
       .text(fmtINR(invoice.grandTotal), valX, totY + 8, { width: valW, align: 'right' });
    totY += 38;

    // ── PAYMENT & SHIPMENT STATUS ──────────────────────────────
    const rawMethod   = (invoice.order?.paymentMethod || '').toLowerCase();
    const payMethod   = rawMethod ? rawMethod.toUpperCase() : '—';
    const rawStatus   = (invoice.order?.paymentStatus || 'pending').toLowerCase();
    const isCod       = rawMethod === 'cod';
    const orderStatus = invoice.order?.orderStatus || 'placed';
    const isDelivered = orderStatus === 'delivered';

    let payLabel, payColor;
    if (isCod && isDelivered) {
      payLabel = 'COLLECTED (COD)'; payColor = '#16a34a';
    } else if (isCod) {
      payLabel = 'Collect on Delivery'; payColor = '#f97316';
    } else if (rawStatus === 'paid') {
      payLabel = 'PAID'; payColor = '#16a34a';
    } else if (rawStatus === 'refunded') {
      payLabel = 'REFUNDED'; payColor = '#3b82f6';
    } else if (rawStatus === 'failed') {
      payLabel = 'FAILED'; payColor = '#ef4444';
    } else {
      payLabel = rawMethod === 'upi' ? 'Awaiting Verification' : 'PENDING';
      payColor = GRAY;
    }
    const shipLabel = ORDER_STATUS_LABELS[orderStatus] || orderStatus;

    const spY = totY + 10, spH = 52, hw = (CW - 10) / 2;

    doc.rect(ML, spY, hw, spH).stroke(BORDER);
    doc.fontSize(7).font('Helvetica-Bold').fillColor(GRAY).text('PAYMENT', ML + 10, spY + 10);
    doc.fontSize(9).font('Helvetica-Bold').fillColor(DARK).text(payMethod, ML + 10, spY + 23);
    doc.fontSize(8.5).font('Helvetica-Bold').fillColor(payColor).text(payLabel, ML + 10, spY + 37);

    const bx = ML + hw + 10;
    doc.rect(bx, spY, hw, spH).stroke(BORDER);
    doc.fontSize(7).font('Helvetica-Bold').fillColor(GRAY).text('SHIPMENT STATUS', bx + 10, spY + 10);
    doc.fontSize(9).font('Helvetica-Bold').fillColor(DARK).text(shipLabel, bx + 10, spY + 25, { width: hw - 20 });

    // ── FOOTER ─────────────────────────────────────────────────
    doc.moveTo(ML, 800).lineTo(MR, 800).strokeColor(BORDER).lineWidth(0.5).stroke();
    doc.fontSize(7.5).font('Helvetica').fillColor('#94a3b8')
       .text('This is a computer-generated invoice and does not require a physical signature.',
             ML, 808, { align: 'center', width: CW });
    doc.fontSize(7).fillColor('#94a3b8')
       .text(`${business.name}   ·   ${business.email}   ·   ${business.website}`,
             ML, 820, { align: 'center', width: CW });

    doc.end();
  });
};

// Upload PDF buffer to Cloudinary
const uploadInvoicePDF = (buffer, invoiceNumber) => new Promise((resolve, reject) => {
  const stream = cloudinary.uploader.upload_stream(
    { folder: 'eptomart/invoices', public_id: `invoice-${invoiceNumber}`, resource_type: 'raw', format: 'pdf' },
    (err, result) => { if (err) return reject(err); resolve({ url: result.secure_url, publicId: result.public_id }); }
  );
  Readable.from(buffer).pipe(stream);
});

module.exports = { generateInvoicePDF, uploadInvoicePDF };
