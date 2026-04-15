const Invoice = require('../models/Invoice');

const generateInvoiceNumber = async () => {
  const year   = new Date().getFullYear();
  const prefix = `EPT-${year}-`;

  const latest = await Invoice.findOne(
    { invoiceNumber: { $regex: `^${prefix}` } },
    { invoiceNumber: 1 },
    { sort: { invoiceNumber: -1 } }
  ).lean();

  let next = 1;
  if (latest) {
    const parts = latest.invoiceNumber.split('-');
    next = parseInt(parts[2], 10) + 1;
  }

  return `${prefix}${String(next).padStart(5, '0')}`;
};

module.exports = { generateInvoiceNumber };
