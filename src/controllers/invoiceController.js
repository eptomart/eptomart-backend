const Invoice = require('../models/Invoice');
const { generateInvoicePDF, uploadInvoicePDF } = require('../utils/generateInvoicePDF');

// ── Customer: own invoices list ──────────────────────────
const myInvoices = async (req, res) => {
  const { page = 1, limit = 10 } = req.query;
  const [invoices, total] = await Promise.all([
    Invoice.find({ customer: req.user._id, status: { $ne: 'cancelled' } })
      .select('invoiceNumber grandTotal generatedAt gstTotal status pdfUrl')
      .populate('order', 'orderId orderStatus')
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
    .populate('order',    'orderId orderStatus paymentMethod paymentDetails')
    .populate('customer', 'name email phone')
    .lean();

  if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found' });

  // Only admin or invoice owner can view
  if (req.user.role !== 'admin' && invoice.customer._id.toString() !== req.user._id.toString()) {
    return res.status(403).json({ success: false, message: 'Access denied' });
  }

  res.json({ success: true, invoice });
};

// ── Download PDF (redirect to Cloudinary URL) ────────────
const downloadPDF = async (req, res) => {
  const invoice = await Invoice.findById(req.params.id).lean();
  if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found' });

  if (req.user.role !== 'admin' && invoice.customer.toString() !== req.user._id.toString()) {
    return res.status(403).json({ success: false, message: 'Access denied' });
  }

  if (!invoice.pdfUrl) {
    return res.status(404).json({ success: false, message: 'PDF not yet generated' });
  }

  return res.redirect(invoice.pdfUrl);
};

// ── Admin: all invoices ──────────────────────────────────
const allInvoices = async (req, res) => {
  const { page = 1, limit = 20, search } = req.query;
  const filter = {};
  if (search) filter.invoiceNumber = { $regex: search, $options: 'i' };

  const [invoices, total] = await Promise.all([
    Invoice.find(filter)
      .populate('customer', 'name email phone')
      .populate('order',    'orderId orderStatus')
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
    .populate('order', 'orderId paymentMethod')
    .lean();
  if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found' });

  const buffer = await generateInvoicePDF(invoice);
  const { url, publicId } = await uploadInvoicePDF(buffer, invoice.invoiceNumber);

  await Invoice.findByIdAndUpdate(invoice._id, { pdfUrl: url, pdfPublicId: publicId });

  res.json({ success: true, pdfUrl: url });
};

module.exports = { myInvoices, getInvoice, downloadPDF, allInvoices, regeneratePDF };
