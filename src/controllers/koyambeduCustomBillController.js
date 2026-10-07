// ============================================
// KOYAMBEDU CUSTOM BILLS — controller (admin Printer tab)
// Mounted at /api/koyambedu/custom-bills (see routes/koyambeduCustomBills.js)
// ============================================
const KoyambeduCustomBill = require('../models/KoyambeduCustomBill');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function cleanItems(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(it => ({
      name:  String(it?.name || '').trim(),
      unit:  String(it?.unit || '').trim(),
      qty:   Number(it?.qty),
      price: Number(it?.price),
    }))
    .filter(it => it.name && Number.isFinite(it.qty) && it.qty >= 0 && Number.isFinite(it.price) && it.price >= 0);
}
const totalOf = (items) => round2(items.reduce((s, it) => s + it.qty * it.price, 0));

const genBillNo = () => `EPT${Date.now().toString(36).toUpperCase()}`;

// POST /custom-bills — save a bill (called when the admin prints it)
exports.create = async (req, res) => {
  try {
    const { customerName, location = '', billDate, billTime = '', billNo } = req.body;
    const items = cleanItems(req.body.items);
    if (!String(customerName || '').trim()) return res.status(400).json({ success: false, message: 'Customer name is required' });
    if (!items.length) return res.status(400).json({ success: false, message: 'Add at least one item with a name, quantity and price' });
    const bill = await KoyambeduCustomBill.create({
      billNo: String(billNo || '').trim() || genBillNo(),
      customerName: String(customerName).trim(),
      location: String(location).trim(),
      billDate: billDate || new Date().toISOString().slice(0, 10),
      billTime,
      items,
      total: totalOf(items),
      createdBy: req.user?._id,
    });
    res.status(201).json({ success: true, bill });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ success: false, message: 'A bill with this number already exists' });
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /custom-bills?search=&dateFrom=&dateTo=&page=&limit=
exports.list = async (req, res) => {
  try {
    const { search, dateFrom, dateTo, page = 1, limit = 30 } = req.query;
    const filter = {};
    if (search && search.trim()) {
      const rx = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ customerName: rx }, { billNo: rx }, { location: rx }, { 'items.name': rx }];
    }
    if (dateFrom || dateTo) {
      filter.billDate = {};
      if (dateFrom) filter.billDate.$gte = dateFrom;
      if (dateTo)   filter.billDate.$lte = dateTo;
    }
    const lim = Math.min(100, Math.max(1, Number(limit) || 30));
    const skip = (Math.max(1, Number(page) || 1) - 1) * lim;
    const [bills, total] = await Promise.all([
      KoyambeduCustomBill.find(filter).sort({ createdAt: -1 }).skip(skip).limit(lim).lean(),
      KoyambeduCustomBill.countDocuments(filter),
    ]);
    res.json({ success: true, bills, total, pages: Math.ceil(total / lim) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /custom-bills/:id — edit header/items (add, remove, rename, re-price)
exports.update = async (req, res) => {
  try {
    const bill = await KoyambeduCustomBill.findById(req.params.id);
    if (!bill) return res.status(404).json({ success: false, message: 'Bill not found' });
    const { customerName, location, billDate, billTime } = req.body;
    if (customerName !== undefined) {
      if (!String(customerName).trim()) return res.status(400).json({ success: false, message: 'Customer name is required' });
      bill.customerName = String(customerName).trim();
    }
    if (location !== undefined) bill.location = String(location).trim();
    if (billDate) bill.billDate = billDate;
    if (billTime !== undefined) bill.billTime = billTime;
    if (req.body.items !== undefined) {
      const items = cleanItems(req.body.items);
      if (!items.length) return res.status(400).json({ success: false, message: 'A bill needs at least one item' });
      bill.items = items;
      bill.total = totalOf(items);
    }
    bill.updatedBy = req.user?._id;
    await bill.save();
    res.json({ success: true, bill });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// DELETE /custom-bills/:id
exports.remove = async (req, res) => {
  try {
    const bill = await KoyambeduCustomBill.findByIdAndDelete(req.params.id);
    if (!bill) return res.status(404).json({ success: false, message: 'Bill not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
