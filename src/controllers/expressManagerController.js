// ============================================
// EPTOMART EXPRESS — Store Manager Operations Controller
// Everything a logged-in Store Manager can do, scoped strictly to their own
// store (req.manager.store — never trusts a storeId from the request body
// for anything that would leak or modify another store's data). Covers
// spec sections 7, 11, 12, 13, 14, 15: order fulfilment, product/store
// ON/OFF toggles, inventory view + requests, delivery expense recording.
// ============================================
const ExpressStore            = require('../models/ExpressStore');
const ExpressStoreProduct     = require('../models/ExpressStoreProduct');
const ExpressOrder            = require('../models/ExpressOrder');
const ExpressInventoryRequest = require('../models/ExpressInventoryRequest');
const ExpressAuditLog         = require('../models/ExpressAuditLog');

const fail = (res, status, message) => res.status(status).json({ success: false, message });

async function logAudit({ actorName, action, store, meta = {} }) {
  try {
    await ExpressAuditLog.create({ actorType: 'store_manager', actorName, action, store, meta });
  } catch (_) { /* never let audit logging break the main request */ }
}

// ── Dashboard ────────────────────────────────────────────────────────────

const getDashboard = async (req, res) => {
  try {
    const storeId = req.manager.store;
    const today = new Date(); today.setHours(0, 0, 0, 0);

    const [pendingOrders, todayOrders, deliveredToday, lowStockCount] = await Promise.all([
      ExpressOrder.countDocuments({ store: storeId, orderStatus: { $in: ['confirmed', 'preparing', 'out_for_delivery'] } }),
      ExpressOrder.countDocuments({ store: storeId, createdAt: { $gte: today }, paymentStatus: 'paid' }),
      ExpressOrder.countDocuments({ store: storeId, orderStatus: 'delivered', updatedAt: { $gte: today } }),
      ExpressStoreProduct.countDocuments({ store: storeId, stockQty: { $lt: 5 } }),
    ]);

    res.json({ success: true, stats: { pendingOrders, todayOrders, deliveredToday, lowStockCount } });
  } catch (err) {
    console.error('[expressManager.getDashboard]', err);
    fail(res, 500, 'Failed to load dashboard');
  }
};

// ── Store toggle (section 12) ────────────────────────────────────────────

const getMyStore = async (req, res) => {
  try {
    const store = await ExpressStore.findById(req.manager.store).lean();
    if (!store) return fail(res, 404, 'Store not found');
    res.json({ success: true, store });
  } catch (err) {
    console.error('[expressManager.getMyStore]', err);
    fail(res, 500, 'Failed to load store');
  }
};

const toggleMyStore = async (req, res) => {
  try {
    const store = await ExpressStore.findById(req.manager.store);
    if (!store) return fail(res, 404, 'Store not found');
    store.isActive = !store.isActive;
    store.lastStatusChange = { by: 'store_manager', byName: req.manager.name, at: new Date() };
    await store.save();
    await logAudit({ actorName: req.manager.name, action: store.isActive ? 'store.activate' : 'store.deactivate', store: store._id });
    res.json({ success: true, store });
  } catch (err) {
    console.error('[expressManager.toggleMyStore]', err);
    fail(res, 500, 'Failed to update store status');
  }
};

// ── Product availability (section 11) ────────────────────────────────────

const listMyStoreProducts = async (req, res) => {
  try {
    const storeProducts = await ExpressStoreProduct.find({ store: req.manager.store })
      .populate('product')
      .sort({ createdAt: -1 })
      .lean();
    res.json({ success: true, storeProducts });
  } catch (err) {
    console.error('[expressManager.listMyStoreProducts]', err);
    fail(res, 500, 'Failed to load products');
  }
};

const toggleProductAvailability = async (req, res) => {
  try {
    const { storeProductId } = req.params;
    const sp = await ExpressStoreProduct.findOne({ _id: storeProductId, store: req.manager.store }).populate('product', 'name');
    if (!sp) return fail(res, 404, 'Product not found at your store');

    sp.isAvailable = !sp.isAvailable;
    sp.lastToggle = { isAvailable: sp.isAvailable, byName: req.manager.name, at: new Date() };
    await sp.save();

    await logAudit({
      actorName: req.manager.name, action: sp.isAvailable ? 'product.enable' : 'product.disable',
      store: req.manager.store, meta: { productId: sp.product?._id, productName: sp.product?.name },
    });
    res.json({ success: true, storeProduct: sp });
  } catch (err) {
    console.error('[expressManager.toggleProductAvailability]', err);
    fail(res, 500, 'Failed to update product availability');
  }
};

// ── Inventory requests (section 5) ───────────────────────────────────────

const listMyInventoryRequests = async (req, res) => {
  try {
    const requests = await ExpressInventoryRequest.find({ store: req.manager.store })
      .populate('items.product', 'name unit')
      .sort({ createdAt: -1 })
      .lean();
    res.json({ success: true, requests });
  } catch (err) {
    console.error('[expressManager.listMyInventoryRequests]', err);
    fail(res, 500, 'Failed to load inventory requests');
  }
};

const createInventoryRequest = async (req, res) => {
  try {
    const { items, notes } = req.body; // items: [{ product, requestedQty }]
    if (!Array.isArray(items) || items.length === 0) return fail(res, 400, 'At least one item is required');

    const request = await ExpressInventoryRequest.create({
      store: req.manager.store,
      requestedByName: req.manager.name,
      requestedBy: req.manager._id,
      items,
      notes,
    });
    res.status(201).json({ success: true, request });
  } catch (err) {
    console.error('[expressManager.createInventoryRequest]', err);
    fail(res, 500, 'Failed to submit inventory request');
  }
};

// ── Orders / fulfilment (sections 13 & 14) ───────────────────────────────

const listMyOrders = async (req, res) => {
  try {
    const { status } = req.query;
    const filter = { store: req.manager.store };
    if (status) filter.orderStatus = status;
    const orders = await ExpressOrder.find(filter)
      .populate('buyer', 'name phone')
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();
    res.json({ success: true, orders });
  } catch (err) {
    console.error('[expressManager.listMyOrders]', err);
    fail(res, 500, 'Failed to load orders');
  }
};

const FULFILMENT_STEPS = ['confirmed', 'preparing', 'out_for_delivery', 'delivered'];

const updateOrderStatus = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { status, note } = req.body;
    if (!FULFILMENT_STEPS.includes(status)) return fail(res, 400, 'Invalid status');

    const order = await ExpressOrder.findOne({ _id: orderId, store: req.manager.store });
    if (!order) return fail(res, 404, 'Order not found');
    if (order.orderStatus === 'cancelled') return fail(res, 400, 'Order was cancelled');

    order.orderStatus = status;
    order.timeline.push({ status, note: note || `Marked ${status} by ${req.manager.name}` });
    await order.save();

    res.json({ success: true, order });
  } catch (err) {
    console.error('[expressManager.updateOrderStatus]', err);
    fail(res, 500, 'Failed to update order status');
  }
};

const recordDeliveryExpense = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { partner, amount } = req.body;
    if (amount == null) return fail(res, 400, 'amount is required');

    const order = await ExpressOrder.findOneAndUpdate(
      { _id: orderId, store: req.manager.store },
      { deliveryExpense: { partner, amount, recordedByName: req.manager.name, recordedAt: new Date() } },
      { new: true }
    );
    if (!order) return fail(res, 404, 'Order not found');
    res.json({ success: true, order });
  } catch (err) {
    console.error('[expressManager.recordDeliveryExpense]', err);
    fail(res, 500, 'Failed to record delivery expense');
  }
};

module.exports = {
  getDashboard, getMyStore, toggleMyStore,
  listMyStoreProducts, toggleProductAvailability,
  listMyInventoryRequests, createInventoryRequest,
  listMyOrders, updateOrderStatus, recordDeliveryExpense,
};
