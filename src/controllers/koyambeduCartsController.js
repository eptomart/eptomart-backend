// Named carts (see models/KoyambeduSavedCart.js). All routes sit behind `protect`,
// so a super admin using "View as customer" manages the customer's carts too.
const KoyambeduCart = require('../models/KoyambeduCart');
const KoyambeduSavedCart = require('../models/KoyambeduSavedCart');
const User = require('../models/User');

const plainItems = (items) => (items || []).map(i => {
  const o = i.toObject ? i.toObject() : { ...i };
  delete o._id;
  return o;
});
const total = (items) => (items || []).reduce((s, i) => s + (i.unitPrice || 0) * (i.quantity || 0), 0);
const cleanName = (n) => String(n || '').trim().replace(/\s+/g, ' ').slice(0, 40);

async function workingCart(userId) {
  let c = await KoyambeduCart.findOne({ user: userId });
  if (!c) c = new KoyambeduCart({ user: userId, items: [] });
  return c;
}

// Make sure the working cart is linked to a saved cart (created lazily as "My cart").
async function ensureActive(active, userId) {
  if (active.activeCartId) {
    const found = await KoyambeduSavedCart.findOne({ _id: active.activeCartId, user: userId });
    if (found) return found;
  }
  const saved = await KoyambeduSavedCart.create({ user: userId, name: 'My cart', addressId: active.addressId || '', items: plainItems(active.items) });
  active.activeCartId = saved._id;
  await active.save();
  return saved;
}

async function flushActive(active, userId) {
  const saved = await ensureActive(active, userId);
  saved.items = plainItems(active.items);
  saved.lastUsedAt = new Date();
  saved.markModified('items');
  await saved.save();
  return saved;
}

async function validAddress(userId, addressId) {
  if (!addressId) return '';
  const u = await User.findById(userId).select('addresses');
  const a = u?.addresses?.id(addressId);
  return a ? String(a._id) : null;     // null = not found
}

async function summary(userId) {
  const active = await workingCart(userId);
  await ensureActive(active, userId);
  const [saved, user] = await Promise.all([
    KoyambeduSavedCart.find({ user: userId }).sort({ createdAt: 1 }).lean(),
    User.findById(userId).select('addresses').lean(),
  ]);
  const addrOf = (id) => (user?.addresses || []).find(a => String(a._id) === String(id));
  return saved.map(c => {
    const isActive = String(c._id) === String(active.activeCartId);
    const items = isActive ? active.items : c.items;
    const a = addrOf(isActive ? (active.addressId || c.addressId) : c.addressId);
    return {
      _id: c._id, name: c.name, isActive,
      itemCount: (items || []).filter(i => (i.quantity || 0) > 0).length,
      total: Math.round(total(items) * 100) / 100,
      addressId: a ? String(a._id) : '',
      place: a ? { label: a.label, line: [a.addressLine1, a.city, a.pincode].filter(Boolean).join(', '), pincode: a.pincode, areaName: a.areaName || '', pinned: a.lat != null && a.lng != null } : null,
      byAdmin: !!c.createdByAdmin,
    };
  });
}

/** GET /api/koyambedu/carts */
const listCarts = async (req, res) => {
  res.json({ success: true, carts: await summary(req.user._id) });
};

/** POST /api/koyambedu/carts  { name, addressId?, activate? = true } */
const createCart = async (req, res) => {
  const name = cleanName(req.body.name);
  if (!name) return res.status(400).json({ success: false, message: 'Give the cart a name' });
  const uid = req.user._id;
  if (await KoyambeduSavedCart.findOne({ user: uid, name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') })) {
    return res.status(409).json({ success: false, message: 'You already have a cart with this name' });
  }
  const addressId = await validAddress(uid, req.body.addressId);
  if (addressId === null) return res.status(400).json({ success: false, message: 'Address not found' });

  const active = await workingCart(uid);
  await ensureActive(active, uid);
  const created = await KoyambeduSavedCart.create({ user: uid, name, addressId, items: [], createdByAdmin: req.actingAdmin?._id });
  if (req.body.activate !== false) {
    await flushActive(active, uid);
    active.items = [];
    active.activeCartId = created._id;
    active.addressId = addressId;
    await active.save();
    created.lastUsedAt = new Date(); await created.save();
  }
  res.status(201).json({ success: true, cart: created, carts: await summary(uid) });
};

/** POST /api/koyambedu/carts/:id/switch */
const switchCart = async (req, res) => {
  const uid = req.user._id;
  const target = await KoyambeduSavedCart.findOne({ _id: req.params.id, user: uid });
  if (!target) return res.status(404).json({ success: false, message: 'Cart not found' });
  const active = await workingCart(uid);
  if (String(active.activeCartId) !== String(target._id)) {
    await flushActive(active, uid);
    active.items = target.items.map(i => ({ ...i }));
    active.activeCartId = target._id;
    active.addressId = target.addressId || '';
    await active.save();
    target.lastUsedAt = new Date(); await target.save();
  }
  res.json({ success: true, carts: await summary(uid) });
};

/** PATCH /api/koyambedu/carts/:id  { name?, addressId? } */
const updateCartMeta = async (req, res) => {
  const uid = req.user._id;
  const cart = await KoyambeduSavedCart.findOne({ _id: req.params.id, user: uid });
  if (!cart) return res.status(404).json({ success: false, message: 'Cart not found' });
  if (req.body.name !== undefined) {
    const name = cleanName(req.body.name);
    if (!name) return res.status(400).json({ success: false, message: 'Give the cart a name' });
    const clash = await KoyambeduSavedCart.findOne({ user: uid, _id: { $ne: cart._id }, name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') });
    if (clash) return res.status(409).json({ success: false, message: 'You already have a cart with this name' });
    cart.name = name;
  }
  if (req.body.addressId !== undefined) {
    const addressId = await validAddress(uid, req.body.addressId);
    if (addressId === null) return res.status(400).json({ success: false, message: 'Address not found' });
    cart.addressId = addressId;
    const active = await KoyambeduCart.findOne({ user: uid });
    if (active && String(active.activeCartId) === String(cart._id)) { active.addressId = addressId; await active.save(); }
  }
  await cart.save();
  res.json({ success: true, carts: await summary(uid) });
};

/** DELETE /api/koyambedu/carts/:id */
const deleteCart = async (req, res) => {
  const uid = req.user._id;
  const all = await KoyambeduSavedCart.find({ user: uid }).sort({ lastUsedAt: -1 });
  const cart = all.find(c => String(c._id) === String(req.params.id));
  if (!cart) return res.status(404).json({ success: false, message: 'Cart not found' });
  if (all.length <= 1) return res.status(400).json({ success: false, message: 'You need at least one cart' });
  const active = await workingCart(uid);
  if (String(active.activeCartId) === String(cart._id)) {
    const next = all.find(c => String(c._id) !== String(cart._id));
    active.items = next.items.map(i => ({ ...i }));
    active.activeCartId = next._id;
    active.addressId = next.addressId || '';
    await active.save();
  }
  await KoyambeduSavedCart.deleteOne({ _id: cart._id });
  res.json({ success: true, carts: await summary(uid) });
};

module.exports = { listCarts, createCart, switchCart, updateCartMeta, deleteCart };
