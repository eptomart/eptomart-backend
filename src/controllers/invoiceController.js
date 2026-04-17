const Invoice = require('../models/Invoice');
const { generateInvoicePDF, uploadInvoicePDF } = require('../utils/generateInvoicePDF');

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
  const invoice = await Invoice.findById(req.params.id)
    .populate('order', 'orderId orderStatus paymentMethod paymentStatus paymentDetails')
    .lean();
  if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found' });

  const isAdmin = ['admin', 'superAdmin'].includes(req.user.role);
  if (!isAdmin && invoice.customer.toString() !== req.user._id.toString()) {
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

  // If PDF already generated, redirect to Cloudinary
  if (invoice.pdfUrl) {
    return res.redirect(invoice.pdfUrl);
  }

  // PDF missing — regenerate on-the-fly and stream to client
  try {
    const buffer = await generateInvoicePDF(invoice);
    // Upload async so next request hits Cloudinary (don't await — serve immediately)
    uploadInvoicePDF(buffer, invoice.invoiceNumber)
      .then(({ url, publicId }) => Invoice.findByIdAndUpdate(invoice._id, { pdfUrl: url, pdfPublicId: publicId }))
      .catch(e => console.error('[Invoice PDF] Background upload failed:', e.message));

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="invoice-${invoice.invoiceNumber}.pdf"`);
    return res.end(buffer);
  } catch (err) {
    console.error('[Invoice PDF] Regeneration failed:', err.message);
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

module.exports = { myInvoices, getInvoice, downloadPDF, allInvoices, regeneratePDF };
