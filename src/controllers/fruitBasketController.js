// ============================================
// FRUIT BASKETS & HAMPERS — Controller
// A standalone, single-vendor vertical (no seller marketplace) managed
// entirely by Super Admin: basket/hamper catalog, delivery settings
// (same-day cutoff, delivery slots, distance-tiered delivery charge), and
// its own separate cart-free checkout + Razorpay payment flow.
//
// Patterns intentionally mirror koyambeduController.js (Razorpay
// create/verify, haversine distance, settings singleton) for codebase
// consistency — see that file for the reference implementations this was
// modeled on. Nothing in koyambeduController.js or any other vertical is
// touched by this file.
// ============================================
const mongoose   = require('mongoose');
const crypto     = require('crypto');
const Razorpay   = require('razorpay');

const FruitBasketProduct = require('../models/FruitBasketProduct');
const FruitBasketOrder   = require('../models/FruitBasketOrder');
const FruitBasketSettings = require('../models/FruitBasketSettings');
const FruitBasketCart    = require('../models/FruitBasketCart');
const { callClaude }     = require('../utils/claudeApi');

const getRazorpay = () => {
  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) return null;
  return new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET });
};

/** Haversine distance in km — identical formula to koyambeduController.js's haversineKm. */
const haversineKm = (lat1, lon1, lat2, lon2) => {
  const R    = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a    = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const genOrderId = () => 'FB-' + crypto.randomBytes(4).toString('hex').toUpperCase();

// IST "now" helper — same trick used throughout Koyambedu (avoids a timezone
// library): shift UTC-now by +5:30 and read UTC getters back off the result.
const istNow = () => new Date(Date.now() + (5 * 60 + 30) * 60 * 1000);
const istHoursMinutes = (d) => ({ h: d.getUTCHours(), m: d.getUTCMinutes() });

// ══════════════════════════════════════════════
// PUBLIC — Settings / status
// ══════════════════════════════════════════════

/** GET /fruitbaskets/status — public, no auth. Home.jsx banner + shop page use this. */
const getPublicStatus = async (req, res) => {
  try {
    const status = await FruitBasketSettings.getPublicStatus();
    res.json({ success: true, ...status });
  } catch (err) {
    console.error('[FruitBasket] getPublicStatus error:', err);
    // Fail safe: treat as disabled rather than erroring out the home page.
    res.json({ success: true, featureEnabled: false, sameDayDelivery: { enabled: false, cutoffTime: '14:00' }, deliverySlots: [], delivery: {} });
  }
};

/** Small internal guard used by every customer-facing write route below. */
const assertFeatureEnabled = async () => {
  const doc = await FruitBasketSettings.getGlobal();
  if (!doc.featureEnabled) {
    const err = new Error('Fruit Baskets & Hampers is currently unavailable.');
    err.statusCode = 503;
    throw err;
  }
  return doc;
};

// ══════════════════════════════════════════════
// PUBLIC — Catalog
// ══════════════════════════════════════════════

/** GET /fruitbaskets/products */
const getProducts = async (req, res) => {
  try {
    const { occasion } = req.query;
    const filter = { isActive: true };
    if (occasion) filter.occasion = occasion;
    const products = await FruitBasketProduct.find(filter)
      .sort({ displayOrder: 1, createdAt: -1 })
      .lean();
    res.json({ success: true, products });
  } catch (err) {
    console.error('[FruitBasket] getProducts error:', err);
    res.status(500).json({ success: false, message: 'Failed to load baskets' });
  }
};

/** GET /fruitbaskets/products/:idOrSlug */
const getProductDetail = async (req, res) => {
  try {
    const { idOrSlug } = req.params;
    const filter = mongoose.Types.ObjectId.isValid(idOrSlug)
      ? { _id: idOrSlug }
      : { slug: idOrSlug };
    const product = await FruitBasketProduct.findOne({ ...filter, isActive: true }).lean();
    if (!product) return res.status(404).json({ success: false, message: 'Basket not found' });
    res.json({ success: true, product });
  } catch (err) {
    console.error('[FruitBasket] getProductDetail error:', err);
    res.status(500).json({ success: false, message: 'Failed to load basket' });
  }
};

// ══════════════════════════════════════════════
// PUBLIC — Delivery check (distance + charge preview, before checkout)
// ══════════════════════════════════════════════

/** POST /fruitbaskets/check-delivery  Body: { lat, lng } */
const checkDelivery = async (req, res) => {
  try {
    const { lat, lng } = req.body;
    if (lat === undefined || lng === undefined) {
      return res.status(400).json({ success: false, message: 'lat/lng required' });
    }
    const settingsDoc = await FruitBasketSettings.getGlobal();
    const origin = settingsDoc.delivery || {};
    const distanceKm = haversineKm(Number(lat), Number(lng), origin.originLat ?? 13.0748, origin.originLng ?? 80.2136);
    const { available, charge } = await FruitBasketSettings.computeDeliveryCharge(distanceKm);
    res.json({
      success: true,
      distanceKm: Math.round(distanceKm * 10) / 10,
      available,
      deliveryCharge: charge,
      freeRadiusKm: origin.freeRadiusKm ?? 5,
    });
  } catch (err) {
    console.error('[FruitBasket] checkDelivery error:', err);
    res.status(500).json({ success: false, message: 'Failed to check delivery availability' });
  }
};

// ══════════════════════════════════════════════
// BUYER — Cart (persisted server-side so Fruit Basket items appear in the
// common Eptomart /cart page, same pattern as KoyambeduCart). This is
// purely additive: everything below the "Checkout" section — quote,
// create-razorpay, verify-payment, pricing rules — is completely untouched
// and keeps re-pricing from the live catalog exactly as before.
// ══════════════════════════════════════════════

/** GET /fruitbaskets/cart */
const getCart = async (req, res) => {
  try {
    let cart = await FruitBasketCart.findOne({ user: req.user._id });
    if (!cart) return res.json({ success: true, cart: { items: [] } });

    // Refresh price/availability against the live catalog, same approach as
    // KoyambeduCart.getCart — never let a stale snapshot silently overcharge
    // or undercharge, and drop items that were deactivated after being added.
    const ids = cart.items.map(it => it.product);
    const products = await FruitBasketProduct.find({ _id: { $in: ids } }).lean();
    const byId = new Map(products.map(p => [String(p._id), p]));

    let changed = false;
    const keptItems = [];
    for (const it of cart.items) {
      const p = byId.get(String(it.product));
      if (!p || !p.isActive || !p.isAvailable) { changed = true; continue; }
      if (it.price !== p.price || it.compareAtPrice !== (p.compareAtPrice ?? null) || it.name !== p.name) {
        it.price = p.price; it.compareAtPrice = p.compareAtPrice ?? null; it.name = p.name;
        it.image = p.images?.[0] || ''; changed = true;
      }
      keptItems.push(it);
    }
    if (changed) { cart.items = keptItems; await cart.save(); }

    res.json({ success: true, cart: cart.toObject() });
  } catch (err) {
    console.error('[FruitBasket] getCart error:', err);
    res.status(500).json({ success: false, message: 'Failed to load cart' });
  }
};

/** POST /fruitbaskets/cart — body: { productId, quantity } (quantity <= 0 removes the line) */
const updateCart = async (req, res) => {
  try {
    const { productId, quantity } = req.body;
    if (!productId || String(productId) === 'null' || String(productId) === 'undefined') {
      return res.status(400).json({ success: false, message: 'Invalid basket ID' });
    }

    let cart = await FruitBasketCart.findOne({ user: req.user._id });
    if (!cart) cart = new FruitBasketCart({ user: req.user._id, items: [] });

    const idx = cart.items.findIndex(i => String(i.product) === String(productId));
    const qtyNum = Number(quantity);

    if (qtyNum <= 0) {
      if (idx > -1) cart.items.splice(idx, 1);
    } else {
      const product = await FruitBasketProduct.findOne({ _id: productId, isActive: true, isAvailable: true }).lean();
      if (!product) return res.status(404).json({ success: false, message: 'Basket not found or unavailable' });
      if (product.stock !== null && product.stock !== undefined && qtyNum > product.stock) {
        return res.status(400).json({ success: false, message: `Only ${product.stock} of "${product.name}" left in stock.` });
      }
      const itemData = {
        product: product._id, name: product.name, price: product.price,
        compareAtPrice: product.compareAtPrice ?? null, image: product.images?.[0] || '',
        occasion: product.occasion, weightKg: product.weightKg ?? null, quantity: qtyNum,
      };
      if (idx > -1) Object.assign(cart.items[idx], itemData);
      else cart.items.push(itemData);
    }

    await cart.save();
    res.json({ success: true, cart: cart.toObject() });
  } catch (err) {
    console.error('[FruitBasket] updateCart error:', err);
    res.status(500).json({ success: false, message: 'Failed to update cart' });
  }
};

/** DELETE /fruitbaskets/cart/clear */
const clearCart = async (req, res) => {
  try {
    await FruitBasketCart.findOneAndUpdate({ user: req.user._id }, { items: [] }, { upsert: true });
    res.json({ success: true });
  } catch (err) {
    console.error('[FruitBasket] clearCart error:', err);
    res.status(500).json({ success: false, message: 'Failed to clear cart' });
  }
};

// ══════════════════════════════════════════════
// BUYER — Checkout (existing quote/create/verify flow — UNCHANGED below.
// FruitBasketCheckout.jsx now sources its item list from the cart above
// instead of sessionStorage, but sends the same { items, deliveryAddress,
// deliveryDate, slotKey } shape into priceOrderRequest/getQuote/
// createRazorpayOrder exactly as before).
// ══════════════════════════════════════════════

/**
 * Shared pricing/validation helper — used by both the quote preview and the
 * real checkout, so the numbers the customer sees are always exactly what
 * they get charged (same pattern as Koyambedu's priceAmendmentRequest).
 */
const priceOrderRequest = async (requestedItems, deliveryAddress, deliveryDateISO, slotKey) => {
  if (!Array.isArray(requestedItems) || requestedItems.length === 0) {
    const err = new Error('Your basket is empty.'); err.statusCode = 400; throw err;
  }
  if (!deliveryAddress || deliveryAddress.lat === undefined || deliveryAddress.lng === undefined) {
    const err = new Error('Delivery address with location is required.'); err.statusCode = 400; throw err;
  }

  const settingsDoc = await FruitBasketSettings.getGlobal();
  if (!settingsDoc.featureEnabled) {
    const err = new Error('Fruit Baskets & Hampers is currently unavailable.'); err.statusCode = 503; throw err;
  }

  // ── Same-day cutoff check ──
  const todayIso = istNow().toISOString().slice(0, 10);
  if (deliveryDateISO === todayIso) {
    const sd = settingsDoc.sameDayDelivery || {};
    if (sd.enabled === false) {
      const err = new Error('Same-day delivery is currently unavailable — please choose another date.'); err.statusCode = 400; throw err;
    }
    const [cutH, cutM] = (sd.cutoffTime || '14:00').split(':').map(Number);
    const { h, m } = istHoursMinutes(istNow());
    if (h > cutH || (h === cutH && m >= cutM)) {
      const err = new Error(`Same-day orders close at ${sd.cutoffTime || '14:00'} — please choose another date.`); err.statusCode = 400; throw err;
    }
  }

  // ── Slot validation ──
  const slot = (settingsDoc.deliverySlots || []).find(s => s.key === slotKey && s.enabled);
  if (!slot) {
    const err = new Error('Please select a valid delivery slot.'); err.statusCode = 400; throw err;
  }

  // ── Line items — always re-priced server-side from the live catalog ──
  const ids = requestedItems.map(it => it.productId);
  const products = await FruitBasketProduct.find({ _id: { $in: ids }, isActive: true }).lean();
  const byId = new Map(products.map(p => [String(p._id), p]));

  const items = [];
  let subtotal = 0;
  for (const req of requestedItems) {
    const p = byId.get(String(req.productId));
    if (!p) { const err = new Error('One of the baskets in your order is no longer available.'); err.statusCode = 400; throw err; }
    if (!p.isAvailable) { const err = new Error(`"${p.name}" is currently out of stock.`); err.statusCode = 400; throw err; }
    const qty = Math.max(1, Math.floor(Number(req.quantity) || 1));
    if (p.stock !== null && p.stock !== undefined && qty > p.stock) {
      const err = new Error(`Only ${p.stock} of "${p.name}" left in stock.`); err.statusCode = 400; throw err;
    }
    const lineTotal = p.price * qty;
    subtotal += lineTotal;
    items.push({
      product: p._id, name: p.name, image: p.images?.[0] || '',
      unitPrice: p.price, quantity: qty, lineTotal,
    });
  }

  // ── Delivery charge ──
  const origin = settingsDoc.delivery || {};
  const distanceKm = haversineKm(
    Number(deliveryAddress.lat), Number(deliveryAddress.lng),
    origin.originLat ?? 13.0748, origin.originLng ?? 80.2136
  );
  const { available, charge } = await FruitBasketSettings.computeDeliveryCharge(distanceKm);
  if (!available) {
    const err = new Error('Sorry, this address is outside our fruit basket delivery zone.'); err.statusCode = 400; throw err;
  }

  const total = subtotal + charge;
  return { items, subtotal, distanceKm: Math.round(distanceKm * 10) / 10, deliveryCharge: charge, total, slot };
};

/**
 * POST /fruitbaskets/quote
 * Body: { items: [{productId, quantity}], deliveryAddress: {lat,lng,...}, deliveryDate: 'YYYY-MM-DD', slotKey }
 * No side effects — lets the checkout page show a live price breakdown.
 */
const getQuote = async (req, res) => {
  try {
    const { items, deliveryAddress, deliveryDate, slotKey } = req.body;
    const priced = await priceOrderRequest(items, deliveryAddress, deliveryDate, slotKey);
    res.json({ success: true, ...priced });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
    console.error('[FruitBasket] getQuote error:', err);
    res.status(500).json({ success: false, message: 'Failed to price your order' });
  }
};

/**
 * POST /fruitbaskets/orders/create-razorpay
 * Body: { items, deliveryAddress, deliveryDate, slotKey, notes? }
 * Creates the Razorpay order AND a 'pending' FruitBasketOrder document in
 * one step (payment is verified/confirmed by verifyPayment below) — same
 * two-step create→verify shape as Koyambedu's checkout.
 */
const createRazorpayOrder = async (req, res) => {
  try {
    const { items, deliveryAddress, deliveryDate, slotKey, notes } = req.body;
    const priced = await priceOrderRequest(items, deliveryAddress, deliveryDate, slotKey);

    const isDemo = !!req.user.isDemoAccount;
    const razorpay = isDemo ? null : getRazorpay();
    if (!isDemo && !razorpay) return res.status(500).json({ success: false, message: 'Payment gateway not configured' });

    const orderId = genOrderId();
    // Demo/review account — skip the real gateway (same pattern used across
    // every other vertical's payment controller).
    const rzpOrder = isDemo
      ? { id: `demo_${orderId}` }
      : await razorpay.orders.create({
          amount:   Math.round(priced.total * 100),
          currency: 'INR',
          receipt:  orderId,
          notes:    { fbOrderId: orderId, type: 'fruit_basket_order' },
        });

    const order = await FruitBasketOrder.create({
      orderId,
      buyer: req.user._id,
      items: priced.items,
      deliveryAddress: {
        name: deliveryAddress.name, phone: deliveryAddress.phone,
        addressLine: deliveryAddress.addressLine, city: deliveryAddress.city || '',
        pincode: deliveryAddress.pincode || '', label: deliveryAddress.label || '',
        lat: deliveryAddress.lat, lng: deliveryAddress.lng,
      },
      deliveryDate: new Date(deliveryDate),
      deliverySlot: { key: priced.slot.key, label: priced.slot.label, startTime: priced.slot.startTime, endTime: priced.slot.endTime },
      pricing: {
        subtotal: priced.subtotal, distanceKm: priced.distanceKm,
        deliveryCharge: priced.deliveryCharge, total: priced.total,
      },
      razorpayOrderId: rzpOrder.id,
      isDemoOrder: isDemo,
      notes: notes || '',
      timeline: [{ status: 'placed', note: 'Order created, awaiting payment' }],
    });

    res.json({
      success: true, demoMode: isDemo, rzpOrderId: rzpOrder.id, amount: priced.total, currency: 'INR',
      orderId: order._id, keyId: isDemo ? null : process.env.RAZORPAY_KEY_ID,
    });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
    console.error('[FruitBasket] createRazorpayOrder error:', err);
    res.status(500).json({ success: false, message: 'Failed to start checkout' });
  }
};

/**
 * POST /fruitbaskets/orders/verify-payment
 * Body: { orderId, razorpayOrderId, razorpayPaymentId, razorpaySignature }
 * Identical HMAC verification pattern to koyambeduController.verifyPayment.
 */
const verifyPayment = async (req, res) => {
  try {
    const { orderId, razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;
    const order = await FruitBasketOrder.findOne({ _id: orderId, buyer: req.user._id });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    // Idempotency guard
    if (order.paymentStatus === 'paid') {
      return res.json({ success: true, message: 'Payment already confirmed', orderId: order.orderId });
    }

    // Demo/review account — skip real signature verification (only
    // reachable when createRazorpayOrder above already set isDemoOrder=true).
    if (!order.isDemoOrder) {
      const secret = process.env.RAZORPAY_KEY_SECRET;
      const body   = `${razorpayOrderId}|${razorpayPaymentId}`;
      const expectedSig = crypto.createHmac('sha256', secret).update(body).digest('hex');
      if (expectedSig !== razorpaySignature) {
        order.paymentStatus = 'failed';
        await order.save();
        return res.status(400).json({ success: false, message: 'Payment verification failed' });
      }
    }

    order.paymentStatus       = 'paid';
    order.razorpayPaymentId   = razorpayPaymentId;
    order.razorpaySignature   = razorpaySignature;
    order.orderStatus         = 'confirmed';
    order.timeline.push({ status: 'confirmed', note: 'Payment received' });
    await order.save();

    res.json({ success: true, message: 'Payment confirmed', orderId: order.orderId, id: order._id });
  } catch (err) {
    console.error('[FruitBasket] verifyPayment error:', err);
    res.status(500).json({ success: false, message: 'Failed to verify payment' });
  }
};

// ══════════════════════════════════════════════
// BUYER — My orders
// ══════════════════════════════════════════════

const getMyOrders = async (req, res) => {
  try {
    const orders = await FruitBasketOrder.find({ buyer: req.user._id }).sort({ createdAt: -1 }).lean();
    res.json({ success: true, orders });
  } catch (err) {
    console.error('[FruitBasket] getMyOrders error:', err);
    res.status(500).json({ success: false, message: 'Failed to load your orders' });
  }
};

const getMyOrder = async (req, res) => {
  try {
    const order = await FruitBasketOrder.findOne({ _id: req.params.orderId, buyer: req.user._id }).lean();
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    res.json({ success: true, order });
  } catch (err) {
    console.error('[FruitBasket] getMyOrder error:', err);
    res.status(500).json({ success: false, message: 'Failed to load order' });
  }
};

const cancelMyOrder = async (req, res) => {
  try {
    const order = await FruitBasketOrder.findOne({ _id: req.params.orderId, buyer: req.user._id });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    if (['out_for_delivery', 'delivered', 'cancelled'].includes(order.orderStatus)) {
      return res.status(400).json({ success: false, message: `Order can no longer be cancelled (status: ${order.orderStatus})` });
    }
    order.orderStatus = 'cancelled';
    order.cancelReason = req.body?.reason || 'Cancelled by customer';
    order.timeline.push({ status: 'cancelled', note: order.cancelReason });
    await order.save();
    res.json({ success: true, message: 'Order cancelled' });
  } catch (err) {
    console.error('[FruitBasket] cancelMyOrder error:', err);
    res.status(500).json({ success: false, message: 'Failed to cancel order' });
  }
};

// ══════════════════════════════════════════════
// SUPER ADMIN — Settings
// ══════════════════════════════════════════════

const adminGetSettings = async (req, res) => {
  try {
    const doc = await FruitBasketSettings.getGlobal();
    res.json({ success: true, settings: doc });
  } catch (err) {
    console.error('[FruitBasket] adminGetSettings error:', err);
    res.status(500).json({ success: false, message: 'Failed to load settings' });
  }
};

/** PATCH /fruitbaskets/admin/settings/feature — body: { enabled } */
const adminToggleFeature = async (req, res) => {
  try {
    const { enabled } = req.body;
    const doc = await FruitBasketSettings.findOneAndUpdate(
      { key: 'global' },
      {
        featureEnabled: !!enabled,
        featureEnabledBy: req.user._id, featureEnabledByName: req.user.name, featureEnabledAt: new Date(),
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.json({ success: true, settings: doc });
  } catch (err) {
    console.error('[FruitBasket] adminToggleFeature error:', err);
    res.status(500).json({ success: false, message: 'Failed to update feature toggle' });
  }
};

/** PUT /fruitbaskets/admin/settings/same-day-delivery — body: { enabled?, cutoffTime? } */
const adminUpdateSameDayDelivery = async (req, res) => {
  try {
    const { enabled, cutoffTime } = req.body;
    const update = {
      'sameDayDelivery.updatedBy': req.user._id,
      'sameDayDelivery.updatedByName': req.user.name,
      'sameDayDelivery.updatedAt': new Date(),
    };
    if (enabled !== undefined) update['sameDayDelivery.enabled'] = !!enabled;
    if (cutoffTime !== undefined) {
      if (!/^\d{2}:\d{2}$/.test(cutoffTime)) return res.status(400).json({ success: false, message: 'cutoffTime must be HH:mm' });
      update['sameDayDelivery.cutoffTime'] = cutoffTime;
    }
    const doc = await FruitBasketSettings.findOneAndUpdate(
      { key: 'global' }, update, { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.json({ success: true, sameDayDelivery: doc.sameDayDelivery });
  } catch (err) {
    console.error('[FruitBasket] adminUpdateSameDayDelivery error:', err);
    res.status(500).json({ success: false, message: 'Failed to update same-day delivery settings' });
  }
};

/** PUT /fruitbaskets/admin/settings/delivery-slots — body: { slots: [{key,label,startTime,endTime,enabled}] } */
const adminUpdateDeliverySlots = async (req, res) => {
  try {
    const { slots } = req.body;
    if (!Array.isArray(slots)) return res.status(400).json({ success: false, message: 'slots must be an array' });
    for (const s of slots) {
      if (!s.key || !s.label || !s.startTime || !s.endTime) {
        return res.status(400).json({ success: false, message: 'Each slot needs key, label, startTime, endTime' });
      }
    }
    const doc = await FruitBasketSettings.findOneAndUpdate(
      { key: 'global' }, { deliverySlots: slots }, { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.json({ success: true, deliverySlots: doc.deliverySlots });
  } catch (err) {
    console.error('[FruitBasket] adminUpdateDeliverySlots error:', err);
    res.status(500).json({ success: false, message: 'Failed to update delivery slots' });
  }
};

/** PUT /fruitbaskets/admin/settings/delivery-charges
 *  body: { originLat?, originLng?, originLabel?, freeRadiusKm?, blockSizeKm?, chargePerBlock?, maxDeliveryKm? } */
const adminUpdateDeliveryCharges = async (req, res) => {
  try {
    const allowed = ['originLat', 'originLng', 'originLabel', 'freeRadiusKm', 'blockSizeKm', 'chargePerBlock', 'maxDeliveryKm'];
    const update = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) update[`delivery.${key}`] = req.body[key];
    }
    update['delivery.updatedBy']     = req.user._id;
    update['delivery.updatedByName'] = req.user.name;
    update['delivery.updatedAt']     = new Date();
    const doc = await FruitBasketSettings.findOneAndUpdate(
      { key: 'global' }, update, { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.json({ success: true, delivery: doc.delivery });
  } catch (err) {
    console.error('[FruitBasket] adminUpdateDeliveryCharges error:', err);
    res.status(500).json({ success: false, message: 'Failed to update delivery charges' });
  }
};

// ══════════════════════════════════════════════
// SUPER ADMIN — AI-assisted description
// Reuses the same Claude helper (utils/claudeApi.js) already powering
// aiController.js's seller product-description generator — no new SDK,
// no new env var (ANTHROPIC_API_KEY is already configured).
// ══════════════════════════════════════════════

const FB_DESCRIPTION_SYSTEM = `You are an elegant copywriter for Eptomart's Fruit Baskets & Hampers — a premium, "royal" gifting vertical.
Write a gift-worthy product description that:
- Opens with an inviting one-sentence hook suited to gifting
- Naturally weaves in what's inside and the occasion(s) it suits, if given
- Uses warm, premium, refined language (never cheesy or over-the-top)
- Stays between 45 and 80 words
- Does NOT include price, delivery, or seller information
- Uses plain flowing prose only — no markdown, no bullet points, no asterisks
Output ONLY the description text, nothing else.`;

/** POST /fruitbaskets/admin/generate-description
 *  body: { name, shortNote, occasion, contents }
 *  Admin gives a short note about the basket; Claude expands it into a
 *  polished product description. Purely a text generator — does not touch
 *  or save any product; the admin still clicks Save Basket separately. */
const adminGenerateDescription = async (req, res) => {
  try {
    const { name, shortNote, occasion, contents } = req.body;
    if (!name && !shortNote) {
      return res.status(400).json({ success: false, message: 'Give a basket name or a short note to generate from' });
    }

    const contentsText = Array.isArray(contents) && contents.length
      ? contents.map(c => `${c.item}${c.qty ? ` (${c.qty})` : ''}`).filter(Boolean).join(', ')
      : '';

    const userPrompt = [
      name        ? `Basket name: ${name}` : null,
      occasion && occasion !== 'general' ? `Occasion: ${occasion}` : null,
      contentsText ? `What's inside: ${contentsText}` : null,
      shortNote   ? `Admin's short note about this basket: ${shortNote}` : null,
    ].filter(Boolean).join('\n');

    const result = await callClaude({
      system: FB_DESCRIPTION_SYSTEM,
      messages: [{ role: 'user', content: userPrompt }],
      max_tokens: 180,
      temperature: 0.75,
    });
    res.json({ success: true, description: result.text.trim() });
  } catch (err) {
    console.error('[FruitBasket] adminGenerateDescription error:', err.message);
    res.status(503).json({ success: false, message: 'Could not generate description right now. Try again.' });
  }
};

// ══════════════════════════════════════════════
// SUPER ADMIN — Basket catalog CRUD
// ══════════════════════════════════════════════

const adminGetProducts = async (req, res) => {
  try {
    const products = await FruitBasketProduct.find({}).sort({ displayOrder: 1, createdAt: -1 }).lean();
    res.json({ success: true, products });
  } catch (err) {
    console.error('[FruitBasket] adminGetProducts error:', err);
    res.status(500).json({ success: false, message: 'Failed to load baskets' });
  }
};

const adminCreateProduct = async (req, res) => {
  try {
    const body = req.body;
    if (!body.name || body.price === undefined) {
      return res.status(400).json({ success: false, message: 'name and price are required' });
    }
    const product = await FruitBasketProduct.create({
      name: body.name, description: body.description || '', images: body.images || [],
      price: Number(body.price), compareAtPrice: body.compareAtPrice ? Number(body.compareAtPrice) : null,
      contents: body.contents || [], occasion: body.occasion || 'general',
      weightKg: body.weightKg ? Number(body.weightKg) : null,
      stock: body.stock === '' || body.stock === undefined ? null : Number(body.stock),
      isActive: body.isActive !== undefined ? !!body.isActive : true,
      isAvailable: body.isAvailable !== undefined ? !!body.isAvailable : true,
      displayOrder: body.displayOrder ? Number(body.displayOrder) : 0,
      createdBy: req.user._id, updatedBy: req.user._id,
    });
    res.json({ success: true, product });
  } catch (err) {
    console.error('[FruitBasket] adminCreateProduct error:', err);
    res.status(500).json({ success: false, message: 'Failed to create basket' });
  }
};

const adminUpdateProduct = async (req, res) => {
  try {
    const body = req.body;
    const fields = ['name', 'description', 'images', 'price', 'compareAtPrice', 'contents', 'occasion', 'weightKg', 'stock', 'isActive', 'isAvailable', 'displayOrder'];
    const update = { updatedBy: req.user._id };
    for (const f of fields) if (body[f] !== undefined) update[f] = body[f];
    const product = await FruitBasketProduct.findByIdAndUpdate(req.params.productId, update, { new: true, runValidators: true });
    if (!product) return res.status(404).json({ success: false, message: 'Basket not found' });
    res.json({ success: true, product });
  } catch (err) {
    console.error('[FruitBasket] adminUpdateProduct error:', err);
    res.status(500).json({ success: false, message: 'Failed to update basket' });
  }
};

const adminDeleteProduct = async (req, res) => {
  try {
    const product = await FruitBasketProduct.findByIdAndDelete(req.params.productId);
    if (!product) return res.status(404).json({ success: false, message: 'Basket not found' });
    res.json({ success: true, message: 'Basket deleted' });
  } catch (err) {
    console.error('[FruitBasket] adminDeleteProduct error:', err);
    res.status(500).json({ success: false, message: 'Failed to delete basket' });
  }
};

const uploadImage = async (req, res) => {
  if (!req.file?.path) return res.status(400).json({ success: false, message: 'No image uploaded' });
  res.json({ success: true, url: req.file.path });
};

// ══════════════════════════════════════════════
// SUPER ADMIN — Orders
// ══════════════════════════════════════════════

const adminGetOrders = async (req, res) => {
  try {
    const { status, date } = req.query;
    const filter = {};
    if (status) filter.orderStatus = status;
    if (date) {
      const start = new Date(date); start.setHours(0, 0, 0, 0);
      const end = new Date(date); end.setHours(23, 59, 59, 999);
      filter.deliveryDate = { $gte: start, $lte: end };
    }
    const orders = await FruitBasketOrder.find(filter)
      .populate('buyer', 'name phone email')
      .sort({ createdAt: -1 })
      .lean();
    res.json({ success: true, orders });
  } catch (err) {
    console.error('[FruitBasket] adminGetOrders error:', err);
    res.status(500).json({ success: false, message: 'Failed to load orders' });
  }
};

const adminUpdateOrderStatus = async (req, res) => {
  try {
    const { status, note } = req.body;
    const allowed = ['confirmed', 'preparing', 'out_for_delivery', 'delivered', 'cancelled'];
    if (!allowed.includes(status)) return res.status(400).json({ success: false, message: 'Invalid status' });
    const order = await FruitBasketOrder.findById(req.params.orderId);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    order.orderStatus = status;
    order.timeline.push({ status, note: note || '', by: req.user._id, byName: req.user.name });
    await order.save();
    res.json({ success: true, order });
  } catch (err) {
    console.error('[FruitBasket] adminUpdateOrderStatus error:', err);
    res.status(500).json({ success: false, message: 'Failed to update order status' });
  }
};

module.exports = {
  // Public
  getPublicStatus, getProducts, getProductDetail, checkDelivery,
  // Buyer — cart
  getCart, updateCart, clearCart,
  // Buyer
  getQuote, createRazorpayOrder, verifyPayment, getMyOrders, getMyOrder, cancelMyOrder,
  // Super Admin — settings
  adminGetSettings, adminToggleFeature, adminUpdateSameDayDelivery, adminUpdateDeliverySlots, adminUpdateDeliveryCharges,
  // Super Admin — catalog
  adminGetProducts, adminCreateProduct, adminUpdateProduct, adminDeleteProduct, uploadImage,
  adminGenerateDescription,
  // Super Admin — orders
  adminGetOrders, adminUpdateOrderStatus,
};
