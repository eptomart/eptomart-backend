// ============================================
// EPTOMART EXPRESS — Store OWNER operations + Admin store-wise accounts
// A store's owner is its ExpressStoreManager account (assigned by mobile
// number from the admin panel). Everything here is hard-scoped to
// req.manager.store — a storeId from the client is NEVER trusted.
//
// Owner can: build the store's catalogue (inherit any Koyambedu Daily
// product "as it is", or create their own products), set selling price &
// stock, switch an item ON/OFF for ONLINE visibility (it always stays
// available for offline POS sales), manage POS staff, and see their own
// accounts / profit.
//
// Reuses the admin controller's battle-tested helpers (online listing,
// finance, P&L, expenses) by calling them with the store forced to the
// owner's — so numbers always match what super admin sees.
// ============================================
const ExpressStore         = require('../models/ExpressStore');
const ExpressProduct       = require('../models/ExpressProduct');
const ExpressStoreProduct  = require('../models/ExpressStoreProduct');
const ExpressOnlineListing = require('../models/ExpressOnlineListing');
const ExpressStockLog      = require('../models/ExpressStockLog');
const ExpressExpense       = require('../models/ExpressExpense');
const ExpressPOSUser       = require('../models/ExpressPOSUser');
const ExpressOrder         = require('../models/ExpressOrder');
const ExpressBill          = require('../models/ExpressBill');
const ExpressAuditLog      = require('../models/ExpressAuditLog');
const ExpressMarginConfig = require('../models/ExpressMarginConfig');
const admin = require('./expressAdminController');

const fail = (res, status, message) => res.status(status).json({ success: false, message });
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Invoke an admin controller function and capture its JSON instead of
// sending it, so owner/accounts endpoints share one source of truth.
function callAdmin(fn, { query = {}, params = {}, body = {}, user = null } = {}) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      json(payload) { resolve({ status: this.statusCode, body: payload }); },
    };
    Promise.resolve(fn({ query, params, body, user }, res)).catch((e) => resolve({ status: 500, body: { success: false, message: e.message } }));
  });
}
const send = (res, out) => res.status(out.status).json(out.body);

async function audit(req, action, meta = {}) {
  try { await ExpressAuditLog.create({ actorType: 'store_manager', actorName: req.manager.name, action, store: req.manager.store, meta }); } catch (_) { /* never break the request */ }
}

const UNITS = ['kg', 'gram', 'piece', 'bunch', 'litre', 'dozen'];

// ── Catalogue ────────────────────────────────────────────────────────────

// GET /owner/catalog — every Koyambedu product + the store's own products,
// annotated with this store's state: inStore, selling price, stock, online.
const listCatalog = async (req, res) => {
  try {
    const storeId = String(req.manager.store);
    const out = await callAdmin(admin.adminListOnlineCatalog, { params: { storeId } });
    if (!out.body?.success) return send(res, out);

    const sps = await ExpressStoreProduct.find({ store: storeId }).select('product isAvailable stockQty priceOverride approval').lean();
    const spByProduct = Object.fromEntries(sps.map((s) => [String(s.product), s]));
    const own = await ExpressProduct.find({ ownerStore: storeId }).select('_id').lean();
    const ownIds = new Set(own.map((p) => String(p._id)));

    const items = (out.body.items || []).map((it) => {
      const sp = it.productId ? spByProduct[String(it.productId)] : null;
      return {
        ...it,
        inStore: !!sp,
        isAvailable: sp ? sp.isAvailable : false,
        sellingPrice: sp?.priceOverride ?? null,
        stockQty: sp ? sp.stockQty : 0,
        approvalStatus: sp ? (sp.approval?.status || 'approved') : null,
        approvalNote: sp?.approval?.note || null,
        isOwn: !!(it.productId && ownIds.has(String(it.productId))),
      };
    });
    res.json({ success: true, store: out.body.store, items });
  } catch (err) {
    console.error('[expressOwner.listCatalog]', err);
    fail(res, 500, 'Failed to load catalogue');
  }
};

// POST /owner/items — add / update one item at MY store.
// body: { koyambeduProductId | expressProductId, price, mrp, isOnline, isAvailable,
//         addStock, note, procurementBaseCost (own products only) }
const saveItem = async (req, res) => {
  try {
    const storeId = String(req.manager.store);
    const { koyambeduProductId, expressProductId, price, mrp, isOnline, isAvailable, addStock, note } = req.body;
    if (!koyambeduProductId && !expressProductId) return fail(res, 400, 'Choose a product');

    let product;
    if (koyambeduProductId) {
      product = await admin.resolveExpressProduct(koyambeduProductId); // inherit "as it is"
      if (!product) return fail(res, 404, 'Product not found');
    } else {
      product = await ExpressProduct.findOne({ _id: expressProductId, koyambeduProduct: { $exists: false }, isActive: true });
      if (!product) return fail(res, 404, 'Product not found');
      if (product.ownerStore && String(product.ownerStore) !== storeId) return fail(res, 403, 'Not your product');
    }

    // Cost of a shared product is company-wide — only an owner's OWN
    // product cost can be edited here.
    if (req.body.procurementBaseCost !== undefined && req.body.procurementBaseCost !== '' &&
        product.ownerStore && String(product.ownerStore) === storeId) {
      const c = Number(req.body.procurementBaseCost);
      if (Number.isFinite(c) && c >= 0) { product.procurementBaseCost = c; await product.save(); }
    }

    const priceGiven = price !== undefined && price !== null && price !== '';
    if (priceGiven && (!Number.isFinite(Number(price)) || Number(price) < 0)) return fail(res, 400, 'Enter a valid selling price');

    const set = {};
    if (priceGiven) set.priceOverride = Math.round(Number(price));
    if (isAvailable !== undefined) set.isAvailable = !!isAvailable;
    // New items start as 'pending' super-admin approval (kill-switch: Settings →
    // productApprovalRequired). Existing rows keep whatever status they have.
    const cfg = await ExpressMarginConfig.findOne({ key: 'default' }).select('productApprovalRequired').lean();
    const needsApproval = cfg ? cfg.productApprovalRequired !== false : true;
    const upd = { $setOnInsert: { store: storeId, product: product._id, stockQty: 0, ...(isAvailable === undefined ? { isAvailable: true } : {}),
      ...(needsApproval && !req.manager.isAdmin ? { approval: { status: 'pending', requestedAt: new Date() } } : {}) } };
    if (Object.keys(set).length) upd.$set = set;
    let sp = await ExpressStoreProduct.findOneAndUpdate(
      { store: storeId, product: product._id }, upd, { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    const add = Number(addStock);
    if (addStock !== undefined && addStock !== '' && Number.isFinite(add) && add > 0) {
      const prev = sp.stockQty || 0;
      sp = await ExpressStoreProduct.findOneAndUpdate({ _id: sp._id }, { $inc: { stockQty: add } }, { new: true });
      await ExpressStockLog.create({
        store: storeId, product: product._id, type: 'addition', qty: add,
        previousQty: prev, newQty: sp.stockQty, reason: note || 'Added by store owner',
        actorType: 'store_manager', actorName: req.manager.name, acknowledged: true,
        acknowledgedBy: req.manager.isAdmin ? undefined : req.manager._id, acknowledgedByName: req.manager.name, acknowledgedAt: new Date(),
      });
    }

    // Online visibility. Selling price is the single price for online + offline:
    // if the item is already online and the price changed, keep the listing in sync.
    const ref = koyambeduProductId ? { koyambeduProductId } : { expressProductId: product._id };
    const existingListing = await ExpressOnlineListing.findOne({ store: storeId, product: product._id }).lean();
    // Selling price is ONE price for online + offline. Always hand the
    // listing helper the effective price so it never falls back to its
    // default markup and overwrites the owner's price.
    const effPrice = priceGiven ? price : (sp.priceOverride ?? undefined);
    if (isOnline !== undefined) {
      await admin.upsertOnlineListing(storeId, ref, { isEnabled: !!isOnline, price: effPrice, mrp }, null);
    } else if (existingListing && (priceGiven || mrp !== undefined)) {
      await admin.upsertOnlineListing(storeId, ref, { isEnabled: existingListing.isEnabled, price: effPrice, mrp }, null);
    }

    await audit(req, 'owner.save-item', { productId: product._id, price: priceGiven ? Number(price) : undefined, isOnline, addStock: add || undefined });
    sp = await ExpressStoreProduct.findById(sp._id).lean();
    res.json({ success: true, storeProduct: sp });
  } catch (err) {
    console.error('[expressOwner.saveItem]', err);
    fail(res, 500, err.message || 'Failed to save item');
  }
};

// POST /owner/products — create the owner's OWN product (private to this store).
const createOwnProduct = async (req, res) => {
  try {
    const storeId = String(req.manager.store);
    const { name, description, unit, category, image, procurementBaseCost, minOrderQty, maxOrderQty } = req.body;
    if (!name || !String(name).trim()) return fail(res, 400, 'Product name is required');
    if (procurementBaseCost == null || procurementBaseCost === '' || !Number.isFinite(Number(procurementBaseCost)) || Number(procurementBaseCost) < 0) {
      return fail(res, 400, 'Enter your cost price per unit');
    }
    const u = UNITS.includes(unit) ? unit : 'kg';
    const escaped = String(name).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const dup = await ExpressProduct.findOne({ koyambeduProduct: { $exists: false }, ownerStore: storeId, name: new RegExp(`^${escaped}$`, 'i') }).select('_id').lean();
    if (dup) return fail(res, 400, `You already have a product named "${String(name).trim()}"`);

    const doc = {
      name: String(name).trim(), description: description || '', unit: u,
      category: category || null, image: image || null,
      isWeightBased: ['kg', 'gram'].includes(u),
      procurementBaseCost: Number(procurementBaseCost), ownerStore: storeId,
    };
    if (minOrderQty !== undefined && minOrderQty !== '' && Number(minOrderQty) > 0) doc.minOrderQty = Number(minOrderQty);
    if (maxOrderQty !== undefined && maxOrderQty !== '' && Number(maxOrderQty) > 0) doc.maxOrderQty = Number(maxOrderQty);
    const product = await ExpressProduct.create(doc);
    await audit(req, 'owner.create-product', { productId: product._id, name: product.name });
    res.status(201).json({ success: true, product });
  } catch (err) {
    console.error('[expressOwner.createOwnProduct]', err);
    fail(res, 500, 'Failed to create product');
  }
};

// PATCH /owner/products/:productId — edit only a product this owner created.
const updateOwnProduct = async (req, res) => {
  try {
    const product = await ExpressProduct.findOne({ _id: req.params.productId, ownerStore: req.manager.store });
    if (!product) return fail(res, 404, 'Product not found (you can only edit products you created)');
    const b = req.body;
    if (b.name != null && String(b.name).trim()) product.name = String(b.name).trim();
    if (b.description != null) product.description = b.description;
    if (b.category != null) product.category = b.category || null;
    if (b.image != null) product.image = b.image || null;
    if (b.unit && UNITS.includes(b.unit)) { product.unit = b.unit; product.isWeightBased = ['kg', 'gram'].includes(b.unit); }
    if (b.procurementBaseCost !== undefined && b.procurementBaseCost !== '' && Number(b.procurementBaseCost) >= 0) product.procurementBaseCost = Number(b.procurementBaseCost);
    if (b.isActive != null) product.isActive = !!b.isActive;
    await product.save();
    res.json({ success: true, product });
  } catch (err) {
    console.error('[expressOwner.updateOwnProduct]', err);
    fail(res, 500, 'Failed to update product');
  }
};

// ── POS staff for my store ───────────────────────────────────────────────

const listMyPOSUsers = async (req, res) => {
  try {
    const posUsers = await ExpressPOSUser.find({ store: req.manager.store }).select('-pin').sort({ createdAt: -1 }).lean();
    res.json({ success: true, posUsers });
  } catch (err) { fail(res, 500, 'Failed to load POS staff'); }
};

const createMyPOSUser = async (req, res) => {
  try {
    const { name, pin } = req.body;
    const phone = String(req.body.phone || '').replace(/\D/g, '').slice(-10);
    if (!name || !pin || phone.length !== 10) return fail(res, 400, 'Name, 10-digit mobile and PIN are required');
    if (String(pin).length < 4) return fail(res, 400, 'PIN must be at least 4 digits');
    const posUser = await ExpressPOSUser.create({ name, username: phone, phone, pin, store: req.manager.store });
    await audit(req, 'owner.pos-create', { posName: name });
    const safe = posUser.toObject(); delete safe.pin;
    res.status(201).json({ success: true, posUser: safe });
  } catch (err) {
    if (err.code === 11000) return fail(res, 409, 'A POS user with this mobile number already exists');
    console.error('[expressOwner.createMyPOSUser]', err);
    fail(res, 500, 'Failed to create POS user');
  }
};

const updateMyPOSUser = async (req, res) => {
  try {
    const posUser = await ExpressPOSUser.findOne({ _id: req.params.posUserId, store: req.manager.store });
    if (!posUser) return fail(res, 404, 'POS user not found');
    if (req.body.name != null) posUser.name = req.body.name;
    if (req.body.isActive != null) posUser.isActive = !!req.body.isActive;
    if (req.body.pin) {
      if (String(req.body.pin).length < 4) return fail(res, 400, 'PIN must be at least 4 digits');
      posUser.pin = req.body.pin;
    }
    await posUser.save();
    const safe = posUser.toObject(); delete safe.pin;
    res.json({ success: true, posUser: safe });
  } catch (err) { fail(res, 500, 'Failed to update POS user'); }
};

// ── Accounts (owner's own store) ─────────────────────────────────────────

// GET /owner/accounts?from&to — finance summary + bill-wise online P&L
const myAccounts = async (req, res) => {
  try {
    const storeId = String(req.manager.store);
    const { from, to } = req.query;
    const [fin, pnl] = await Promise.all([
      callAdmin(admin.getFinanceDashboard, { query: { storeId, from, to } }),
      callAdmin(admin.adminOrdersPnL, { query: { storeId, from, to } }),
    ]);
    res.json({ success: true, finance: fin.body?.finance || null, onlineTotals: pnl.body?.totals || null, bills: (pnl.body?.bills || []).slice(0, 100) });
  } catch (err) {
    console.error('[expressOwner.myAccounts]', err);
    fail(res, 500, 'Failed to load accounts');
  }
};

const myExpenses = async (req, res) => {
  try {
    const out = await callAdmin(admin.listExpenses, { query: { storeId: String(req.manager.store), from: req.query.from, to: req.query.to } });
    send(res, out);
  } catch (err) { fail(res, 500, 'Failed to load expenses'); }
};

const addMyExpense = async (req, res) => {
  try {
    const out = await callAdmin(admin.createExpense, {
      body: { ...req.body, storeId: String(req.manager.store) },
      user: { name: `${req.manager.name} (owner)` },
    });
    send(res, out);
  } catch (err) { fail(res, 500, 'Failed to record expense'); }
};

const deleteMyExpense = async (req, res) => {
  try {
    const exp = await ExpressExpense.findOne({ _id: req.params.expenseId, store: req.manager.store });
    if (!exp) return fail(res, 404, 'Expense not found');
    await exp.deleteOne();
    res.json({ success: true });
  } catch (err) { fail(res, 500, 'Failed to delete expense'); }
};

// GET /owner/overview — headline revenue numbers for the dashboard header
const overview = async (req, res) => {
  try {
    const store = req.manager.store;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const monthStart = new Date(today); monthStart.setDate(1);
    const sum = async (Model, match, field) => {
      const a = await Model.aggregate([{ $match: match }, { $group: { _id: null, t: { $sum: `$${field}` }, n: { $sum: 1 } } }]);
      return { total: a[0]?.t || 0, count: a[0]?.n || 0 };
    };
    const oBase = { store, paymentStatus: 'paid', isDemoOrder: { $ne: true } };
    const [oToday, oMonth, bToday, bMonth, itemsInStore, onlineItems] = await Promise.all([
      sum(ExpressOrder, { ...oBase, createdAt: { $gte: today } }, 'pricing.total'),
      sum(ExpressOrder, { ...oBase, createdAt: { $gte: monthStart } }, 'pricing.total'),
      sum(ExpressBill, { store, status: 'completed', completedAt: { $gte: today } }, 'total'),
      sum(ExpressBill, { store, status: 'completed', completedAt: { $gte: monthStart } }, 'total'),
      ExpressStoreProduct.countDocuments({ store }),
      ExpressOnlineListing.countDocuments({ store, isEnabled: true }),
    ]);
    res.json({
      success: true,
      overview: {
        todayOnline: r2(oToday.total), todayOffline: r2(bToday.total), todayTotal: r2(oToday.total + bToday.total),
        monthOnline: r2(oMonth.total), monthOffline: r2(bMonth.total), monthTotal: r2(oMonth.total + bMonth.total),
        todayOnlineOrders: oToday.count, todayBills: bToday.count, itemsInStore, onlineItems,
      },
    });
  } catch (err) {
    console.error('[expressOwner.overview]', err);
    fail(res, 500, 'Failed to load overview');
  }
};

// ── ADMIN: accounts of every store + store-wise online profit ────────────
// GET /express/admin/accounts/stores?from&to
const adminStoreAccounts = async (req, res) => {
  try {
    const { from, to } = req.query;
    const stores = await ExpressStore.find({ isArchived: { $ne: true } }).select('name code isActive storeManager').populate('storeManager', 'name phone').lean();
    const rows = await Promise.all(stores.map(async (s) => {
      const storeId = String(s._id);
      const [fin, pnl] = await Promise.all([
        callAdmin(admin.getFinanceDashboard, { query: { storeId, from, to } }),
        callAdmin(admin.adminOrdersPnL, { query: { storeId, from, to } }),
      ]);
      const f = fin.body?.finance || {};
      const p = pnl.body?.totals || {};
      return {
        storeId, name: s.name, code: s.code, isActive: s.isActive,
        owner: s.storeManager ? { name: s.storeManager.name, phone: s.storeManager.phone } : null,
        onlineRevenue: f.onlineRevenue || 0, onlineOrders: f.onlineOrderCount || 0,
        // Online profit = per-bill P&L (revenue − procurement − transport − packing − gateway fee)
        onlineProfit: p.profit || 0, onlinePendingCharges: p.pendingChargesCount || 0,
        posRevenue: f.posRevenue || 0, posBills: f.posBillCount || 0,
        revenue: f.revenue || 0, cogs: f.cogs || 0, lossValue: f.lossValue || 0,
        expenses: f.otherExpenses || 0, netProfit: f.netProfit || 0,
      };
    }));
    const keys = ['onlineRevenue', 'onlineOrders', 'onlineProfit', 'posRevenue', 'posBills', 'revenue', 'cogs', 'lossValue', 'expenses', 'netProfit'];
    const totals = Object.fromEntries(keys.map((k) => [k, r2(rows.reduce((t, r) => t + (r[k] || 0), 0))]));
    rows.sort((a, b) => b.netProfit - a.netProfit);
    res.json({ success: true, rows, totals });
  } catch (err) {
    console.error('[expressOwner.adminStoreAccounts]', err);
    fail(res, 500, 'Failed to load store accounts');
  }
};

// GET /api/express/manager/owner-access (normal Eptomart login) — tells the
// Profile page whether to show the "Manage Store" option.
const ownerAccess = async (req, res) => {
  try {
    const m = await require('../models/ExpressStoreManager').findOne({ user: req.user._id, isActive: true }).populate('store', 'name code').lean();
    res.json({ success: true, isOwner: !!m, role: m ? (m.role || 'owner') : null, store: m?.store ? { _id: m.store._id, name: m.store.name } : null });
  } catch (err) {
    res.json({ success: true, isOwner: false, store: null });
  }
};


// ── Team: manager / accountant profiles for MY store (owner only) ────────
// Each is a normal Eptomart account (matched by mobile) given a store role:
//   manager    → fulfils & closes orders, toggles product availability, stock
//   accountant → sees accounts / expenses and orders (read-only)
const ExpressStoreManager = require('../models/ExpressStoreManager');
const User = require('../models/User');
const crypto = require('crypto');
const STAFF_ROLES = ['manager', 'accountant'];

const listTeam = async (req, res) => {
  try {
    const team = await ExpressStoreManager.find({ store: req.manager.store, role: { $in: STAFF_ROLES } })
      .select('-password').sort({ createdAt: -1 }).lean();
    res.json({ success: true, team });
  } catch (err) { fail(res, 500, 'Failed to load team'); }
};

const addTeamMember = async (req, res) => {
  try {
    const { name, role } = req.body;
    const phone = String(req.body.phone || '').replace(/\D/g, '').slice(-10);
    if (!name || !String(name).trim()) return fail(res, 400, 'Name is required');
    if (!/^[6-9]\d{9}$/.test(phone)) return fail(res, 400, 'Enter a valid 10-digit mobile number');
    if (!STAFF_ROLES.includes(role)) return fail(res, 400, 'Role must be manager or accountant');
    const clash = await ExpressStoreManager.findOne({ phone }).populate('store', 'name').lean();
    if (clash) {
      const same = String(clash.store?._id || clash.store) === String(req.manager.store);
      return fail(res, 409, same ? 'This mobile is already on your team' : `This mobile already works for "${clash.store?.name || 'another store'}"`);
    }
    let u = await User.findOne({ phone });
    if (!u) u = await User.create({ name: String(name).trim(), phone, role: 'user' });
    const member = await ExpressStoreManager.create({
      name: String(name).trim(), phone, role, store: req.manager.store, user: u._id,
      password: crypto.randomBytes(8).toString('hex'), // unused — they sign in with the normal Eptomart login
    });
    await audit(req, 'owner.team-add', { phone, role });
    const safe = member.toObject(); delete safe.password;
    res.status(201).json({ success: true, member: safe });
  } catch (err) {
    if (err.code === 11000) return fail(res, 409, 'This mobile number is already in use');
    console.error('[expressOwner.addTeamMember]', err);
    fail(res, 500, 'Failed to add team member');
  }
};

const updateTeamMember = async (req, res) => {
  try {
    const m = await ExpressStoreManager.findOne({ _id: req.params.memberId, store: req.manager.store, role: { $in: STAFF_ROLES } });
    if (!m) return fail(res, 404, 'Team member not found');
    if (req.body.name) m.name = String(req.body.name).trim();
    if (req.body.role) {
      if (!STAFF_ROLES.includes(req.body.role)) return fail(res, 400, 'Role must be manager or accountant');
      m.role = req.body.role;
    }
    if (req.body.isActive != null) m.isActive = !!req.body.isActive;
    await m.save();
    const safe = m.toObject(); delete safe.password;
    res.json({ success: true, member: safe });
  } catch (err) { fail(res, 500, 'Failed to update team member'); }
};

const removeTeamMember = async (req, res) => {
  try {
    const m = await ExpressStoreManager.findOneAndDelete({ _id: req.params.memberId, store: req.manager.store, role: { $in: STAFF_ROLES } });
    if (!m) return fail(res, 404, 'Team member not found');
    await audit(req, 'owner.team-remove', { phone: m.phone, role: m.role });
    res.json({ success: true });
  } catch (err) { fail(res, 500, 'Failed to remove team member'); }
};

// ── WhatsApp alert numbers for MY store ──────────────────────────────────
const getAlerts = async (req, res) => {
  try {
    const store = await ExpressStore.findById(req.manager.store).select('notifyPhones').lean();
    res.json({ success: true, phones: store?.notifyPhones || [] });
  } catch (err) { fail(res, 500, 'Failed to load alert numbers'); }
};

const setAlerts = async (req, res) => {
  try {
    const raw = Array.isArray(req.body.phones) ? req.body.phones : [];
    const phones = [...new Set(raw.map(p => String(p).replace(/\D/g, '').slice(-10)).filter(Boolean))];
    if (phones.some(p => !/^[6-9]\d{9}$/.test(p))) return fail(res, 400, 'Every number must be a valid 10-digit mobile');
    if (phones.length > 5) return fail(res, 400, 'You can add up to 5 numbers');
    await ExpressStore.updateOne({ _id: req.manager.store }, { $set: { notifyPhones: phones } });
    await audit(req, 'owner.alerts-set', { count: phones.length });
    res.json({ success: true, phones });
  } catch (err) { fail(res, 500, 'Failed to save alert numbers'); }
};


// ── Owner: delivery & store settings (slots, fees, hold, online shop) ────
// Thin wrappers over the admin handlers, forced to the caller's own store.
const getStoreSettings = async (req, res) => {
  try {
    const store = await ExpressStore.findById(req.manager.store).lean();
    if (!store) return fail(res, 404, 'Store not found');
    res.json({ success: true, store });
  } catch (err) { fail(res, 500, 'Failed to load store settings'); }
};
const viaAdmin = (fn) => async (req, res) => {
  try {
    const out = await callAdmin(fn, { params: { storeId: String(req.manager.store) }, body: req.body || {}, user: { name: `${req.manager.name} (store)` } });
    send(res, out);
  } catch (err) { fail(res, 500, 'Failed to update store'); }
};
const updateMyDeliverySlots = viaAdmin(admin.updateDeliverySlots);
const updateMyDeliveryFee   = viaAdmin(admin.updateDeliveryFeeConfig);
const toggleMyPause         = viaAdmin(admin.togglePauseStore);
const toggleMyOnlineShop    = viaAdmin(admin.toggleOnlineShop);

// ── ADMIN: approve store items before they go live online ────────────────
// GET /express/admin/approvals?status=pending|rejected|approved&storeId=
const adminListApprovals = async (req, res) => {
  try {
    const status = ['pending', 'rejected', 'approved'].includes(req.query.status) ? req.query.status : 'pending';
    const filter = status === 'approved'
      ? { $or: [{ 'approval.status': 'approved' }, { 'approval.status': { $exists: false } }, { 'approval.status': null }], 'approval.decidedAt': { $ne: null } }
      : { 'approval.status': status };
    if (req.query.storeId) filter.store = req.query.storeId;
    const rows = await ExpressStoreProduct.find(filter)
      .populate('store', 'name code')
      .populate({ path: 'product', populate: { path: 'koyambeduProduct', select: 'name images unit currentPrice' } })
      .sort({ 'approval.requestedAt': -1 }).limit(300).lean();
    const listings = await ExpressOnlineListing.find({ product: { $in: rows.map(r => r.product?._id).filter(Boolean) } }).select('store product isEnabled price mrp').lean();
    const lk = Object.fromEntries(listings.map(l => [`${l.store}:${l.product}`, l]));
    const items = rows.map(r => {
      const l = lk[`${r.store?._id}:${r.product?._id}`];
      const p = r.product || {};
      return {
        _id: r._id, store: r.store ? { _id: r.store._id, name: r.store.name } : null,
        name: p.koyambeduProduct?.name || p.name || 'Product', unit: p.unit,
        source: p.koyambeduProduct ? 'Koyambedu product' : (p.ownerStore ? "Owner's own product" : 'Express product'),
        costPrice: p.procurementBaseCost ?? null, koyambeduPrice: p.koyambeduProduct?.currentPrice ?? null,
        sellingPrice: r.priceOverride ?? l?.price ?? null, mrp: l?.mrp ?? null, wantsOnline: !!l?.isEnabled,
        stockQty: r.stockQty, status: r.approval?.status || 'approved', note: r.approval?.note || null,
        requestedAt: r.approval?.requestedAt, decidedAt: r.approval?.decidedAt, decidedBy: r.approval?.decidedBy,
      };
    });
    const cfg = await ExpressMarginConfig.findOne({ key: 'default' }).select('productApprovalRequired').lean();
    res.json({ success: true, items, productApprovalRequired: cfg ? cfg.productApprovalRequired !== false : true });
  } catch (err) {
    console.error('[expressOwner.adminListApprovals]', err);
    fail(res, 500, 'Failed to load approvals');
  }
};

// POST /express/admin/approvals/decide { ids: [storeProductId], decision: 'approve'|'reject', note }
const adminDecideApprovals = async (req, res) => {
  try {
    const { ids, decision, note } = req.body || {};
    if (!Array.isArray(ids) || !ids.length) return fail(res, 400, 'Select at least one item');
    if (!['approve', 'reject'].includes(decision)) return fail(res, 400, 'Decision must be approve or reject');
    if (decision === 'reject' && !String(note || '').trim()) return fail(res, 400, 'Give a reason when rejecting');
    const r = await ExpressStoreProduct.updateMany(
      { _id: { $in: ids } },
      { $set: {
        'approval.status': decision === 'approve' ? 'approved' : 'rejected',
        'approval.decidedAt': new Date(), 'approval.decidedBy': req.user?.name || 'Admin',
        'approval.note': decision === 'reject' ? String(note).trim() : null,
      } }
    );
    try { await ExpressAuditLog.create({ actorType: 'admin', actorName: req.user?.name || 'Admin', action: `product.${decision}`, meta: { ids, note } }); } catch (_) {}
    res.json({ success: true, updated: r.modifiedCount ?? r.nModified ?? 0 });
  } catch (err) {
    console.error('[expressOwner.adminDecideApprovals]', err);
    fail(res, 500, 'Failed to save decision');
  }
};

// PATCH /express/admin/approvals/setting { required: bool }
const adminSetApprovalRequired = async (req, res) => {
  try {
    await ExpressMarginConfig.updateOne({ key: 'default' }, { $set: { productApprovalRequired: !!req.body.required } }, { upsert: true });
    res.json({ success: true, productApprovalRequired: !!req.body.required });
  } catch (err) { fail(res, 500, 'Failed to save setting'); }
};

module.exports = {
  getStoreSettings, updateMyDeliverySlots, updateMyDeliveryFee, toggleMyPause, toggleMyOnlineShop,
  adminListApprovals, adminDecideApprovals, adminSetApprovalRequired,
  listTeam, addTeamMember, updateTeamMember, removeTeamMember, getAlerts, setAlerts,
  ownerAccess,
  listCatalog, saveItem, createOwnProduct, updateOwnProduct,
  listMyPOSUsers, createMyPOSUser, updateMyPOSUser,
  myAccounts, myExpenses, addMyExpense, deleteMyExpense, overview,
  adminStoreAccounts,
};
