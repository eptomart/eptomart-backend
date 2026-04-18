const PDFDocument       = require('pdfkit');
const cloudinary        = require('cloudinary').v2;
const { Readable }      = require('stream');
const path              = require('path');
const fs                = require('fs');
const BusinessSettings  = require('../models/BusinessSettings');

const fmtINR = (n) => `Rs. ${(Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

// Load logo from local assets — always reliable, no network needed
const LOGO_PATH = path.join(__dirname, '../assets/logo.png');
const fetchLogoBuffer = () => {
  try {
    if (fs.existsSync(LOGO_PATH)) return fs.readFileSync(LOGO_PATH);
  } catch (_) {}
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

const ORANGE = '#f97316';
const DARK   = '#1a1a2e';
const GRAY   = '#6b7280';
const LGRAY  = '#f3f4f6';

const generateInvoicePDF = async (invoice) => {
  const logoBuf  = fetchLogoBuffer();
  const business = await BusinessSettings.getSettings();

  return new Promise((resolve, reject) => {
    const doc    = new PDFDocument({ size: 'A4', margin: 0 });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end',  () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const PW = 595; // page width
    const ML = 40;  // left margin
    const MR = 555; // right edge
    const CW = 515; // content width

    // ═══════════════════════════════════════════════
    // HEADER BAND — orange top stripe
    // ═══════════════════════════════════════════════
    doc.rect(0, 0, PW, 6).fill(ORANGE);

    // Left: Logo (large, no overlap) — y=16 to y=90
    const LOGO_Y = 16;
    const LOGO_H = 72;
    if (logoBuf && logoBuf.length > 500) {
      try {
        doc.image(logoBuf, ML, LOGO_Y, { height: LOGO_H, fit: [260, LOGO_H] });
      } catch (_) {
        doc.fontSize(28).font('Helvetica-Bold').fillColor(ORANGE).text('EPTOMART', ML, LOGO_Y + 18);
      }
    } else {
      doc.fontSize(28).font('Helvetica-Bold').fillColor(ORANGE).text('EPTOMART', ML, LOGO_Y + 18);
    }

    // Right: TAX INVOICE label — aligned top right
    doc.fontSize(22).font('Helvetica-Bold').fillColor(DARK)
       .text('TAX INVOICE', ML, 20, { width: CW, align: 'right' });

    // Business address block — BELOW logo (logo ends at y=88)
    const addrY = LOGO_Y + LOGO_H + 6; // y=94
    doc.fontSize(8).font('Helvetica').fillColor(GRAY)
       .text(business.address, ML, addrY, { width: 280 })
       .text(`Ph: ${business.phone}   Email: ${business.email}   ${business.website}`, ML, addrY + 11, { width: 320 });

    // Invoice meta — right column, aligned with address row
    doc.fontSize(8.5).font('Helvetica').fillColor(GRAY)
       .text('Invoice No',  MR - 200, addrY,      { width: 160, align: 'right' })
       .text('Date',        MR - 200, addrY + 12,  { width: 160, align: 'right' })
       .text('Order ID',    MR - 200, addrY + 24,  { width: 160, align: 'right' });
    doc.fontSize(8.5).font('Helvetica-Bold').fillColor(DARK)
       .text(invoice.invoiceNumber, MR - 200, addrY,      { width: 160, align: 'right' })
       .text(new Date(invoice.generatedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
             MR - 200, addrY + 12,  { width: 160, align: 'right' })
       .text(`#${invoice.order?.orderId || invoice.order}`,
             MR - 200, addrY + 24,  { width: 160, align: 'right' });

    // Divider line below header
    const divY = addrY + 44;
    doc.rect(0, divY, PW, 1).fill(ORANGE);

    // ═══════════════════════════════════════════════
    // BILL TO / SHIP TO — light gray panel
    // ═══════════════════════════════════════════════
    const ba   = invoice.billingAddress  || {};
    const sa   = invoice.shippingAddress || ba;
    const addrPanelY = divY + 2;

    doc.rect(0, addrPanelY, PW, 68).fill(LGRAY);

    // Left: Bill To
    doc.fontSize(7.5).font('Helvetica-Bold').fillColor(ORANGE)
       .text('BILL TO', ML, addrPanelY + 8);
    doc.fontSize(9).font('Helvetica-Bold').fillColor(DARK)
       .text(ba.fullName || ba.name || '', ML, addrPanelY + 20);
    doc.fontSize(8).font('Helvetica').fillColor(GRAY)
       .text([ba.addressLine1, ba.addressLine2].filter(Boolean).join(', '), ML, addrPanelY + 32, { width: 230 })
       .text([ba.city, ba.state, ba.pincode].filter(Boolean).join(', '), ML, addrPanelY + 43, { width: 230 })
       .text(ba.phone || '', ML, addrPanelY + 54);

    // Thin vertical separator
    doc.moveTo(PW / 2 - 10, addrPanelY + 10)
       .lineTo(PW / 2 - 10, addrPanelY + 58)
       .strokeColor('#d1d5db').lineWidth(0.5).stroke();

    // Right: Ship To
    const shipX = PW / 2;
    doc.fontSize(7.5).font('Helvetica-Bold').fillColor(ORANGE)
       .text('SHIP TO', shipX, addrPanelY + 8);
    doc.fontSize(9).font('Helvetica-Bold').fillColor(DARK)
       .text(sa.fullName || sa.name || '', shipX, addrPanelY + 20);
    doc.fontSize(8).font('Helvetica').fillColor(GRAY)
       .text([sa.addressLine1, sa.addressLine2].filter(Boolean).join(', '), shipX, addrPanelY + 32, { width: 230 })
       .text([sa.city, sa.state, sa.pincode].filter(Boolean).join(', '), shipX, addrPanelY + 43, { width: 230 })
       .text(sa.phone || '', shipX, addrPanelY + 54);

    // ═══════════════════════════════════════════════
    // ITEMS TABLE
    // ═══════════════════════════════════════════════
    const tblY  = addrPanelY + 72;
    const colX  = { item: ML, seller: 190, qty: 300, unit: 340, gst: 408, total: 468 };
    const HDR_H = 20;

    // Table header bar
    doc.rect(0, tblY, PW, HDR_H).fill(DARK);
    doc.fontSize(7.5).font('Helvetica-Bold').fillColor('white')
       .text('ITEM DESCRIPTION', colX.item,   tblY + 6)
       .text('SELLER',           colX.seller,  tblY + 6)
       .text('QTY',              colX.qty,     tblY + 6)
       .text('UNIT (ex-GST)',    colX.unit,    tblY + 6)
       .text('GST',              colX.gst,     tblY + 6)
       .text('TOTAL',            colX.total,   tblY + 6);

    let rowY = tblY + HDR_H;
    let alt  = false;

    for (const item of (invoice.items || [])) {
      const RH = 30;
      doc.rect(0, rowY, PW, RH).fill(alt ? '#fff7ed' : 'white');
      alt = !alt;

      // Orange left accent strip per row
      doc.rect(0, rowY, 4, RH).fill(ORANGE);

      doc.fontSize(8.5).font('Helvetica-Bold').fillColor(DARK)
         .text(item.productName, colX.item, rowY + 6, { width: 145, ellipsis: true });
      doc.fontSize(8).font('Helvetica').fillColor(GRAY)
         .text(item.sellerName || 'Eptomart', colX.seller, rowY + 9, { width: 105 })
         .text(String(item.quantity),          colX.qty,    rowY + 9)
         .text(fmtINR(item.unitPriceExGst),   colX.unit,   rowY + 9);
      doc.fontSize(7.5).font('Helvetica').fillColor(GRAY)
         .text(`${item.gstRate}%`,             colX.gst,    rowY + 5)
         .text(fmtINR(item.gstAmount),         colX.gst,    rowY + 15);
      doc.fontSize(8.5).font('Helvetica-Bold').fillColor(DARK)
         .text(fmtINR(item.lineGrandTotal),    colX.total,  rowY + 9);

      rowY += RH;
    }

    // Thin bottom border for table
    doc.rect(0, rowY, PW, 1).fill('#e5e7eb');

    // ═══════════════════════════════════════════════
    // TOTALS
    // ═══════════════════════════════════════════════
    const totX = 360;
    const valX = 460;
    let totY   = rowY + 14;

    const tRow = (label, value, bold = false, color = GRAY) => {
      doc.fontSize(9)
         .font(bold ? 'Helvetica-Bold' : 'Helvetica')
         .fillColor(bold ? DARK : color)
         .text(label, totX, totY)
         .text(value, valX, totY, { width: 90, align: 'right' });
      totY += 15;
    };

    tRow('Subtotal (excl. GST)', fmtINR(invoice.subtotal));
    if (invoice.gstType === 'intra') {
      tRow('CGST', fmtINR(invoice.cgstTotal));
      tRow('SGST', fmtINR(invoice.sgstTotal));
    } else {
      tRow('IGST', fmtINR(invoice.igstTotal));
    }
    if (invoice.shipping > 0) tRow('Shipping', fmtINR(invoice.shipping));
    if (invoice.discount > 0) tRow('Discount', `- ${fmtINR(invoice.discount)}`, false, '#16a34a');

    // Grand total band
    doc.rect(totX - 10, totY, MR - totX + 20, 24).fill(ORANGE);
    doc.fontSize(10).font('Helvetica-Bold').fillColor('white')
       .text('GRAND TOTAL', totX, totY + 7)
       .text(fmtINR(invoice.grandTotal), valX, totY + 7, { width: 90, align: 'right' });
    totY += 36;

    // ═══════════════════════════════════════════════
    // PAYMENT & SHIPMENT STATUS
    // ═══════════════════════════════════════════════
    const payMethod   = (invoice.order?.paymentMethod || invoice.paymentMethod || '—').toUpperCase();
    const rawStatus   = invoice.order?.paymentStatus  || invoice.paymentStatus  || 'pending';
    const isCod       = (invoice.order?.paymentMethod || invoice.paymentMethod) === 'cod';
    const orderStatus = invoice.order?.orderStatus    || 'placed';
    const isDelivered = orderStatus === 'delivered';

    let payStatusLabel;
    if (isCod && !isDelivered) payStatusLabel = 'Pay on Delivery';
    else if (rawStatus === 'paid')    payStatusLabel = 'PAID ✓';
    else if (rawStatus === 'pending') payStatusLabel = 'PENDING';
    else                              payStatusLabel = rawStatus.toUpperCase();

    const shipLabel = ORDER_STATUS_LABELS[orderStatus] || orderStatus.toUpperCase();

    // Two-column status panel
    const panelY = totY + 6;
    const panelH = 44;
    doc.rect(ML, panelY, CW / 2 - 8, panelH).fill('#f0fdf4').stroke('#bbf7d0');
    doc.rect(ML + CW / 2 - 2, panelY, CW / 2 + 2, panelH).fill('#eff6ff').stroke('#bfdbfe');

    doc.fontSize(7).font('Helvetica-Bold').fillColor('#166534')
       .text('PAYMENT METHOD', ML + 8, panelY + 7);
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#15803d')
       .text(`${payMethod}`, ML + 8, panelY + 18)
       .text(payStatusLabel, ML + 8, panelY + 30, { fontSize: 8 });

    doc.fontSize(7).font('Helvetica-Bold').fillColor('#1e40af')
       .text('SHIPMENT STATUS', ML + CW / 2 + 6, panelY + 7);
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#1d4ed8')
       .text(shipLabel, ML + CW / 2 + 6, panelY + 20, { width: CW / 2 - 14 });

    // ═══════════════════════════════════════════════
    // FOOTER
    // ═══════════════════════════════════════════════
    doc.rect(0, 820, PW, 22).fill(DARK);
    doc.fontSize(7.5).font('Helvetica').fillColor('#9ca3af')
       .text(
         `This is a computer-generated invoice and does not require a signature.   |   ${business.name}  ·  ${business.email}  ·  ${business.website}`,
         0, 827, { align: 'center', width: PW }
       );

    doc.end();
  });
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
