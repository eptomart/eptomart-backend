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
const ExpressOnlineListing   = require('../models/ExpressOnlineListing');
const ExpressBanner          = require('../models/ExpressBanner');
const ExpressHoldWaitlist    = require('../models/ExpressHoldWaitlist');
const KoyambeduProduct       = require('../models/KoyambeduProduct');
const KoyambeduCategory      = require('../models/KoyambeduCategory');
const Analytics              = require('../models/Analytics');
const { computeLogisticsCostPerKg, computeSellingPrice } = require('../services/expressPricingService');
// Reuses the same Claude helper already powering the seller product-
// description generator (aiController.js) and the Fruit Basket admin one
// (fruitBasketController.js) — no new SDK, no new env var.
const { callClaude } = require('../utils/claudeApi');

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

    // Pending (not-yet-called-back) hold-waitlist count per store, so the
    // Hold button can show "3 waiting" right in the store list without a
    // separate request per store.
    const counts = await ExpressHoldWaitlist.aggregate([
      { $match: { calledBack: false } },
      { $group: { _id: '$store', count: { $sum: 1 } } },
    ]);
    const countByStore = new Map(counts.map(c => [String(c._id), c.count]));
    stores.forEach(s => { s.pendingWaitlistCount = countByStore.get(String(s._id)) || 0; });

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

// Temporary "hold" — for a surge of existing orders, not a real closure
// (that's toggleStoreActive). The store stays visible everywhere (store
// list, online catalogue) and customers can keep browsing + adding to
// cart as normal; only checkout is gated with a "high demand, opening
// again shortly" message until this is turned off. An optional custom
// message can be set when pausing; it's cleared on resume. Every customer
// who hits that checkout gate gets logged to ExpressHoldWaitlist (see
// getHoldWaitlist below) so Admin knows exactly who to call back.
const togglePauseStore = async (req, res) => {
  try {
    const { storeId } = req.params;
    const { message } = req.body || {};
    const store = await ExpressStore.findById(storeId);
    if (!store) return fail(res, 404, 'Store not found');

    store.isPaused = !store.isPaused;
    store.pauseMessage = store.isPaused ? (message || null) : null;
    await store.save();

    await logAudit({
      actorType: 'admin', actorName: req.user?.name || 'Admin',
      action: store.isPaused ? 'store.pause' : 'store.resume', store: store._id,
    });
    res.json({ success: true, store });
  } catch (err) {
    console.error('[express.togglePauseStore]', err);
    fail(res, 500, 'Failed to update store hold status');
  }
};

// PATCH /express/admin/stores/:storeId/delivery-slots — per-store delivery
// slot configuration: which same-day time windows are enabled (and their
// labels/hours, editable per store), plus whether this store also offers
// next-day delivery. Entirely separate from togglePauseStore above — this
// controls what windows are ever offered, not a temporary pause.
const updateDeliverySlots = async (req, res) => {
  try {
    const { storeId } = req.params;
    const { windows, nextDayEnabled } = req.body || {};

    const store = await ExpressStore.findById(storeId);
    if (!store) return fail(res, 404, 'Store not found');

    if (Array.isArray(windows)) {
      const clean = windows
        .map(w => ({
          startHour: Number(w.startHour),
          endHour: Number(w.endHour),
          label: String(w.label || '').trim(),
          enabled: !!w.enabled,
        }))
        .filter(w => w.label && Number.isFinite(w.startHour) && Number.isFinite(w.endHour) && w.endHour > w.startHour);
      if (!clean.length) return fail(res, 400, 'At least one valid delivery window is required');
      store.deliverySlots.windows = clean;
    }
    if (nextDayEnabled !== undefined) {
      store.deliverySlots.nextDayEnabled = !!nextDayEnabled;
    }
    await store.save();

    await logAudit({
      actorType: 'admin', actorName: req.user?.name || 'Admin',
      action: 'store.deliverySlots.update', store: store._id,
      meta: { nextDayEnabled: store.deliverySlots.nextDayEnabled, windowCount: store.deliverySlots.windows.length },
    });
    res.json({ success: true, store });
  } catch (err) {
    console.error('[express.updateDeliverySlots]', err);
    fail(res, 500, 'Failed to update delivery slots');
  }
};

// PATCH /express/admin/stores/:storeId/delivery-fee — per-store minimum-
// order delivery fee rule. Applies irrespective of the customer's distance
// from the store (that's a deliberate business rule — see
// expressPricingService.computeDeliveryFee) — this only controls the
// rupee thresholds, not any distance-based exemption.
const updateDeliveryFeeConfig = async (req, res) => {
  try {
    const { storeId } = req.params;
    const { minOrderForFreeDelivery, deliveryFeeBelowMinimum } = req.body || {};

    const store = await ExpressStore.findById(storeId);
    if (!store) return fail(res, 404, 'Store not found');

    if (minOrderForFreeDelivery !== undefined) {
      const v = Number(minOrderForFreeDelivery);
      if (!Number.isFinite(v) || v < 0) return fail(res, 400, 'minOrderForFreeDelivery must be a non-negative number');
      store.deliveryFeeConfig.minOrderForFreeDelivery = v;
    }
    if (deliveryFeeBelowMinimum !== undefined) {
      const v = Number(deliveryFeeBelowMinimum);
      if (!Number.isFinite(v) || v < 0) return fail(res, 400, 'deliveryFeeBelowMinimum must be a non-negative number');
      store.deliveryFeeConfig.deliveryFeeBelowMinimum = v;
    }
    await store.save();

    await logAudit({
      actorType: 'admin', actorName: req.user?.name || 'Admin',
      action: 'store.deliveryFee.update', store: store._id,
      meta: { ...store.deliveryFeeConfig.toObject() },
    });
    res.json({ success: true, store });
  } catch (err) {
    console.error('[express.updateDeliveryFeeConfig]', err);
    fail(res, 500, 'Failed to update delivery fee rule');
  }
};

// GET /express/admin/stores/:storeId/hold-waitlist — everyone who hit the
// checkout gate while this store was on hold, newest attempt first, so
// Admin can call them back once the store reopens. Doesn't auto-clear on
// resume (the whole point is to survive past the hold) — Admin ticks off
// "Called back" per person once they've actually rung them.
const getHoldWaitlist = async (req, res) => {
  try {
    const { storeId } = req.params;
    const entries = await ExpressHoldWaitlist.find({ store: storeId })
      .sort({ calledBack: 1, lastAttemptAt: -1 })
      .lean();
    res.json({ success: true, entries, pendingCount: entries.filter(e => !e.calledBack).length });
  } catch (err) {
    console.error('[express.getHoldWaitlist]', err);
    fail(res, 500, 'Failed to load hold waitlist');
  }
};

// PATCH /express/admin/hold-waitlist/:entryId/called-back — mark (or
// un-mark) that Admin has rung this customer back.
const markWaitlistCalledBack = async (req, res) => {
  try {
    const { entryId } = req.params;
    const { calledBack = true } = req.body || {};
    const entry = await ExpressHoldWaitlist.findByIdAndUpdate(
      entryId,
      { calledBack: !!calledBack, calledBackAt: calledBack ? new Date() : null },
      { new: true }
    );
    if (!entry) return fail(res, 404, 'Entry not found');
    res.json({ success: true, entry });
  } catch (err) {
    console.error('[express.markWaitlistCalledBack]', err);
    fail(res, 500, 'Failed to update entry');
  }
};

// Separate from toggleStoreActive above — this only hides/shows the store
// in the customer-facing online Express shop (store list + online
// catalogue). POS, the manager dashboard and inventory are unaffected.
const toggleOnlineShop = async (req, res) => {
  try {
    const { storeId } = req.params;
    const store = await ExpressStore.findById(storeId);
    if (!store) return fail(res, 404, 'Store not found');

    store.onlineShopEnabled = !store.onlineShopEnabled;
    await store.save();

    await logAudit({
      actorType: 'admin', actorName: req.user?.name || 'Admin',
      action: store.onlineShopEnabled ? 'store.online_shop_enable' : 'store.online_shop_disable', store: store._id,
    });
    res.json({ success: true, store });
  } catch (err) {
    console.error('[express.toggleOnlineShop]', err);
    fail(res, 500, 'Failed to update online shop status');
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
      isWeightBased, unitsPerKg, procurementBaseCost, customMarginPct,
      plu: plu || undefined, // omit rather than null — keeps the sparse unique index happy
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
      // $unset, not $set: null — a sparse unique index only skips documents
      // where the field is absent, not ones explicitly set to null.
      const product = await ExpressProduct.findByIdAndUpdate(productId, { $unset: { plu: 1 } }, { new: true });
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
        isWeightBased, unitsPerKg, procurementBaseCost, customMarginPct,
        plu: plu || undefined, // omit rather than null — keeps the sparse unique index happy
      });
    }

    const delta = Number(stockQty) || 0;
    if (delta < 0) return fail(res, 400, 'stockQty cannot be negative');

    const existing = await ExpressStoreProduct.findOne({ store: storeId, product: product._id }).lean();
    const previousQty = existing?.stockQty || 0;

    const update = { $setOnInsert: { store: storeId, product: product._id, isAvailable: true } };
    if (delta > 0) update.$inc = { stockQty: delta };
    if (priceOverride !== undefined) update.$set = { priceOverride: priceOverride === '' ? null : Math.round(Number(priceOverride)) }; // whole rupees only

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
    // autoPrice = what the margin engine alone would charge, shown alongside
    // priceOverride so admin can see both when deciding whether/how to round
    // off the selling price manually.
    const marginConfig = await getOrCreateMarginConfig();
    const withAutoPrice = storeProducts.map(sp => ({
      ...sp,
      autoPrice: sp.product ? computeSellingPrice(sp.product, marginConfig, 1).sellingPricePerUnit : null,
    }));
    res.json({ success: true, storeProducts: withAutoPrice });
  } catch (err) {
    console.error('[express.listStoreProducts]', err);
    fail(res, 500, 'Failed to load store products');
  }
};

// Printable "PLU cheat sheet" for a store — same name/unit/plu/price shape
// and same price computation (priceOverride, else the margin engine) that
// the POS terminal itself uses, so what's printed always matches what the
// POS screen shows. Used by ExpressAdmin.jsx's "Print PLU List" button.
const listStoreProductsForPrint = async (req, res) => {
  try {
    const { storeId } = req.params;
    const marginConfig = await getOrCreateMarginConfig();
    const storeProducts = await ExpressStoreProduct.find({ store: storeId })
      .populate({ path: 'product', populate: { path: 'koyambeduProduct', select: 'name' } })
      .lean();
    const products = storeProducts
      .filter(sp => sp.product?.koyambeduProduct)
      .map(sp => ({
        name: sp.product.koyambeduProduct.name,
        unit: sp.product.unit,
        plu: sp.product.plu ?? null,
        price: sp.priceOverride ?? computeSellingPrice(sp.product, marginConfig, 1).sellingPricePerUnit,
      }));
    res.json({ success: true, products });
  } catch (err) {
    console.error('[express.listStoreProductsForPrint]', err);
    fail(res, 500, 'Failed to load print list');
  }
};

// Upsert — link a product to a store (or update its stock/availability)
const upsertStoreProduct = async (req, res) => {
  try {
    const { storeId } = req.params;
    const { productId, isAvailable, stockQty, priceOverride } = req.body;
    if (!productId) return fail(res, 400, 'productId is required');

    const update = {};
    if (isAvailable != null) update.isAvailable = isAvailable;
    if (stockQty != null) update.stockQty = stockQty;
    // priceOverride: manually round off the selling price for this product at
    // this store, overriding the margin-engine-computed price. Sending ''
    // (empty string) clears it back to automatic. Sending null/undefined
    // (the field simply omitted) leaves whatever is already saved untouched
    // — same "only touch what's provided" behaviour as isAvailable/stockQty.
    if (priceOverride !== undefined) update.priceOverride = priceOverride === '' ? null : Math.round(Number(priceOverride)); // whole rupees only

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
    const {
      platformChargePct, salesmanChargePct, packingChargePct, largeOrderThresholdKg, largeOrderAction, maxDeliveryDistanceKm,
      freeDeliveryRadiusKm, minOrderForFreeDelivery, deliveryFeeBelowMinimum, customOrderPhone, deliveryTimeTiers,
    } = req.body;
    const update = { updatedBy: req.user?.name || 'Admin' };
    if (platformChargePct != null) update.platformChargePct = platformChargePct;
    if (salesmanChargePct != null) update.salesmanChargePct = salesmanChargePct;
    if (packingChargePct != null) update.packingChargePct = packingChargePct;
    if (largeOrderThresholdKg != null) update.largeOrderThresholdKg = largeOrderThresholdKg;
    if (largeOrderAction != null) update.largeOrderAction = largeOrderAction;
    if (maxDeliveryDistanceKm != null) update.maxDeliveryDistanceKm = maxDeliveryDistanceKm;
    if (freeDeliveryRadiusKm != null) update.freeDeliveryRadiusKm = freeDeliveryRadiusKm;
    if (minOrderForFreeDelivery != null) update.minOrderForFreeDelivery = minOrderForFreeDelivery;
    if (deliveryFeeBelowMinimum != null) update.deliveryFeeBelowMinimum = deliveryFeeBelowMinimum;
    if (customOrderPhone !== undefined) update.customOrderPhone = customOrderPhone || null;
    // Admin-configurable distance -> ETA tiers (see ExpressMarginConfig.js).
    // Validate shape + sort ascending by distance so computeDeliveryEta can
    // rely on a sane ordering without re-sorting on every lookup.
    if (Array.isArray(deliveryTimeTiers)) {
      const cleaned = deliveryTimeTiers
        .map(t => ({ maxDistanceKm: Number(t.maxDistanceKm), etaMinutes: Number(t.etaMinutes) }))
        .filter(t => Number.isFinite(t.maxDistanceKm) && t.maxDistanceKm > 0 && Number.isFinite(t.etaMinutes) && t.etaMinutes > 0)
        .sort((a, b) => a.maxDistanceKm - b.maxDistanceKm);
      if (!cleaned.length) return fail(res, 400, 'Add at least one valid delivery time tier');
      update.deliveryTimeTiers = cleaned;
    }

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

// ── Online Catalog (per-store "show online?" + price) ─────────────────────
// Deliberately NOT part of the Products/StoreInventory flow above — this is
// a pure admin-curation decision over the FULL Koyambedu Daily catalog
// (every active product is a candidate for every store, no "link into
// Express" step needed first), kept in its own collection
// (ExpressOnlineListing) so it never touches store stock, the manager
// dashboard, or the POS terminal.

// Koyambedu's unit vocabulary is broader than Express's; map it down to the
// closest Express unit so quantity logic (isWeightBased, kg-stepper, etc.)
// keeps working for products that have never been manually linked before.
const KOYAMBEDU_TO_EXPRESS_UNIT = {
  kg: 'kg', g: 'gram', piece: 'piece', bunch: 'bunch', dozen: 'dozen', litre: 'litre',
  pack: 'piece', leaf: 'piece', box: 'piece', bag: 'piece', crate: 'piece',
};
const WEIGHT_BASED_EXPRESS_UNITS = new Set(['kg', 'gram', 'litre']);

// Default markup applied to a product's online listing price when the admin
// enables it without typing a price of their own. Admin can always type a
// different number — that always wins over this default.
const DEFAULT_ONLINE_MARKUP_PERCENT = 15;
// Whole rupees only — no paise — on every Express item price, per admin
// preference.
function defaultOnlineListingPrice(wholesalePrice) {
  return Math.round((wholesalePrice || 0) * (1 + DEFAULT_ONLINE_MARKUP_PERCENT / 100));
}

// Looks up (or, the first time a product is enabled online, creates) the
// ExpressProduct link for a Koyambedu product — same auto-link pattern as
// adminAssignProductToStore above, reused so the existing (untouched) cart/
// checkout pipeline, which only knows ExpressProduct ids, keeps working.
async function resolveExpressProduct(koyambeduProductId) {
  let product = await ExpressProduct.findOne({ koyambeduProduct: koyambeduProductId });
  if (product) return product;

  const koyambeduProduct = await KoyambeduProduct.findById(koyambeduProductId).lean();
  if (!koyambeduProduct) return null;

  let plu = null;
  const series = await detectPluSeries(koyambeduProduct);
  if (series) plu = await nextFreePlu(series);

  const unit = KOYAMBEDU_TO_EXPRESS_UNIT[koyambeduProduct.unit] || 'kg';
  return ExpressProduct.create({
    koyambeduProduct: koyambeduProductId,
    unit,
    isWeightBased: WEIGHT_BASED_EXPRESS_UNITS.has(unit),
    procurementBaseCost: koyambeduProduct.currentPrice || koyambeduProduct.finalPrice || 0,
    plu: plu || undefined, // omit rather than null — keeps the sparse unique index happy
  });
}

// GET /express/admin/stores/:storeId/online-catalog
// Two kinds of candidate, merged into one list:
//   - every active Koyambedu Daily product (source: 'koyambedu') — unchanged
//     from before, Koyambedu's own price shown only as a wholesale
//     reference point for the admin setting the online price.
//   - every active NATIVE ExpressProduct (source: 'native') — products and
//     combos the Express admin created directly (see createNativeProduct
//     below), which never touch Koyambedu Daily at all.
const adminListOnlineCatalog = async (req, res) => {
  try {
    const { storeId } = req.params;
    const store = await ExpressStore.findById(storeId).lean();
    if (!store) return fail(res, 404, 'Store not found');

    const [koyambeduProducts, nativeProducts, listings] = await Promise.all([
      KoyambeduProduct.find({ isActive: true })
        .select('name unit currentPrice images category')
        .populate('category', 'name')
        .sort({ name: 1 })
        .lean(),
      ExpressProduct.find({ koyambeduProduct: { $exists: false }, isActive: true })
        .select('name unit procurementBaseCost image category isCombo')
        .sort({ name: 1 })
        .lean(),
      ExpressOnlineListing.find({ store: storeId }).lean(),
    ]);

    const listingByKoyambeduProduct = Object.fromEntries(
      listings.filter(l => l.koyambeduProduct).map(l => [String(l.koyambeduProduct), l])
    );
    const listingByProduct = Object.fromEntries(
      listings.filter(l => l.product && !l.koyambeduProduct).map(l => [String(l.product), l])
    );

    const nativeItems = nativeProducts.map(np => {
      const listing = listingByProduct[String(np._id)];
      return {
        source: 'native',
        expressProductId: np._id,
        name: np.name,
        unit: np.unit,
        category: np.category || (np.isCombo ? 'Combo' : null),
        image: np.image || null,
        isCombo: !!np.isCombo,
        wholesalePrice: np.procurementBaseCost || 0,
        isEnabled: listing?.isEnabled || false,
        price: listing?.price ?? null,
      };
    });

    const koyambeduItems = koyambeduProducts.map(kb => {
      const listing = listingByKoyambeduProduct[String(kb._id)];
      return {
        source: 'koyambedu',
        koyambeduProductId: kb._id,
        name: kb.name,
        unit: kb.unit,
        category: kb.category?.name || null,
        image: kb.images?.find(i => i.isPrimary)?.url || kb.images?.[0]?.url || null,
        wholesalePrice: kb.currentPrice || 0,
        isEnabled: listing?.isEnabled || false,
        price: listing?.price ?? null,
      };
    });

    // Native items first so admin notices their just-created product/combo
    // right away instead of scrolling through the whole Koyambedu list.
    res.json({ success: true, store: { _id: store._id, name: store.name }, items: [...nativeItems, ...koyambeduItems] });
  } catch (err) {
    console.error('[express.adminListOnlineCatalog]', err);
    fail(res, 500, 'Failed to load online catalog');
  }
};

// POST /express/admin/products/native — admin creates a standalone product
// or a combo entirely within Express. NEVER touches Koyambedu Daily's
// catalog, collection, or create endpoints in any way — this is a fully
// separate write path from createProduct (Koyambedu-linking) above.
const createNativeProduct = async (req, res) => {
  try {
    const {
      name, description, unit, category, image,
      procurementBaseCost, isWeightBased, unitsPerKg, customMarginPct,
      isCombo, comboContents,
    } = req.body;

    if (!name || !name.trim()) return fail(res, 400, 'Name is required');
    if (procurementBaseCost == null || procurementBaseCost === '') return fail(res, 400, 'Cost price is required');
    if (isCombo && (!Array.isArray(comboContents) || comboContents.length === 0)) {
      return fail(res, 400, 'Add at least one item to the combo');
    }

    // Uniqueness within Express's own native-product namespace only — fully
    // independent of Koyambedu Daily's own name-uniqueness rule.
    const escaped = name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const dup = await ExpressProduct.findOne({
      koyambeduProduct: { $exists: false },
      name: new RegExp(`^${escaped}$`, 'i'),
    }).select('_id').lean();
    if (dup) return fail(res, 400, `A product named "${name.trim()}" already exists in Express`);

    const product = await ExpressProduct.create({
      name: name.trim(),
      description: description || '',
      unit: unit || 'kg',
      category: category || null,
      image: image || null,
      isWeightBased, unitsPerKg,
      procurementBaseCost: Number(procurementBaseCost),
      customMarginPct: customMarginPct || null,
      isCombo: !!isCombo,
      comboContents: isCombo
        ? comboContents.map(c => ({ product: c.product, name: c.name, unit: c.unit, qty: Number(c.qty) || 0 }))
        : [],
      // koyambeduProduct intentionally omitted (not set to null) — see the
      // sparse-index comment in models/ExpressProduct.js.
    });

    await logAudit({
      actorType: 'admin', actorName: req.user?.name || 'Admin',
      action: isCombo ? 'product.create-native-combo' : 'product.create-native',
      meta: { productId: product._id, name: product.name },
    });

    res.status(201).json({ success: true, product });
  } catch (err) {
    if (err.code === 11000) return fail(res, 409, 'A product with this name already exists');
    console.error('[express.createNativeProduct]', err);
    fail(res, 500, 'Failed to create product');
  }
};

// ── AI-assisted description for native products/combos ──────────────────
const EXPRESS_DESCRIPTION_SYSTEM = `You are a copywriter for Eptomart Express, a same-day/quick-commerce delivery store.
Write a short, appetising product description that:
- Opens with a punchy one-sentence hook
- Mentions what's included/key features if given (for a combo, briefly lists what's bundled)
- Uses simple, everyday language — this is for quick grocery/convenience shopping, not a luxury pitch
- Stays between 30 and 60 words
- Does NOT include price, delivery time, or store information
- Uses plain flowing prose only — no markdown, no bullet points, no asterisks
Output ONLY the description text, nothing else.`;

// POST /express/admin/products/generate-description
// body: { name, category, unit, isCombo, comboContents, shortNote }
// Pure text generator — does not touch or save any product; the admin
// still clicks Create Product/Combo separately once happy with the text.
const generateProductDescription = async (req, res) => {
  try {
    const { name, category, unit, isCombo, comboContents, shortNote } = req.body;
    if (!name && !shortNote) {
      return fail(res, 400, 'Give a product name or a short note to generate from');
    }

    const contentsText = isCombo && Array.isArray(comboContents) && comboContents.length
      ? comboContents.map(c => `${c.name}${c.qty ? ` (${c.qty}${c.unit ? ' ' + c.unit : ''})` : ''}`).filter(Boolean).join(', ')
      : '';

    const userPrompt = [
      name     ? `Product name: ${name}` : null,
      category ? `Category: ${category}` : null,
      unit     ? `Sold by: ${unit}` : null,
      isCombo  ? 'This is a combo bundling several items.' : null,
      contentsText ? `What's bundled: ${contentsText}` : null,
      shortNote ? `Admin's short note: ${shortNote}` : null,
    ].filter(Boolean).join('\n');

    const result = await callClaude({
      system: EXPRESS_DESCRIPTION_SYSTEM,
      messages: [{ role: 'user', content: userPrompt }],
      max_tokens: 150,
      temperature: 0.75,
    });
    res.json({ success: true, description: result.text.trim() });
  } catch (err) {
    console.error('[express.generateProductDescription]', err.message);
    fail(res, 503, 'Could not generate description right now. Try again.');
  }
};

// GET /express/admin/products/native/search?search= — for the combo-
// contents picker: search Express's OWN product catalogue (native +
// Koyambedu-linked, either can go in a combo), never Koyambedu Daily's.
const searchExpressProducts = async (req, res) => {
  try {
    const { search = '' } = req.query;
    const filter = { isActive: true };
    const products = await ExpressProduct.find(filter)
      .populate('koyambeduProduct', 'name')
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();

    const withNames = products.map(p => ({
      _id: p._id,
      name: p.koyambeduProduct?.name || p.name || '(unnamed)',
      unit: p.unit,
      isCombo: !!p.isCombo,
    }));

    const needle = search.trim().toLowerCase();
    const filtered = needle ? withNames.filter(p => p.name.toLowerCase().includes(needle)) : withNames;
    res.json({ success: true, products: filtered.slice(0, 20) });
  } catch (err) {
    console.error('[express.searchExpressProducts]', err);
    fail(res, 500, 'Failed to search Express products');
  }
};

// Shared upsert used by both the single and bulk endpoints below. `ref` is
// either { koyambeduProductId } or { expressProductId } (native product) —
// exactly one of the two, never both. The native path never reads or
// writes anything in the KoyambeduProduct collection.
async function upsertOnlineListing(storeId, ref, { isEnabled, price }, userId) {
  // Must be wrapped in $set — a plain object with no atomic operators is
  // rejected (or, on some driver/server combos, applied as a full document
  // replacement) by findOneAndUpdate, which would wipe out this document's
  // required `store`/`koyambeduProduct` fields on every re-save and then
  // collide with the unique index below. This was causing every "Save All"
  // to fail with a 500.
  const set = { updatedAt: new Date(), updatedBy: userId };
  const priceProvided = price !== undefined && price !== null && price !== '';
  if (priceProvided) set.price = Math.round(Number(price)); // whole rupees only — no paise
  if (isEnabled !== undefined) set.isEnabled = !!isEnabled;

  if (ref.expressProductId) {
    // ── Native product/combo — entirely within Express ──────────────────
    const product = await ExpressProduct.findOne({ _id: ref.expressProductId, koyambeduProduct: { $exists: false } }).lean();
    if (!product) throw new Error('Express product not found');
    set.product = product._id;

    if (isEnabled && !priceProvided) {
      const existing = await ExpressOnlineListing.findOne({ store: storeId, product: product._id }).select('price').lean();
      if (!existing?.price) set.price = defaultOnlineListingPrice(product.procurementBaseCost || 0);
    }
    if (isEnabled) {
      const spUpdate = { $setOnInsert: { store: storeId, product: product._id, isAvailable: true, stockQty: 0 } };
      if (set.price != null) spUpdate.$set = { priceOverride: set.price };
      await ExpressStoreProduct.findOneAndUpdate({ store: storeId, product: product._id }, spUpdate, { upsert: true });
    }

    return ExpressOnlineListing.findOneAndUpdate(
      { store: storeId, product: product._id },
      { $set: set, $setOnInsert: { store: storeId, product: product._id } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }

  // ── Koyambedu-linked product — unchanged behaviour ─────────────────────
  const koyambeduProductId = ref.koyambeduProductId;
  if (isEnabled) {
    const product = await resolveExpressProduct(koyambeduProductId);
    if (!product) throw new Error('Koyambedu product not found');
    set.product = product._id;

    // No price typed by the admin — default to the Koyambedu wholesale
    // price plus DEFAULT_ONLINE_MARKUP_PERCENT, so the product is usable
    // online right away. The admin can always type their own price instead,
    // which takes priority over this default.
    if (!priceProvided) {
      const kb = await KoyambeduProduct.findById(koyambeduProductId).select('currentPrice finalPrice').lean();
      set.price = defaultOnlineListingPrice(kb?.currentPrice || kb?.finalPrice || 0);
    }

    // Ensure the cart/checkout pipeline (which reads ExpressStoreProduct)
    // has a row to find — only on first creation (setOnInsert), so an
    // existing manager-managed stock/availability record is never touched.
    // Stock itself is still only ever added via the existing inventory
    // flow; toggling a product online here never adds stock.
    const spUpdate = { $setOnInsert: { store: storeId, product: product._id, isAvailable: true, stockQty: 0 } };
    if (set.price != null) spUpdate.$set = { priceOverride: set.price };
    await ExpressStoreProduct.findOneAndUpdate({ store: storeId, product: product._id }, spUpdate, { upsert: true });
  }

  return ExpressOnlineListing.findOneAndUpdate(
    { store: storeId, koyambeduProduct: koyambeduProductId },
    { $set: set, $setOnInsert: { store: storeId, koyambeduProduct: koyambeduProductId } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

// PATCH /express/admin/stores/:storeId/online-catalog/:koyambeduProductId
// Body: { isEnabled, price }
const adminSetOnlineListing = async (req, res) => {
  try {
    const { storeId, koyambeduProductId } = req.params;
    const listing = await upsertOnlineListing(storeId, { koyambeduProductId }, req.body, req.user?._id);
    res.json({ success: true, listing });
  } catch (err) {
    console.error('[express.adminSetOnlineListing]', err);
    fail(res, 500, err.message || 'Failed to update online listing');
  }
};

// PATCH /express/admin/stores/:storeId/online-catalog/native/:expressProductId
// Body: { isEnabled, price } — same as above, for a native product/combo.
const adminSetNativeOnlineListing = async (req, res) => {
  try {
    const { storeId, expressProductId } = req.params;
    const listing = await upsertOnlineListing(storeId, { expressProductId }, req.body, req.user?._id);
    res.json({ success: true, listing });
  } catch (err) {
    console.error('[express.adminSetNativeOnlineListing]', err);
    fail(res, 500, err.message || 'Failed to update online listing');
  }
};

// PATCH /express/admin/stores/:storeId/online-catalog
// body: { items: [{ koyambeduProductId | expressProductId, isEnabled, price }] }
// One save for the whole catalog screen instead of a click per product —
// each item is either a Koyambedu-linked row or a native Express row.
const adminBulkSetOnlineListing = async (req, res) => {
  try {
    const { storeId } = req.params;
    const { items } = req.body;
    if (!Array.isArray(items) || !items.length) return fail(res, 400, 'items array is required');

    let saved = 0;
    for (const it of items) {
      if (it?.expressProductId) {
        await upsertOnlineListing(storeId, { expressProductId: it.expressProductId }, it, req.user?._id);
      } else if (it?.koyambeduProductId) {
        await upsertOnlineListing(storeId, { koyambeduProductId: it.koyambeduProductId }, it, req.user?._id);
      } else {
        continue;
      }
      saved++;
    }
    res.json({ success: true, saved });
  } catch (err) {
    console.error('[express.adminBulkSetOnlineListing]', err);
    fail(res, 500, err.message || 'Failed to save online catalog');
  }
};

// ══════════════════════════════════════════════
// HERO BANNERS — admin-created promotional banners for the Express
// storefront (flash sale with timings, lowest-price, custom). Scheduling
// (startAt/endAt) is purely a display window; the customer-facing endpoint
// (expressCustomerController.getActiveBanners) filters to only banners
// that are isActive AND currently within their window, so an admin can
// create a flash-sale banner ahead of time and walk away.
// ══════════════════════════════════════════════

// GET /express/admin/banners — admin sees everything, including
// scheduled-but-not-yet-live and expired banners, so they can manage them.
const listBanners = async (req, res) => {
  try {
    const banners = await ExpressBanner.find({}).sort({ sortOrder: 1, createdAt: -1 }).lean();
    res.json({ success: true, banners });
  } catch (err) {
    console.error('[express.listBanners]', err);
    fail(res, 500, 'Failed to load banners');
  }
};

// POST /express/admin/banners (multipart, field "image" optional)
const createBanner = async (req, res) => {
  try {
    const { title, subtitle, type, gradientFrom, gradientTo, linkTo, ctaText, startAt, endAt, isActive, sortOrder } = req.body;
    if (!title || !title.trim()) return fail(res, 400, 'Title is required');

    const banner = await ExpressBanner.create({
      title: title.trim(),
      subtitle: subtitle || '',
      type: type || 'custom',
      image: req.file ? req.file.path : null,
      gradientFrom: gradientFrom || '#4338ca',
      gradientTo: gradientTo || '#7c3aed',
      linkTo: linkTo || '/express/shop',
      ctaText: ctaText || 'Shop Now',
      startAt: startAt || null,
      endAt: endAt || null,
      isActive: isActive !== undefined ? isActive === 'true' || isActive === true : true,
      sortOrder: sortOrder != null ? Number(sortOrder) : 0,
      createdBy: req.user?.name || 'Admin',
    });

    await logAudit({ actorType: 'admin', actorName: req.user?.name || 'Admin', action: 'banner.create', meta: { bannerId: banner._id, title: banner.title } });
    res.status(201).json({ success: true, banner });
  } catch (err) {
    console.error('[express.createBanner]', err);
    fail(res, 500, 'Failed to create banner');
  }
};

// PUT /express/admin/banners/:bannerId (multipart, field "image" optional)
const updateBanner = async (req, res) => {
  try {
    const banner = await ExpressBanner.findById(req.params.bannerId);
    if (!banner) return fail(res, 404, 'Banner not found');

    const { title, subtitle, type, gradientFrom, gradientTo, linkTo, ctaText, startAt, endAt, isActive, sortOrder } = req.body;
    if (title != null) banner.title = title.trim();
    if (subtitle != null) banner.subtitle = subtitle;
    if (type != null) banner.type = type;
    if (gradientFrom != null) banner.gradientFrom = gradientFrom;
    if (gradientTo != null) banner.gradientTo = gradientTo;
    if (linkTo != null) banner.linkTo = linkTo;
    if (ctaText != null) banner.ctaText = ctaText;
    if (startAt !== undefined) banner.startAt = startAt || null;
    if (endAt !== undefined) banner.endAt = endAt || null;
    if (isActive !== undefined) banner.isActive = isActive === 'true' || isActive === true;
    if (sortOrder != null) banner.sortOrder = Number(sortOrder);
    if (req.file) banner.image = req.file.path;

    await banner.save();
    res.json({ success: true, banner });
  } catch (err) {
    console.error('[express.updateBanner]', err);
    fail(res, 500, 'Failed to update banner');
  }
};

const toggleBannerActive = async (req, res) => {
  try {
    const banner = await ExpressBanner.findById(req.params.bannerId);
    if (!banner) return fail(res, 404, 'Banner not found');
    banner.isActive = !banner.isActive;
    await banner.save();
    res.json({ success: true, banner });
  } catch (err) {
    console.error('[express.toggleBannerActive]', err);
    fail(res, 500, 'Failed to toggle banner');
  }
};

const deleteBanner = async (req, res) => {
  try {
    const banner = await ExpressBanner.findByIdAndDelete(req.params.bannerId);
    if (!banner) return fail(res, 404, 'Banner not found');
    await logAudit({ actorType: 'admin', actorName: req.user?.name || 'Admin', action: 'banner.delete', meta: { bannerId: banner._id, title: banner.title } });
    res.json({ success: true, message: 'Banner deleted' });
  } catch (err) {
    console.error('[express.deleteBanner]', err);
    fail(res, 500, 'Failed to delete banner');
  }
};

module.exports = {
  listStores, createStore, updateStore, toggleStoreActive, toggleOnlineShop, togglePauseStore, archiveStore,
  updateDeliverySlots, updateDeliveryFeeConfig,
  getHoldWaitlist, markWaitlistCalledBack,
  listStoreManagers, createStoreManager, updateStoreManager,
  listPOSUsers, createPOSUser, updatePOSUser,
  listProducts, createProduct, updateProduct, deleteProduct, previewPrice, searchKoyambeduCatalog,
  createNativeProduct, searchExpressProducts, generateProductDescription,
  adminSetProductPlu, adminAssignProductToStore,
  listStoreProducts, listStoreProductsForPrint, upsertStoreProduct, removeStoreProduct, addStock, listStockLogs,
  getMarginConfig, updateMarginConfig, toggleExpressEnabled, recomputeLogisticsCost,
  listInventoryRequests, approveInventoryRequest, rejectInventoryRequest,
  listAuditLog,
  listExpenses, createExpense, deleteExpense,
  getFinanceDashboard, adminGetVisitors, adminGetCarts,
  adminListOnlineCatalog, adminSetOnlineListing, adminSetNativeOnlineListing, adminBulkSetOnlineListing,
  listBanners, createBanner, updateBanner, toggleBannerActive, deleteBanner,
};
