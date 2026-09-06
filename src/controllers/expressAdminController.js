// ============================================
// EPTOMART EXPRESS — Admin Controller (Phase 1)
// Store management, store managers, POS users, product catalogue, margin
// config, and inventory allocation requests. SuperAdmin-only (mirrors the
// FruitBasket admin controller's pattern). Completely isolated from every
// other vertical's controllers/models.
// ============================================
const ExpressStore           = require('../models/ExpressStore');
const ExpressStoreManager    = require('../models/ExpressStoreManager');
const ExpressPOSUser         = require('../models/ExpressPOSUser');
const ExpressProduct         = require('../models/ExpressProduct');
const ExpressStoreProduct    = require('../models/ExpressStoreProduct');
const ExpressMarginConfig    = require('../models/ExpressMarginConfig');
const ExpressInventoryRequest = require('../models/ExpressInventoryRequest');
const ExpressAuditLog        = require('../models/ExpressAuditLog');
const ExpressStockLog        = require('../models/ExpressStockLog');
const ExpressExpense         = require('../models/ExpressExpense');
const ExpressOrder           = require('../models/ExpressOrder');
const ExpressCart            = require('../models/ExpressCart');
const ExpressBill            = require('../models/ExpressBill');
const KoyambeduProduct       = require('../models/KoyambeduProduct');
const KoyambeduCategory      = require('../models/KoyambeduCategory');
const Analytics              = require('../models/Analytics');
const { computeLogisticsCostPerKg, computeSellingPrice } = require('../services/expressPricingService');

const fail = (res, status, message) => res.status(status).json({ success: false, message });

async function logAudit({ actorType, actorName, action, store = null, meta = {} }) {
  try {
    await ExpressAuditLog.create({ actorType, actorName, action, store, meta });
  } catch (_) { /* never let audit logging break the main request */ }
}

// ── Stores ───────────────────────────────────────────────────────────────

const listStores = async (req, res) => {
  try {
    const stores = await ExpressStore.find({ isArchived: false })
      .populate('storeManager', 'name phone isActive')
      .sort({ createdAt: -1 })
      .lean();
    res.json({ success: true, stores });
  } catch (err) {
    console.error('[express.listStores]', err);
    fail(res, 500, 'Failed to load stores');
  }
};

const createStore = async (req, res) => {
  try {
    const { name, code, address, city, pincode, lat, lng, notes } = req.body;
    if (!name || !code || lat == null || lng == null) {
      return fail(res, 400, 'name, code, lat and lng are required');
    }
    const store = await ExpressStore.create({
      name, code, address, city, pincode,
      location: { lat: Number(lat), lng: Number(lng) },
      notes,
    });
    await logAudit({ actorType: 'admin', actorName: req.user?.name || 'Admin', action: 'store.create', store: store._id, meta: { name, code } });
    res.status(201).json({ success: true, store });
  } catch (err) {
    if (err.code === 11000) return fail(res, 409, 'A store with this code already exists');
    console.error('[express.createStore]', err);
    fail(res, 500, 'Failed to create store');
  }
};

const updateStore = async (req, res) => {
  try {
    const { storeId } = req.params;
    const { name, address, city, pincode, lat, lng, notes } = req.body;
    const update = { name, address, city, pincode, notes };
    if (lat != null && lng != null) update.location = { lat: Number(lat), lng: Number(lng) };
    Object.keys(update).forEach(k => update[k] === undefined && delete update[k]);

    const store = await ExpressStore.findByIdAndUpdate(storeId, update, { new: true, runValidators: true });
    if (!store) return fail(res, 404, 'Store not found');
    res.json({ success: true, store });
  } catch (err) {
    console.error('[express.updateStore]', err);
    fail(res, 500, 'Failed to update store');
  }
};

const toggleStoreActive = async (req, res) => {
  try {
    const { storeId } = req.params;
    const store = await ExpressStore.findById(storeId);
    if (!store) return fail(res, 404, 'Store not found');

    store.isActive = !store.isActive;
    store.lastStatusChange = { by: 'admin', byName: req.user?.name || 'Admin', at: new Date() };
    await store.save();

    await logAudit({
      actorType: 'admin', actorName: req.user?.name || 'Admin',
      action: store.isActive ? 'store.activate' : 'store.deactivate', store: store._id,
    });
    res.json({ success: true, store });
  } catch (err) {
    console.error('[express.toggleStoreActive]', err);
    fail(res, 500, 'Failed to update store status');
  }
};

const archiveStore = async (req, res) => {
  try {
    const { storeId } = req.params;
    const store = await ExpressStore.findByIdAndUpdate(storeId, { isArchived: true, isActive: false }, { new: true });
    if (!store) return fail(res, 404, 'Store not found');
    await logAudit({ actorType: 'admin', actorName: req.user?.name || 'Admin', action: 'store.archive', store: store._id });
    res.json({ success: true, store });
  } catch (err) {
    console.error('[express.archiveStore]', err);
    fail(res, 500, 'Failed to archive store');
  }
};

// ── Store Managers ───────────────────────────────────────────────────────

const listStoreManagers = async (req, res) => {
  try {
    const managers = await ExpressStoreManager.find({})
      .populate('store', 'name code')
      .select('-password')
      .sort({ createdAt: -1 })
      .lean();
    res.json({ success: true, managers });
  } catch (err) {
    console.error('[express.listStoreManagers]', err);
    fail(res, 500, 'Failed to load store managers');
  }
};

const createStoreManager = async (req, res) => {
  try {
    const { name, phone, password, storeId } = req.body;
    if (!name || !phone || !password || !storeId) {
      return fail(res, 400, 'name, phone, password and storeId are required');
    }
    const store = await ExpressStore.findById(storeId);
    if (!store) return fail(res, 404, 'Store not found');

    const manager = await ExpressStoreManager.create({ name, phone, password, store: storeId });
    store.storeManager = manager._id;
    await store.save();

    await logAudit({ actorType: 'admin', actorName: req.user?.name || 'Admin', action: 'manager.create', store: store._id, meta: { managerName: name } });
    const safe = manager.toObject(); delete safe.password;
    res.status(201).json({ success: true, manager: safe });
  } catch (err) {
    if (err.code === 11000) return fail(res, 409, 'A manager with this phone number already exists');
    console.error('[express.createStoreManager]', err);
    fail(res, 500, 'Failed to create store manager');
  }
};

const updateStoreManager = async (req, res) => {
  try {
    const { managerId } = req.params;
    const { name, phone, isActive, password } = req.body;
    const manager = await ExpressStoreManager.findById(managerId);
    if (!manager) return fail(res, 404, 'Store manager not found');

    if (name != null) manager.name = name;
    if (phone != null) manager.phone = phone;
    if (isActive != null) manager.isActive = isActive;
    if (password) manager.password = password; // re-hashed by pre-save hook
    await manager.save();

    const safe = manager.toObject(); delete safe.password;
    res.json({ success: true, manager: safe });
  } catch (err) {
    console.error('[express.updateStoreManager]', err);
    fail(res, 500, 'Failed to update store manager');
  }
};

// ── POS Users ────────────────────────────────────────────────────────────

const listPOSUsers = async (req, res) => {
  try {
    const { storeId } = req.query;
    const filter = storeId ? { store: storeId } : {};
    const posUsers = await ExpressPOSUser.find(filter)
      .populate('store', 'name code')
      .select('-pin')
      .sort({ createdAt: -1 })
      .lean();
    res.json({ success: true, posUsers });
  } catch (err) {
    console.error('[express.listPOSUsers]', err);
    fail(res, 500, 'Failed to load POS users');
  }
};

const createPOSUser = async (req, res) => {
  try {
    const { name, username, pin, storeId } = req.body;
    if (!name || !username || !pin || !storeId) {
      return fail(res, 400, 'name, username, pin and storeId are required');
    }
    const store = await ExpressStore.findById(storeId);
    if (!store) return fail(res, 404, 'Store not found');

    const posUser = await ExpressPOSUser.create({ name, username, pin, store: storeId });
    await logAudit({ actorType: 'admin', actorName: req.user?.name || 'Admin', action: 'pos.create', store: storeId, meta: { posName: name } });

    const safe = posUser.toObject(); delete safe.pin;
    res.status(201).json({ success: true, posUser: safe });
  } catch (err) {
    if (err.code === 11000) return fail(res, 409, 'A POS user with this username already exists');
    console.error('[express.createPOSUser]', err);
    fail(res, 500, 'Failed to create POS user');
  }
};

const updatePOSUser = async (req, res) => {
  try {
    const { posUserId } = req.params;
    const { name, isActive, pin } = req.body;
    const posUser = await ExpressPOSUser.findById(posUserId);
    if (!posUser) return fail(res, 404, 'POS user not found');

    if (name != null) posUser.name = name;
    if (isActive != null) posUser.isActive = isActive;
    if (pin) posUser.pin = pin;
    await posUser.save();

    const safe = posUser.toObject(); delete safe.pin;
    res.json({ success: true, posUser: safe });
  } catch (err) {
    console.error('[express.updatePOSUser]', err);
    fail(res, 500, 'Failed to update POS user');
  }
};

// ── Products (master catalogue) ─────────────────────────────────────────

const KOYAMBEDU_PRODUCT_FIELDS = 'name description images category unit';

const listProducts = async (req, res) => {
  try {
    const products = await ExpressProduct.find({})
      .populate('koyambeduProduct', KOYAMBEDU_PRODUCT_FIELDS)
      .sort({ createdAt: -1 })
      .lean();
    res.json({ success: true, products });
  } catch (err) {
    console.error('[express.listProducts]', err);
    fail(res, 500, 'Failed to load products');
  }
};

/**
 * Search Koyambedu Daily's catalogue for products to link into Express —
 * proxies the existing public search so no duplicate index/logic is needed.
 * Intentionally does NOT filter by isActive: a product disabled in
 * Koyambedu Daily should still be linkable/visible here, since Express's
 * own availability (ExpressStoreProduct.isAvailable) is managed
 * independently — admin may want to sell it via Express even while it's
 * paused on the Koyambedu Daily storefront. isActive is returned so the UI
 * can badge it.
 */
const searchKoyambeduCatalog = async (req, res) => {
  try {
    const { search = '' } = req.query;
    const filter = {};
    if (search.trim()) {
      const re = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ name: re }, { nameTamil: re }];
    }
    const products = await KoyambeduProduct.find(filter)
      .select('name description images unit category isActive')
      .limit(20)
      .lean();
    res.json({ success: true, products });
  } catch (err) {
    console.error('[express.searchKoyambeduCatalog]', err);
    fail(res, 500, 'Failed to search Koyambedu catalogue');
  }
};

// ── PLU quick-entry codes for the POS terminal ──────────────────────────
// Vegetables get 100-199, Fruits get 200-299 (section requested: "every
// fruit should have a three digit code ... 200 series and vegetables ...
// 100 series"). Category matching is name-based since KoyambeduCategory
// documents are admin-created (no fixed enum) — anything whose category
// name doesn't clearly say "fruit" or "vegetable" is left uncoded and can
// be assigned manually via adminSetProductPlu.
const PLU_SERIES = { vegetable: [100, 199], fruit: [200, 299] };

async function detectPluSeries(koyambeduProduct) {
  try {
    if (!koyambeduProduct?.category) return null;
    const category = await KoyambeduCategory.findById(koyambeduProduct.category).select('name parent').lean();
    if (!category) return null;
    // Walk up to the root category if this is a sub-category, so e.g.
    // "Leafy Vegetables" (child of "Vegetables") still resolves correctly.
    let current = category;
    const seen = new Set();
    while (current?.parent && !seen.has(String(current._id))) {
      seen.add(String(current._id));
      const parent = await KoyambeduCategory.findById(current.parent).select('name parent').lean();
      if (!parent) break;
      current = parent;
    }
    const name = (current?.name || '').toLowerCase();
    if (name.includes('fruit')) return 'fruit';
    if (name.includes('vegetable') || name.includes('veg')) return 'vegetable';
    return null;
  } catch (_) {
    return null; // never let PLU detection block a product create
  }
}

/** Finds the next free 3-digit code in the given series' range. Returns null if the series is full. */
async function nextFreePlu(series) {
  const [min, max] = PLU_SERIES[series];
  const used = new Set((await ExpressProduct.find({ plu: { $gte: min, $lte: max } }).select('plu').lean()).map(p => p.plu));
  for (let code = min + 1; code <= max; code++) { // +1: reserve xx0 (e.g. 100, 200) as "unassigned" for readability
    if (!used.has(code)) return code;
  }
  return null;
}

const createProduct = async (req, res) => {
  try {
    const { koyambeduProductId, unit, isWeightBased, unitsPerKg, procurementBaseCost, customMarginPct } = req.body;
    if (!koyambeduProductId || procurementBaseCost == null) {
      return fail(res, 400, 'koyambeduProductId and procurementBaseCost are required');
    }
    const koyambeduProduct = await KoyambeduProduct.findById(koyambeduProductId).lean();
    if (!koyambeduProduct) return fail(res, 404, 'Koyambedu product not found');

    // Auto-assign a PLU code based on category — best-effort, never blocks
    // creation if detection fails or the series is full.
    let plu = null;
    const series = await detectPluSeries(koyambeduProduct);
    if (series) plu = await nextFreePlu(series);

    const product = await ExpressProduct.create({
      koyambeduProduct: koyambeduProductId,
      unit: unit || koyambeduProduct.unit || 'kg',
      isWeightBased, unitsPerKg, procurementBaseCost, customMarginPct, plu,
    });
    const populated = await product.populate('koyambeduProduct', KOYAMBEDU_PRODUCT_FIELDS);
    res.status(201).json({ success: true, product: populated });
  } catch (err) {
    if (err.code === 11000) return fail(res, 409, 'This Koyambedu product is already linked to Express');
    console.error('[express.createProduct]', err);
    fail(res, 500, 'Failed to create product');
  }
};

// Manually set/change a product's PLU code — validates it's a 3-digit code
// in the correct series (100s vegetables / 200s fruit) and unique.
const adminSetProductPlu = async (req, res) => {
  try {
    const { productId } = req.params;
    const { plu } = req.body;
    if (plu === null || plu === '') {
      const product = await ExpressProduct.findByIdAndUpdate(productId, { plu: null }, { new: true });
      if (!product) return fail(res, 404, 'Product not found');
      return res.json({ success: true, product });
    }
    const code = Number(plu);
    if (!Number.isInteger(code) || code < 100 || code > 299) {
      return fail(res, 400, 'Code must be a 3-digit number: 100-199 (vegetables) or 200-299 (fruits)');
    }
    const product = await ExpressProduct.findByIdAndUpdate(productId, { plu: code }, { new: true, runValidators: true })
      .populate('koyambeduProduct', KOYAMBEDU_PRODUCT_FIELDS);
    if (!product) return fail(res, 404, 'Product not found');
    res.json({ success: true, product });
  } catch (err) {
    if (err.code === 11000) return fail(res, 409, 'That code is already assigned to another product');
    console.error('[express.adminSetProductPlu]', err);
    fail(res, 500, 'Failed to update code');
  }
};

// Combined "pick a Koyambedu product, assign it to a store with stock and
// price" action — the single-screen flow requested, instead of the
// separate link-into-Express + allocate-to-store steps. If the Koyambedu
// product isn't linked into Express yet, this links it first (same as
// createProduct, including PLU auto-assignment); if it's already linked,
// the existing ExpressProduct is reused. Either way, stock is ADDED
// (procurement arriving) and logged to ExpressStockLog exactly like
// addStock does — including the acknowledgement fields, so this shows up
// in the store manager's "pending acknowledgement" list automatically.
const adminAssignProductToStore = async (req, res) => {
  try {
    const {
      storeId, koyambeduProductId, unit, isWeightBased, unitsPerKg,
      procurementBaseCost, customMarginPct, stockQty, priceOverride, note,
    } = req.body;
    if (!storeId || !koyambeduProductId) return fail(res, 400, 'storeId and koyambeduProductId are required');

    let product = await ExpressProduct.findOne({ koyambeduProduct: koyambeduProductId });
    if (!product) {
      if (procurementBaseCost == null) return fail(res, 400, 'procurementBaseCost is required to link this product into Express for the first time');
      const koyambeduProduct = await KoyambeduProduct.findById(koyambeduProductId).lean();
      if (!koyambeduProduct) return fail(res, 404, 'Koyambedu product not found');
      let plu = null;
      const series = await detectPluSeries(koyambeduProduct);
      if (series) plu = await nextFreePlu(series);
      product = await ExpressProduct.create({
        koyambeduProduct: koyambeduProductId,
        unit: unit || koyambeduProduct.unit || 'kg',
        isWeightBased, unitsPerKg, procurementBaseCost, customMarginPct, plu,
      });
    }

    const delta = Number(stockQty) || 0;
    if (delta < 0) return fail(res, 400, 'stockQty cannot be negative');

    const existing = await ExpressStoreProduct.findOne({ store: storeId, product: product._id }).lean();
    const previousQty = existing?.stockQty || 0;

    const update = { $setOnInsert: { store: storeId, product: product._id, isAvailable: true } };
    if (delta > 0) update.$inc = { stockQty: delta };
    if (priceOverride !== undefined) update.$set = { priceOverride: priceOverride === '' ? null : Number(priceOverride) };

    const storeProduct = await ExpressStoreProduct.findOneAndUpdate(
      { store: storeId, product: product._id },
      update,
      { new: true, upsert: true, runValidators: true }
    );

    if (delta > 0) {
      await ExpressStockLog.create({
        store: storeId, product: product._id, type: 'addition',
        qty: delta, previousQty, newQty: storeProduct.stockQty,
        reason: note || null, actorType: 'admin', actorName: req.user?.name || 'Admin',
      });
    }
    await logAudit({
      actorType: 'admin', actorName: req.user?.name || 'Admin', action: 'store-product.assign',
      store: storeId, meta: { productId: product._id, stockQty: delta, priceOverride },
    });

    const populatedProduct = await product.populate('koyambeduProduct', KOYAMBEDU_PRODUCT_FIELDS);
    res.json({ success: true, product: populatedProduct, storeProduct });
  } catch (err) {
    console.error('[express.adminAssignProductToStore]', err);
    fail(res, 500, 'Failed to assign product to store');
  }
};

const updateProduct = async (req, res) => {
  try {
    const { productId } = req.params;
    // koyambeduProduct is intentionally not editable here — to relink a
    // different Koyambedu product, delete and re-create the listing instead.
    const fields = ['unit', 'isWeightBased', 'unitsPerKg', 'procurementBaseCost', 'customMarginPct', 'isActive'];
    const update = {};
    fields.forEach(f => { if (req.body[f] !== undefined) update[f] = req.body[f]; });

    const product = await ExpressProduct.findByIdAndUpdate(productId, update, { new: true, runValidators: true })
      .populate('koyambeduProduct', KOYAMBEDU_PRODUCT_FIELDS);
    if (!product) return fail(res, 404, 'Product not found');
    res.json({ success: true, product });
  } catch (err) {
    console.error('[express.updateProduct]', err);
    fail(res, 500, 'Failed to update product');
  }
};

const deleteProduct = async (req, res) => {
  try {
    const { productId } = req.params;
    const product = await ExpressProduct.findByIdAndDelete(productId);
    if (!product) return fail(res, 404, 'Product not found');
    await ExpressStoreProduct.deleteMany({ product: productId });
    res.json({ success: true, message: 'Product deleted' });
  } catch (err) {
    console.error('[express.deleteProduct]', err);
    fail(res, 500, 'Failed to delete product');
  }
};

// Preview the computed selling price for a product (admin-facing, so they
// can sanity-check the margin engine before it goes live for customers)
const previewPrice = async (req, res) => {
  try {
    const { productId } = req.params;
    const quantity = Number(req.query.quantity) || 1;
    const product = await ExpressProduct.findById(productId).lean();
    if (!product) return fail(res, 404, 'Product not found');
    const marginConfig = await getOrCreateMarginConfig();
    const breakdown = computeSellingPrice(product, marginConfig, quantity);
    res.json({ success: true, breakdown });
  } catch (err) {
    console.error('[express.previewPrice]', err);
    fail(res, 500, 'Failed to compute price preview');
  }
};

// ── Store Products (per-store availability + stock) ─────────────────────

const listStoreProducts = async (req, res) => {
  try {
    const { storeId } = req.params;
    const storeProducts = await ExpressStoreProduct.find({ store: storeId })
      .populate({ path: 'product', populate: { path: 'koyambeduProduct', select: KOYAMBEDU_PRODUCT_FIELDS } })
      .sort({ createdAt: -1 })
      .lean();
    res.json({ success: true, storeProducts });
  } catch (err) {
    console.error('[express.listStoreProducts]', err);
    fail(res, 500, 'Failed to load store products');
  }
};

// Upsert — link a product to a store (or update its stock/availability)
const upsertStoreProduct = async (req, res) => {
  try {
    const { storeId } = req.params;
    const { productId, isAvailable, stockQty } = req.body;
    if (!productId) return fail(res, 400, 'productId is required');

    const update = {};
    if (isAvailable != null) update.isAvailable = isAvailable;
    if (stockQty != null) update.stockQty = stockQty;

    const storeProduct = await ExpressStoreProduct.findOneAndUpdate(
      { store: storeId, product: productId },
      { $set: update, $setOnInsert: { store: storeId, product: productId } },
      { new: true, upsert: true, runValidators: true }
    );
    res.json({ success: true, storeProduct });
  } catch (err) {
    console.error('[express.upsertStoreProduct]', err);
    fail(res, 500, 'Failed to update store product');
  }
};

// Fully remove a product's allocation at a store — distinct from setting
// isAvailable:false (which just hides it from customers/POS while keeping
// the stock record); this deletes the ExpressStoreProduct row entirely, for
// when admin wants to un-stock a product at a store completely.
const removeStoreProduct = async (req, res) => {
  try {
    const { storeId, productId } = req.params;
    const removed = await ExpressStoreProduct.findOneAndDelete({ store: storeId, product: productId });
    if (!removed) return fail(res, 404, 'This product is not allocated to that store');
    await logAudit({
      actorType: 'admin', actorName: req.user?.name || 'Admin',
      action: 'store-product.remove', store: storeId, meta: { productId },
    });
    res.json({ success: true, message: 'Product removed from store inventory' });
  } catch (err) {
    console.error('[express.removeStoreProduct]', err);
    fail(res, 500, 'Failed to remove product from store');
  }
};

// Add stock — ADDS to whatever the store already has (procurement arriving),
// rather than overwriting it, so repeated deliveries accumulate correctly.
// Distinct from upsertStoreProduct (which still exists for direct
// availability toggling / one-off corrections to an exact quantity).
const addStock = async (req, res) => {
  try {
    const { storeId, productId } = req.params;
    const { qty, note } = req.body;
    const delta = Number(qty);
    if (!Number.isFinite(delta) || delta <= 0) return fail(res, 400, 'qty must be a positive number');

    const existing = await ExpressStoreProduct.findOne({ store: storeId, product: productId }).lean();
    const previousQty = existing?.stockQty || 0;

    const storeProduct = await ExpressStoreProduct.findOneAndUpdate(
      { store: storeId, product: productId },
      { $inc: { stockQty: delta }, $setOnInsert: { store: storeId, product: productId, isAvailable: true } },
      { new: true, upsert: true, runValidators: true }
    );

    await ExpressStockLog.create({
      store: storeId, product: productId, type: 'addition',
      qty: delta, previousQty, newQty: storeProduct.stockQty,
      reason: note || null, actorType: 'admin', actorName: req.user?.name || 'Admin',
    });
    await logAudit({
      actorType: 'admin', actorName: req.user?.name || 'Admin', action: 'stock.add',
      store: storeId, meta: { productId, qty: delta, newQty: storeProduct.stockQty },
    });

    res.json({ success: true, storeProduct });
  } catch (err) {
    console.error('[express.addStock]', err);
    fail(res, 500, 'Failed to add stock');
  }
};

// Report of every manual stock movement (admin additions + store manager
// losses) — the "report" the admin asked for alongside stock allocation.
const listStockLogs = async (req, res) => {
  try {
    const { storeId, productId, type, limit = 100 } = req.query;
    const filter = {};
    if (storeId) filter.store = storeId;
    if (productId) filter.product = productId;
    if (type) filter.type = type;

    const logs = await ExpressStockLog.find(filter)
      .populate('store', 'name code')
      .populate({ path: 'product', populate: { path: 'koyambeduProduct', select: 'name' } })
      .sort({ createdAt: -1 })
      .limit(Math.min(Number(limit) || 100, 500))
      .lean();
    res.json({ success: true, logs });
  } catch (err) {
    console.error('[express.listStockLogs]', err);
    fail(res, 500, 'Failed to load stock report');
  }
};

// ── Margin Config ────────────────────────────────────────────────────────

async function getOrCreateMarginConfig() {
  let config = await ExpressMarginConfig.findOne({ key: 'default' });
  if (!config) config = await ExpressMarginConfig.create({ key: 'default' });
  return config;
}

const getMarginConfig = async (req, res) => {
  try {
    const config = await getOrCreateMarginConfig();
    res.json({ success: true, config });
  } catch (err) {
    console.error('[express.getMarginConfig]', err);
    fail(res, 500, 'Failed to load margin config');
  }
};

const updateMarginConfig = async (req, res) => {
  try {
    const { platformChargePct, salesmanChargePct, packingChargePct, largeOrderThresholdKg, largeOrderAction, maxDeliveryDistanceKm } = req.body;
    const update = { updatedBy: req.user?.name || 'Admin' };
    if (platformChargePct != null) update.platformChargePct = platformChargePct;
    if (salesmanChargePct != null) update.salesmanChargePct = salesmanChargePct;
    if (packingChargePct != null) update.packingChargePct = packingChargePct;
    if (largeOrderThresholdKg != null) update.largeOrderThresholdKg = largeOrderThresholdKg;
    if (largeOrderAction != null) update.largeOrderAction = largeOrderAction;
    if (maxDeliveryDistanceKm != null) update.maxDeliveryDistanceKm = maxDeliveryDistanceKm;

    const config = await ExpressMarginConfig.findOneAndUpdate(
      { key: 'default' }, update, { new: true, upsert: true, runValidators: true }
    );
    res.json({ success: true, config });
  } catch (err) {
    console.error('[express.updateMarginConfig]', err);
    fail(res, 500, 'Failed to update margin config');
  }
};

// Section 19 — master ON/OFF switch for the whole Express vertical
const toggleExpressEnabled = async (req, res) => {
  try {
    const config = await getOrCreateMarginConfig();
    config.isEnabled = !config.isEnabled;
    config.updatedBy = req.user?.name || 'Admin';
    await config.save();
    await logAudit({ actorType: 'admin', actorName: req.user?.name || 'Admin', action: config.isEnabled ? 'express.enable' : 'express.disable' });
    res.json({ success: true, config });
  } catch (err) {
    console.error('[express.toggleExpressEnabled]', err);
    fail(res, 500, 'Failed to toggle Eptomart Express');
  }
};

// Recompute logistics ₹/kg from the latest per-store shipment costs (section 2)
const recomputeLogisticsCost = async (req, res) => {
  try {
    const { storeCosts, totalProcurementKg } = req.body; // storeCosts: [{ store, cost }]
    if (!Array.isArray(storeCosts) || !totalProcurementKg) {
      return fail(res, 400, 'storeCosts (array) and totalProcurementKg are required');
    }
    const logisticsCostPerKg = computeLogisticsCostPerKg(storeCosts, totalProcurementKg);
    const config = await ExpressMarginConfig.findOneAndUpdate(
      { key: 'default' },
      {
        logisticsCostPerKg,
        logisticsInputs: { storeCosts, totalProcurementKg, updatedAt: new Date() },
        updatedBy: req.user?.name || 'Admin',
      },
      { new: true, upsert: true, runValidators: true }
    );
    res.json({ success: true, config });
  } catch (err) {
    console.error('[express.recomputeLogisticsCost]', err);
    fail(res, 500, 'Failed to recompute logistics cost');
  }
};

// ── Inventory Requests ───────────────────────────────────────────────────

const listInventoryRequests = async (req, res) => {
  try {
    const { status } = req.query;
    const filter = status ? { status } : {};
    const requests = await ExpressInventoryRequest.find(filter)
      .populate('store', 'name code')
      .populate({ path: 'items.product', select: 'unit', populate: { path: 'koyambeduProduct', select: 'name' } })
      .sort({ createdAt: -1 })
      .lean();
    res.json({ success: true, requests });
  } catch (err) {
    console.error('[express.listInventoryRequests]', err);
    fail(res, 500, 'Failed to load inventory requests');
  }
};

const approveInventoryRequest = async (req, res) => {
  try {
    const { requestId } = req.params;
    const { items } = req.body; // optional: [{ product, allocatedQty }] overrides
    const request = await ExpressInventoryRequest.findById(requestId);
    if (!request) return fail(res, 404, 'Inventory request not found');
    if (request.status !== 'pending') return fail(res, 400, 'Request has already been processed');

    // Validate every allocation up front — before touching any stock — so a
    // bad value on one line can't leave earlier lines partially applied.
    const resolved = request.items.map(item => {
      const override = items?.find(i => String(i.product) === String(item.product));
      return { item, allocatedQty: override?.allocatedQty ?? item.requestedQty };
    });
    for (const { allocatedQty } of resolved) {
      if (!Number.isFinite(Number(allocatedQty)) || Number(allocatedQty) < 0) {
        return fail(res, 400, 'Invalid allocated quantity for one of the items');
      }
    }

    // Apply allocation — default to requestedQty unless admin overrode it
    for (const { item, allocatedQty } of resolved) {
      item.allocatedQty = allocatedQty;
      await ExpressStoreProduct.findOneAndUpdate(
        { store: request.store, product: item.product },
        { $inc: { stockQty: allocatedQty }, $setOnInsert: { store: request.store, product: item.product } },
        { upsert: true }
      );
    }

    request.status = 'approved';
    request.approvedByName = req.user?.name || 'Admin';
    request.approvedAt = new Date();
    await request.save();

    await logAudit({ actorType: 'admin', actorName: req.user?.name || 'Admin', action: 'inventory.approve', store: request.store, meta: { requestId: request._id } });
    res.json({ success: true, request });
  } catch (err) {
    console.error('[express.approveInventoryRequest]', err);
    fail(res, 500, 'Failed to approve inventory request');
  }
};

const rejectInventoryRequest = async (req, res) => {
  try {
    const { requestId } = req.params;
    const { reason } = req.body;
    const request = await ExpressInventoryRequest.findByIdAndUpdate(
      requestId,
      { status: 'rejected', rejectionReason: reason || null, approvedByName: req.user?.name || 'Admin', approvedAt: new Date() },
      { new: true }
    );
    if (!request) return fail(res, 404, 'Inventory request not found');
    res.json({ success: true, request });
  } catch (err) {
    console.error('[express.rejectInventoryRequest]', err);
    fail(res, 500, 'Failed to reject inventory request');
  }
};

// ── Audit Log ────────────────────────────────────────────────────────────

const listAuditLog = async (req, res) => {
  try {
    const { storeId, limit = 100 } = req.query;
    const filter = storeId ? { store: storeId } : {};
    const logs = await ExpressAuditLog.find(filter)
      .populate('store', 'name code')
      .sort({ createdAt: -1 })
      .limit(Math.min(Number(limit) || 100, 500))
      .lean();
    res.json({ success: true, logs });
  } catch (err) {
    console.error('[express.listAuditLog]', err);
    fail(res, 500, 'Failed to load audit log');
  }
};

// ── Expenses ─────────────────────────────────────────────────────────────

const listExpenses = async (req, res) => {
  try {
    const { storeId, from, to, limit = 200 } = req.query;
    const filter = {};
    if (storeId) filter.store = storeId;
    if (from || to) {
      filter.date = {};
      if (from) filter.date.$gte = new Date(from);
      if (to) filter.date.$lte = new Date(to);
    }
    const expenses = await ExpressExpense.find(filter)
      .populate('store', 'name code')
      .sort({ date: -1 })
      .limit(Math.min(Number(limit) || 200, 1000))
      .lean();
    res.json({ success: true, expenses });
  } catch (err) {
    console.error('[express.listExpenses]', err);
    fail(res, 500, 'Failed to load expenses');
  }
};

const createExpense = async (req, res) => {
  try {
    const { storeId, category, amount, note, date } = req.body;
    if (amount == null || !Number.isFinite(Number(amount)) || Number(amount) < 0) {
      return fail(res, 400, 'A valid amount is required');
    }
    const expense = await ExpressExpense.create({
      store: storeId || null,
      category: category || 'other',
      amount: Number(amount),
      note: note || '',
      date: date ? new Date(date) : new Date(),
      enteredByName: req.user?.name || 'Admin',
    });
    await logAudit({ actorType: 'admin', actorName: req.user?.name || 'Admin', action: 'expense.create', store: storeId || null, meta: { category, amount } });
    res.status(201).json({ success: true, expense });
  } catch (err) {
    console.error('[express.createExpense]', err);
    fail(res, 500, 'Failed to record expense');
  }
};

const deleteExpense = async (req, res) => {
  try {
    const { expenseId } = req.params;
    const expense = await ExpressExpense.findByIdAndDelete(expenseId);
    if (!expense) return fail(res, 404, 'Expense not found');
    res.json({ success: true, message: 'Expense deleted' });
  } catch (err) {
    console.error('[express.deleteExpense]', err);
    fail(res, 500, 'Failed to delete expense');
  }
};

// ── Finance Dashboard (profit / loss) ────────────────────────────────────
// Revenue = paid online orders + completed POS bills, in range.
// COGS = current procurement+logistics cost per unit (from the pricing
// engine) x quantity sold — an approximation since it uses today's cost
// rather than a historical snapshot, same tradeoff every other part of this
// vertical already makes (prices aren't versioned either).
// Loss value = same per-unit cost basis x quantity reported as wastage.
// Profit = Revenue - COGS - Loss value - Other expenses.
const getFinanceDashboard = async (req, res) => {
  try {
    const { from, to, storeId } = req.query;
    const dateFilter = {};
    if (from) dateFilter.$gte = new Date(from);
    if (to) dateFilter.$lte = new Date(to);
    const hasRange = from || to;

    const marginConfig = await getOrCreateMarginConfig();

    const orderFilter = { paymentStatus: 'paid', isDemoOrder: { $ne: true } };
    if (storeId) orderFilter.store = storeId;
    if (hasRange) orderFilter.createdAt = dateFilter;

    const billFilter = { status: 'completed' };
    if (storeId) billFilter.store = storeId;
    if (hasRange) billFilter.completedAt = dateFilter;

    const lossFilter = { type: 'loss' };
    if (storeId) lossFilter.store = storeId;
    if (hasRange) lossFilter.createdAt = dateFilter;

    const expenseFilter = {};
    if (storeId) expenseFilter.store = storeId;
    if (hasRange) expenseFilter.date = dateFilter;

    const [orders, bills, lossLogs, expenses] = await Promise.all([
      ExpressOrder.find(orderFilter).populate('items.product').lean(),
      ExpressBill.find(billFilter).populate('items.product').lean(),
      ExpressStockLog.find(lossFilter).populate('product').lean(),
      ExpressExpense.find(expenseFilter).lean(),
    ]);

    const costPerUnit = (product, qty) => {
      if (!product) return 0;
      return computeSellingPrice(product, marginConfig, qty || 1).baseCostPerUnit;
    };

    let onlineRevenue = 0, posRevenue = 0, cogs = 0;
    for (const o of orders) {
      onlineRevenue += o.pricing?.total || 0;
      for (const it of o.items || []) cogs += costPerUnit(it.product, 1) * (it.quantity || 0);
    }
    for (const b of bills) {
      posRevenue += b.total || 0;
      for (const it of b.items || []) cogs += costPerUnit(it.product, 1) * (it.quantity || 0);
    }

    let lossValue = 0;
    for (const l of lossLogs) lossValue += costPerUnit(l.product, 1) * (l.qty || 0);

    const otherExpenses = expenses.reduce((s, e) => s + (e.amount || 0), 0);

    const revenue = Math.round((onlineRevenue + posRevenue) * 100) / 100;
    cogs = Math.round(cogs * 100) / 100;
    lossValue = Math.round(lossValue * 100) / 100;
    const netProfit = Math.round((revenue - cogs - lossValue - otherExpenses) * 100) / 100;

    res.json({ success: true, finance: {
      onlineRevenue: Math.round(onlineRevenue * 100) / 100,
      posRevenue: Math.round(posRevenue * 100) / 100,
      revenue, cogs, lossValue, otherExpenses,
      netProfit,
      onlineOrderCount: orders.length,
      posBillCount: bills.length,
      lossEntryCount: lossLogs.length,
    }});
  } catch (err) {
    console.error('[express.getFinanceDashboard]', err);
    fail(res, 500, 'Failed to load finance dashboard');
  }
};

// ── Visitors + Carts (mirrors fruitBasketController's adminGetVisitors /
// adminGetUserCarts patterns — same shared Analytics collection, same
// per-vertical path-prefix filter, same cart-value aggregation shape) ────

const adminGetVisitors = async (req, res) => {
  try {
    const { limit = 50 } = req.query;
    const visits = await Analytics.find({ page: { $regex: '^/express', $options: 'i' }, isBot: { $ne: true } })
      .populate('userId', 'name phone email')
      .sort({ timestamp: -1 })
      .limit(Math.min(200, Number(limit) || 50))
      .lean();

    res.json({ success: true, visits: visits.map(v => ({
      _id: v._id,
      page: v.page,
      device: v.device || null,
      browser: v.browser || null,
      city: v.city || null,
      country: v.country || null,
      user: v.userId ? { name: v.userId.name, phone: v.userId.phone, email: v.userId.email } : null,
      timestamp: v.timestamp,
    })) });
  } catch (err) {
    console.error('[express.adminGetVisitors]', err);
    fail(res, 500, 'Failed to load visitors');
  }
};

const adminGetCarts = async (req, res) => {
  try {
    const { search } = req.query;

    const carts = await ExpressCart.find({ 'items.0': { $exists: true } })
      .populate('user', 'name email phone')
      .populate('store', 'name code')
      .sort({ updatedAt: -1 })
      .lean();

    let result = carts
      .filter(c => c.user)
      .map(c => {
        const items = (c.items || []).filter(it => (it.quantity || 0) > 0);
        const cartValue = items.reduce((s, it) => s + (it.price || 0) * (it.quantity || 0), 0);
        return {
          _id: c._id,
          customerName: c.user?.name || 'Unknown',
          phone: c.user?.phone || '—',
          email: c.user?.email || '—',
          store: c.store?.name || 'Unknown store',
          itemCount: items.length,
          cartValue: Math.round(cartValue * 100) / 100,
          updatedAt: c.updatedAt,
          items: items.map(it => ({ name: it.name, unit: it.unit, quantity: it.quantity, price: it.price })),
        };
      })
      .filter(c => c.itemCount > 0);

    if (search) {
      const q = String(search).toLowerCase();
      result = result.filter(c =>
        c.customerName.toLowerCase().includes(q) ||
        c.phone.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q)
      );
    }

    res.json({ success: true, carts: result, count: result.length });
  } catch (err) {
    console.error('[express.adminGetCarts]', err);
    fail(res, 500, 'Failed to load carts');
  }
};

module.exports = {
  listStores, createStore, updateStore, toggleStoreActive, archiveStore,
  listStoreManagers, createStoreManager, updateStoreManager,
  listPOSUsers, createPOSUser, updatePOSUser,
  listProducts, createProduct, updateProduct, deleteProduct, previewPrice, searchKoyambeduCatalog,
  adminSetProductPlu, adminAssignProductToStore,
  listStoreProducts, upsertStoreProduct, removeStoreProduct, addStock, listStockLogs,
  getMarginConfig, updateMarginConfig, toggleExpressEnabled, recomputeLogisticsCost,
  listInventoryRequests, approveInventoryRequest, rejectInventoryRequest,
  listAuditLog,
  listExpenses, createExpense, deleteExpense,
  getFinanceDashboard, adminGetVisitors, adminGetCarts,
};
