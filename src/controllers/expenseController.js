const Expense         = require('../models/Expense');
const ExpenseCategory = require('../models/ExpenseCategory');
const { generateExpenseExcel } = require('../utils/generateExcel');

// ── Categories CRUD ──────────────────────────────────────
const listCategories = async (req, res) => {
  const cats = await ExpenseCategory.find({ isActive: true }).sort({ name: 1 }).lean();
  res.json({ success: true, categories: cats });
};

const createCategory = async (req, res) => {
  const { name, description, icon } = req.body;
  if (!name) return res.status(400).json({ success: false, message: 'name is required' });
  const cat = await ExpenseCategory.create({ name, description, icon, createdBy: req.user._id });
  res.status(201).json({ success: true, category: cat });
};

const updateCategory = async (req, res) => {
  const cat = await ExpenseCategory.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
  if (!cat) return res.status(404).json({ success: false, message: 'Category not found' });
  res.json({ success: true, category: cat });
};

const deleteCategory = async (req, res) => {
  const cat = await ExpenseCategory.findById(req.params.id);
  if (!cat) return res.status(404).json({ success: false, message: 'Not found' });
  if (cat.isDefault) return res.status(400).json({ success: false, message: 'Default categories cannot be deleted' });
  cat.isActive = false;
  await cat.save();
  res.json({ success: true, message: 'Category deactivated' });
};

// ── Expenses CRUD ────────────────────────────────────────
const listExpenses = async (req, res) => {
  const { from, to, category, search, page = 1, limit = 20 } = req.query;
  const filter = {};

  if (from || to) {
    filter.date = {};
    if (from) filter.date.$gte = new Date(from);
    if (to)   filter.date.$lte = new Date(new Date(to).setHours(23, 59, 59));
  }
  if (category) filter.category = category;
  if (search)   filter.title    = { $regex: search, $options: 'i' };

  const [expenses, total] = await Promise.all([
    Expense.find(filter)
      .populate('category',  'name icon')
      .populate('createdBy', 'name')
      .sort({ date: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .lean(),
    Expense.countDocuments(filter),
  ]);

  res.json({ success: true, expenses, total, page: Number(page), pages: Math.ceil(total / limit) });
};

const createExpense = async (req, res) => {
  const { category, title, description, amount, date, notes } = req.body;
  if (!category || !title || !amount) {
    return res.status(400).json({ success: false, message: 'category, title, amount required' });
  }
  const expense = await Expense.create({
    category, title, description, amount: Number(amount),
    date: date ? new Date(date) : new Date(),
    notes, createdBy: req.user._id,
  });
  const populated = await expense.populate(['category', 'createdBy']);
  res.status(201).json({ success: true, expense: populated });
};

const updateExpense = async (req, res) => {
  const expense = await Expense.findById(req.params.id);
  if (!expense) return res.status(404).json({ success: false, message: 'Not found' });

  ['category','title','description','amount','date','notes'].forEach(k => {
    if (req.body[k] !== undefined) expense[k] = req.body[k];
  });
  expense.updatedBy = req.user._id;
  await expense.save();
  await expense.populate(['category', 'createdBy']);
  res.json({ success: true, expense });
};

const deleteExpense = async (req, res) => {
  await Expense.findByIdAndDelete(req.params.id);
  res.json({ success: true, message: 'Expense deleted' });
};

// ── Summary ──────────────────────────────────────────────
const summary = async (req, res) => {
  const { from, to } = req.query;
  const dateFilter = {};
  if (from) dateFilter.$gte = new Date(from);
  if (to)   dateFilter.$lte = new Date(new Date(to).setHours(23, 59, 59));

  const match = Object.keys(dateFilter).length ? { date: dateFilter } : {};

  const [byCategory, byMonth, total] = await Promise.all([
    Expense.aggregate([
      { $match: match },
      { $group: { _id: '$category', total: { $sum: '$amount' }, count: { $sum: 1 } } },
      { $lookup: { from: 'expensecategories', localField: '_id', foreignField: '_id', as: 'cat' } },
      { $unwind: { path: '$cat', preserveNullAndEmptyArrays: true } },
      { $project: { category: '$cat.name', icon: '$cat.icon', total: 1, count: 1 } },
      { $sort: { total: -1 } },
    ]),
    Expense.aggregate([
      { $match: match },
      { $group: { _id: { year: { $year: '$date' }, month: { $month: '$date' } }, total: { $sum: '$amount' }, count: { $sum: 1 } } },
      { $sort: { '_id.year': -1, '_id.month': -1 } },
      { $limit: 12 },
    ]),
    Expense.aggregate([
      { $match: match },
      { $group: { _id: null, totalAmount: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]),
  ]);

  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const formatted = byMonth.map(m => ({
    month:  `${months[m._id.month - 1]} ${m._id.year}`,
    total:  m.total,
    count:  m.count,
  }));

  res.json({
    success: true,
    summary: {
      totalAmount: total[0]?.totalAmount || 0,
      count:       total[0]?.count       || 0,
      period:      { from, to },
      byCategory,
      byMonth: formatted,
    },
  });
};

// ── Excel export ─────────────────────────────────────────
const exportExcel = async (req, res) => {
  const { from, to, category } = req.query;
  const filter = {};
  if (from || to) {
    filter.date = {};
    if (from) filter.date.$gte = new Date(from);
    if (to)   filter.date.$lte = new Date(new Date(to).setHours(23, 59, 59));
  }
  if (category) filter.category = category;

  const expenses = await Expense.find(filter)
    .populate('category',  'name icon')
    .populate('createdBy', 'name')
    .sort({ date: -1 })
    .lean();

  const buffer = await generateExpenseExcel(expenses, { from, to });

  const filename = `eptomart-expenses-${from || 'all'}-to-${to || 'now'}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buffer);
};

module.exports = {
  listCategories, createCategory, updateCategory, deleteCategory,
  listExpenses, createExpense, updateExpense, deleteExpense,
  summary, exportExcel,
};
