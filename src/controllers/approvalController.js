const Product        = require('../models/Product');
const ProductApproval= require('../models/ProductApproval');
const Seller         = require('../models/Seller');

// ── Admin: list approval queue ───────────────────────────
const listApprovals = async (req, res) => {
  const { status = 'pending', page = 1, limit = 20 } = req.query;
  const filter = {};
  if (status !== 'all') filter.approvalStatus = status;
  filter.seller = { $exists: true, $ne: null };

  const [products, total] = await Promise.all([
    Product.find(filter)
      .populate('seller', 'businessName contact address')
      .populate('category', 'name')
      .sort({ submittedAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .lean(),
    Product.countDocuments(filter),
  ]);

  res.json({ success: true, products, total, page: Number(page), pages: Math.ceil(total / limit) });
};

// ── Admin: approval stats ────────────────────────────────
const approvalStats = async (req, res) => {
  const stats = await Product.aggregate([
    { $match: { seller: { $exists: true, $ne: null } } },
    { $group: { _id: '$approvalStatus', count: { $sum: 1 } } },
  ]);
  const result = {};
  stats.forEach(s => { result[s._id] = s.count; });
  res.json({ success: true, stats: result });
};

// ── Admin: get product approval history ──────────────────
const getApprovalHistory = async (req, res) => {
  const { productId } = req.params;
  const history = await ProductApproval.find({ product: productId })
    .populate('performedBy', 'name role')
    .sort({ createdAt: -1 })
    .lean();
  res.json({ success: true, history });
};

// ── Shared: perform approval action ─────────────────────
const performAction = async (req, res, action) => {
  const { productId } = req.params;
  const { note } = req.body;

  const product = await Product.findById(productId);
  if (!product) return res.status(404).json({ success: false, message: 'Product not found' });
  if (!product.seller) return res.status(400).json({ success: false, message: 'This is not a seller product' });

  const statusMap = {
    approve:            'approved',
    reject:             'rejected',
    request_correction: 'correction_needed',
    resubmit:           'pending',
  };

  product.approvalStatus = statusMap[action];
  if (action === 'approve') {
    product.approvedBy = req.user._id;
    product.approvedAt = new Date();
    product.isActive   = true;
  } else if (action === 'reject') {
    product.approvalNote = note;
    product.isActive     = false;
  } else if (action === 'request_correction') {
    product.approvalNote = note;
    product.isActive     = false;
  }

  await product.save();

  // Audit trail
  const seller = await Seller.findById(product.seller);
  await ProductApproval.create({
    product:     product._id,
    seller:      product.seller,
    action:      action === 'resubmit' ? 'resubmitted' :
                 action === 'request_correction' ? 'correction_requested' : action + 'd',
    performedBy: req.user._id,
    note:        note || undefined,
    snapshot:    product.toObject(),
  });

  res.json({ success: true, product, message: `Product ${action}ed successfully` });
};

const approve           = (req, res) => performAction(req, res, 'approve');
const reject            = (req, res) => performAction(req, res, 'reject');
const requestCorrection = (req, res) => performAction(req, res, 'request_correction');

// ── Seller: resubmit after correction ────────────────────
const resubmit = async (req, res) => {
  const { productId } = req.params;
  const product = await Product.findById(productId);
  if (!product) return res.status(404).json({ success: false, message: 'Product not found' });

  // Verify seller owns this product
  if (product.seller?.toString() !== req.seller._id.toString()) {
    return res.status(403).json({ success: false, message: 'Not your product' });
  }
  if (!['correction_needed', 'rejected', 'draft'].includes(product.approvalStatus)) {
    return res.status(400).json({ success: false, message: 'Product cannot be resubmitted in current state' });
  }

  product.approvalStatus = 'pending';
  product.submittedAt    = new Date();
  product.approvalNote   = undefined;
  await product.save();

  await ProductApproval.create({
    product:     product._id,
    seller:      req.seller._id,
    action:      'resubmitted',
    performedBy: req.user._id,
    snapshot:    product.toObject(),
  });

  res.json({ success: true, product, message: 'Product resubmitted for review' });
};

module.exports = { listApprovals, approvalStats, getApprovalHistory, approve, reject, requestCorrection, resubmit };
