// Admin: add items to a customer's cart from an uploaded list (photo / Excel / CSV).
const multer = require('multer');
const KoyambeduProduct = require('../models/KoyambeduProduct');
const KoyambeduSavedCart = require('../models/KoyambeduSavedCart');
const KoyambeduCart = require('../models/KoyambeduCart');
const KoyambeduActivity = require('../models/KoyambeduActivity');
const User = require('../models/User');
const svc = require('../services/koyambeduListImportService');
const carts = require('./koyambeduCartsController');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } }).single('file');
const uploadMiddleware = (req, res, next) => upload(req, res, (err) => {
  if (err) return res.status(400).json({ success: false, message: err.code === 'LIMIT_FILE_SIZE' ? 'File is too large (max 8 MB)' : (err.message || 'Upload failed') });
  next();
});

const liveProducts = async () => {
  const rows = await KoyambeduProduct.find({ isActive: true, isAvailable: true }).select('name nameTamil tags unit currentPrice minQty maxQty seller').populate('seller', 'isActive status').lean();
  return rows.filter(p => p.seller?.isActive && p.seller?.status === 'approved');
};

/** POST /koyambedu/admin/cart-import/parse  (multipart: file) */
const parse = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'Choose a file' });
    const raw = await svc.readList({ buffer: req.file.buffer, mimetype: req.file.mimetype, filename: req.file.originalname });
    if (!raw.length) return res.status(422).json({ success: false, message: 'No items found in this file' });
    const products = await liveProducts();
    const lines = svc.buildLines(raw.slice(0, 300), products);
    const count = (s) => lines.filter(l => l.status === s).length;
    res.json({ success: true, lines, stats: { total: lines.length, matched: count('matched'), suggested: count('suggested'), notfound: count('notfound') } });
  } catch (err) {
    console.error('[cartImport.parse]', err.message);
    res.status(err.statusCode || 500).json({ success: false, message: err.statusCode ? err.message : `Could not read the file: ${err.message}` });
  }
};

/** GET /koyambedu/admin/cart-import/products?q= */
const searchProducts = async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json({ success: true, products: [] });
  const products = (await liveProducts()).map(p => ({ p, s: Math.max(svc.similarity(q, p.name), svc.similarity(q, p.nameTamil || ''), String(p.name).toLowerCase().includes(q.toLowerCase()) ? 0.9 : 0) }))
    .filter(x => x.s >= 0.4).sort((a, b) => b.s - a.s).slice(0, 15)
    .map(({ p }) => ({ productId: String(p._id), name: p.name, nameTamil: p.nameTamil || '', unit: p.unit, price: p.currentPrice }));
  res.json({ success: true, products });
};

// Same price / grade rules as the customer's own "add to cart"
function buildItem(product, qty, deliveryType, gradeKey) {
  let resolvedGradeKey = null, resolvedGradeName = null, variants = product.variants || [];
  if (product.gradesEnabled && product.grades?.length > 0) {
    const grade = product.grades.find(g => g.gradeKey === (gradeKey || 'premium') && g.isActive) || product.grades.find(g => g.isActive);
    if (!grade) return { error: 'No grade available' };
    resolvedGradeKey = grade.gradeKey; resolvedGradeName = grade.gradeName || grade.gradeKey; variants = grade.variants || [];
  }
  let unitPrice = product.currentPrice || 0;
  const v = variants.find(x => (!x.toQty ? qty >= x.fromQty : qty >= x.fromQty && qty <= x.toQty));
  if (v?.finalPrice) unitPrice = v.finalPrice;
  return { item: { product: product._id, seller: product.seller._id, name: product.name, unitPrice, unit: product.unit, quantity: qty, deliveryType, gradeKey: resolvedGradeKey, gradeName: resolvedGradeName } };
}

/**
 * POST /koyambedu/admin/cart-import/apply
 * { userId, cartId? | newCartName?, addressId?, lines: [{ productId, quantity, gradeKey? }] }
 * Items are ADDED (quantities summed). Default target: a new cart "Added by Eptomart",
 * which does not disturb the customer's current cart.
 */
const apply = async (req, res) => {
  try {
    const { userId, cartId, lines } = req.body || {};
    if (!Array.isArray(lines) || !lines.length) return res.status(400).json({ success: false, message: 'Nothing to add' });
    const customer = await User.findById(userId).select('role addresses');
    if (!customer || ['admin', 'superAdmin'].includes(customer.role)) return res.status(404).json({ success: false, message: 'Customer not found' });

    // resolve products
    const ids = [...new Set(lines.map(l => String(l.productId)))];
    const prods = await KoyambeduProduct.find({ _id: { $in: ids }, isActive: true, isAvailable: true }).populate('seller', '_id status isActive');
    const byId = Object.fromEntries(prods.map(p => [String(p._id), p]));

    // target cart
    const active = await carts.workingCart(customer._id);
    await carts.ensureActive(active, customer._id);
    let target, targetIsActive = false;
    if (cartId) {
      target = await KoyambeduSavedCart.findOne({ _id: cartId, user: customer._id });
      if (!target) return res.status(404).json({ success: false, message: 'Cart not found' });
      targetIsActive = String(active.activeCartId) === String(target._id);
    } else {
      const name = String(req.body.newCartName || 'Added by Eptomart').trim().slice(0, 40) || 'Added by Eptomart';
      const addressId = await carts.validAddress(customer._id, req.body.addressId);
      if (addressId === null) return res.status(400).json({ success: false, message: 'Address not found' });
      let unique = name, n = 2;
      while (await KoyambeduSavedCart.findOne({ user: customer._id, name: new RegExp(`^${unique.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') })) unique = `${name} ${n++}`;
      target = await KoyambeduSavedCart.create({ user: customer._id, name: unique, addressId, items: [], createdByAdmin: req.user._id });
    }

    const items = targetIsActive ? active.items.map(i => (i.toObject ? i.toObject() : { ...i })) : carts.plainItems(target.items);
    const added = [], skipped = [];
    for (const l of lines) {
      const p = byId[String(l.productId)];
      let qty = Number(l.quantity);
      if (!p || !p.seller || p.seller.status !== 'approved' || !p.seller.isActive) { skipped.push({ productId: l.productId, reason: 'Product not available' }); continue; }
      if (!(qty > 0)) { skipped.push({ productId: l.productId, name: p.name, reason: 'Quantity missing' }); continue; }
      const note = [];
      if (p.minQty && qty < p.minQty) { qty = p.minQty; note.push(`raised to minimum ${p.minQty}`); }
      if (p.maxQty && qty > p.maxQty) { qty = p.maxQty; note.push(`capped at maximum ${p.maxQty}`); }
      const deliveryType = p.isNextDay !== false ? 'tomorrow' : 'today';
      const idx = items.findIndex(i => String(i.product) === String(p._id) && (p.gradesEnabled ? (i.gradeKey || null) === (l.gradeKey || i.gradeKey || null) : true));
      const newQty = idx > -1 ? (items[idx].quantity || 0) + qty : qty;
      const built = buildItem(p, p.maxQty ? Math.min(p.maxQty, newQty) : newQty, idx > -1 ? items[idx].deliveryType : deliveryType, l.gradeKey);
      if (built.error) { skipped.push({ productId: String(p._id), name: p.name, reason: built.error }); continue; }
      if (idx > -1) Object.assign(items[idx], built.item); else items.push(built.item);
      added.push({ productId: String(p._id), name: p.name, quantity: built.item.quantity, unit: p.unit, note: note.join(', ') });
    }

    if (targetIsActive) { active.items = items; await active.save(); }
    else { target.items = items; target.markModified('items'); await target.save(); }

    // admin-attributed trail (visible in the admin activity feed only)
    for (const a of added) KoyambeduActivity.create({ user: customer._id, type: 'cart_set', product: a.productId, quantity: a.quantity, byAdmin: req.user._id }).catch(() => {});

    res.json({ success: true, cartName: target.name, added, skipped, carts: await carts.summary(customer._id) });
  } catch (err) {
    console.error('[cartImport.apply]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { uploadMiddleware, parse, searchProducts, apply, buildItem };
