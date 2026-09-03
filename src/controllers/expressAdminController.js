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

const listProducts = async (req, res) => {
  try {
    const products = await ExpressProduct.find({}).sort({ createdAt: -1 }).lean();
    res.json({ success: true, products });
  } catch (err) {
    console.error('[express.listProducts]', err);
    fail(res, 500, 'Failed to load products');
  }
};

const createProduct = async (req, res) => {
  try {
    const { name, category, unit, isWeightBased, unitsPerKg, procurementBaseCost, customMarginPct } = req.body;
    if (!name || !unit || procurementBaseCost == null) {
      return fail(res, 400, 'name, unit and procurementBaseCost are required');
    }
    const product = await ExpressProduct.create({
      name, category, unit, isWeightBased, unitsPerKg, procurementBaseCost, customMarginPct,
    });
    res.status(201).json({ success: true, product });
  } catch (err) {
    console.error('[express.createProduct]', err);
    fail(res, 500, 'Failed to create product');
  }
};

const updateProduct = async (req, res) => {
  try {
    const { productId } = req.params;
    const fields = ['name', 'category', 'unit', 'isWeightBased', 'unitsPerKg', 'procurementBaseCost', 'customMarginPct', 'isActive'];
    const update = {};
    fields.forEach(f => { if (req.body[f] !== undefined) update[f] = req.body[f]; });

    const product = await ExpressProduct.findByIdAndUpdate(productId, update, { new: true, runValidators: true });
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
      .populate('product')
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
      .populate('items.product', 'name unit')
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

    // Apply allocation — default to requestedQty unless admin overrode it
    for (const item of request.items) {
      const override = items?.find(i => String(i.product) === String(item.product));
      const allocatedQty = override?.allocatedQty ?? item.requestedQty;
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

module.exports = {
  listStores, createStore, updateStore, toggleStoreActive, archiveStore,
  listStoreManagers, createStoreManager, updateStoreManager,
  listPOSUsers, createPOSUser, updatePOSUser,
  listProducts, createProduct, updateProduct, deleteProduct, previewPrice,
  listStoreProducts, upsertStoreProduct,
  getMarginConfig, updateMarginConfig, recomputeLogisticsCost,
  listInventoryRequests, approveInventoryRequest, rejectInventoryRequest,
  listAuditLog,
};
