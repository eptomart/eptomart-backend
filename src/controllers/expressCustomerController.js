// ============================================
// EPTOMART EXPRESS — Customer-Facing Controller (Phase 2)
// Nearest-active-store detection, per-store catalogue with computed
// selling prices, and cart CRUD with the 12kg large-order rule. No
// checkout/payment yet — that's a later phase once the POS/fulfilment
// side exists. Fully isolated from every other vertical's controllers.
// ============================================
const crypto       = require('crypto');
const Razorpay     = require('razorpay');
const ExpressStore        = require('../models/ExpressStore');
const ExpressProduct      = require('../models/ExpressProduct');
const ExpressStoreProduct = require('../models/ExpressStoreProduct');
const ExpressMarginConfig = require('../models/ExpressMarginConfig');
const ExpressCart         = require('../models/ExpressCart');
const ExpressOrder        = require('../models/ExpressOrder');
const { computeSellingPrice, toKgEquivalent, distanceKm } = require('../services/expressPricingService');

const fail = (res, status, message) => res.status(status).json({ success: false, message });

const getRazorpay = () => {
  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) return null;
  return new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET });
};
const genOrderId = () => 'EX-' + crypto.randomBytes(4).toString('hex').toUpperCase();

async function getMarginConfig() {
  let config = await ExpressMarginConfig.findOne({ key: 'default' });
  if (!config) config = await ExpressMarginConfig.create({ key: 'default' });
  return config;
}

// ── Public status — is Express live at all? (section 19 master switch) ──
const getStatus = async (req, res) => {
  try {
    const config = await getMarginConfig();
    res.json({ success: true, isEnabled: !!config.isEnabled });
  } catch (err) {
    console.error('[express.getStatus]', err);
    fail(res, 500, 'Failed to load Express status');
  }
};

// ── Nearest active store (sections 8 & 9) ────────────────────────────────
const findNearestStore = async (req, res) => {
  try {
    const { lat, lng } = req.body;
    if (lat == null || lng == null) return fail(res, 400, 'lat and lng are required');

    const config = await getMarginConfig();
    if (!config.isEnabled) {
      return res.json({ success: true, withinRange: false, expressDisabled: true, message: 'Eptomart Express is currently unavailable.' });
    }

    const activeStores = await ExpressStore.find({ isActive: true, isArchived: false }).lean();

    if (activeStores.length === 0) {
      return res.json({ success: true, withinRange: false, message: 'No Eptomart Express stores are currently active.', redirectTo: 'koyambedu' });
    }

    const withDistance = activeStores.map(s => ({
      store: s,
      distanceKm: distanceKm({ lat: Number(lat), lng: Number(lng) }, s.location),
    })).sort((a, b) => a.distanceKm - b.distanceKm);

    const nearest = withDistance[0];
    const maxKm = config.maxDeliveryDistanceKm || 12;

    if (nearest.distanceKm > maxKm) {
      return res.json({
        success: true,
        withinRange: false,
        nearestDistanceKm: nearest.distanceKm,
        maxDeliveryDistanceKm: maxKm,
        message: `You're ${nearest.distanceKm} km from our nearest Express store, which is beyond our ${maxKm} km delivery range.`,
        redirectTo: 'koyambedu',
      });
    }

    res.json({
      success: true,
      withinRange: true,
      store: { _id: nearest.store._id, name: nearest.store.name, code: nearest.store.code, location: nearest.store.location },
      distanceKm: nearest.distanceKm,
    });
  } catch (err) {
    console.error('[express.findNearestStore]', err);
    fail(res, 500, 'Failed to find nearest store');
  }
};

// ── Store catalogue (section 8 — customer shops without seeing which store) ─
const getCatalogue = async (req, res) => {
  try {
    const { storeId } = req.params;
    const store = await ExpressStore.findOne({ _id: storeId, isActive: true, isArchived: false });
    if (!store) return fail(res, 404, 'Store not found or inactive');

    const config = await getMarginConfig();
    const storeProducts = await ExpressStoreProduct.find({ store: storeId, isAvailable: true, stockQty: { $gt: 0 } })
      .populate({
        path: 'product', match: { isActive: true },
        populate: { path: 'koyambeduProduct', select: 'name description images category' },
      })
      .lean();

    // Name/description/image always come live from the linked Koyambedu
    // Daily product — Express never stores its own copy of these (see
    // ExpressProduct.js). Drop any store-product whose link is broken
    // (product deactivated/deleted, or the underlying Koyambedu product
    // itself was removed) rather than showing a blank/broken card.
    const catalogue = storeProducts
      .filter(sp => sp.product?.koyambeduProduct)
      .map(sp => {
        const pricing = computeSellingPrice(sp.product, config, 1);
        const kb = sp.product.koyambeduProduct;
        return {
          storeProductId: sp._id,
          product: {
            _id: sp.product._id,
            name: kb.name,
            description: kb.description,
            category: kb.category,
            unit: sp.product.unit,
            image: kb.images?.find(i => i.isPrimary)?.url || kb.images?.[0]?.url || null,
          },
          stockQty: sp.stockQty,
          // A per-store price override (admin-set when assigning this
          // product to this store) wins over the globally-computed margin
          // price — see ExpressStoreProduct.priceOverride.
          pricePerUnit: sp.priceOverride ?? pricing.sellingPricePerUnit,
        };
      });

    res.json({ success: true, store: { _id: store._id, name: store.name }, catalogue });
  } catch (err) {
    console.error('[express.getCatalogue]', err);
    fail(res, 500, 'Failed to load store catalogue');
  }
};

// ── Cart ─────────────────────────────────────────────────────────────────

async function computeCartWeightKg(cart) {
  if (!cart?.items?.length) return 0;
  const productIds = cart.items.map(i => i.product);
  const products = await ExpressProduct.find({ _id: { $in: productIds } }).lean();
  const byId = new Map(products.map(p => [String(p._id), p]));
  return cart.items.reduce((sum, item) => {
    const product = byId.get(String(item.product));
    if (!product) return sum;
    return sum + toKgEquivalent(product, item.quantity);
  }, 0);
}

async function buildCartResponse(cart, config) {
  if (!cart) return { items: [], itemCount: 0, subtotal: 0, totalWeightKg: 0, largeOrderWarning: false };
  const totalWeightKg = Math.round((await computeCartWeightKg(cart)) * 100) / 100;
  const subtotal = Math.round(cart.items.reduce((sum, i) => sum + i.price * i.quantity, 0) * 100) / 100;
  const threshold = config.largeOrderThresholdKg || 12;
  return {
    _id: cart._id,
    store: cart.store,
    items: cart.items,
    itemCount: cart.items.reduce((sum, i) => sum + i.quantity, 0),
    subtotal,
    totalWeightKg,
    largeOrderWarning: totalWeightKg > threshold,
    largeOrderAction: config.largeOrderAction,
    largeOrderThresholdKg: threshold,
  };
}

const getCart = async (req, res) => {
  try {
    const cart = await ExpressCart.findOne({ user: req.user._id }).lean();
    const config = await getMarginConfig();
    res.json({ success: true, cart: await buildCartResponse(cart, config) });
  } catch (err) {
    console.error('[express.getCart]', err);
    fail(res, 500, 'Failed to load cart');
  }
};

const addToCart = async (req, res) => {
  try {
    const { storeId, productId, quantity = 1 } = req.body;
    if (!storeId || !productId) return fail(res, 400, 'storeId and productId are required');
    if (!Number.isFinite(Number(quantity)) || Number(quantity) <= 0) return fail(res, 400, 'quantity must be a positive number');

    const storeProduct = await ExpressStoreProduct.findOne({ store: storeId, product: productId, isAvailable: true })
      .populate({ path: 'product', populate: { path: 'koyambeduProduct', select: 'name' } });
    if (!storeProduct || !storeProduct.product?.koyambeduProduct) return fail(res, 404, 'Product not available at this store');
    if (storeProduct.stockQty < quantity) return fail(res, 400, 'Not enough stock available');

    const config = await getMarginConfig();
    const pricing = computeSellingPrice(storeProduct.product, config, 1);

    let cart = await ExpressCart.findOne({ user: req.user._id });

    // A cart is tied to exactly one store — if the customer already has
    // items from a different store, starting fresh here is the correct
    // behaviour (spec section 8: customer only ever sees one store's
    // catalogue at a time).
    if (cart && String(cart.store) !== String(storeId)) {
      cart.items = [];
      cart.store = storeId;
    }
    if (!cart) {
      cart = new ExpressCart({ user: req.user._id, store: storeId, items: [] });
    }

    const existing = cart.items.find(i => String(i.product) === String(productId));
    if (existing) {
      existing.quantity += Number(quantity);
    } else {
      cart.items.push({
        product: productId,
        name: storeProduct.product.koyambeduProduct.name,
        unit: storeProduct.product.unit,
        price: storeProduct.priceOverride ?? pricing.sellingPricePerUnit,
        quantity: Number(quantity),
      });
    }
    await cart.save();

    res.json({ success: true, cart: await buildCartResponse(cart.toObject(), config) });
  } catch (err) {
    console.error('[express.addToCart]', err);
    fail(res, 500, 'Failed to add item to cart');
  }
};

const updateCartItem = async (req, res) => {
  try {
    const { productId, quantity } = req.body;
    if (!productId || quantity == null) return fail(res, 400, 'productId and quantity are required');
    if (!Number.isFinite(Number(quantity))) return fail(res, 400, 'quantity must be a number');

    const cart = await ExpressCart.findOne({ user: req.user._id });
    if (!cart) return fail(res, 404, 'Cart not found');

    if (Number(quantity) <= 0) {
      cart.items = cart.items.filter(i => String(i.product) !== String(productId));
    } else {
      const item = cart.items.find(i => String(i.product) === String(productId));
      if (!item) return fail(res, 404, 'Item not in cart');
      item.quantity = Number(quantity);
    }
    await cart.save();

    const config = await getMarginConfig();
    res.json({ success: true, cart: await buildCartResponse(cart.toObject(), config) });
  } catch (err) {
    console.error('[express.updateCartItem]', err);
    fail(res, 500, 'Failed to update cart item');
  }
};

const clearCart = async (req, res) => {
  try {
    await ExpressCart.findOneAndUpdate({ user: req.user._id }, { items: [] });
    res.json({ success: true, message: 'Cart cleared' });
  } catch (err) {
    console.error('[express.clearCart]', err);
    fail(res, 500, 'Failed to clear cart');
  }
};

// ── Checkout (Phase 3) ───────────────────────────────────────────────────

/**
 * Shared pricing/validation helper — the cart is always re-priced and
 * re-validated server-side against the live catalogue + current stock, so
 * what the customer confirms at checkout is always accurate (same pattern
 * as fruitBasketController.priceOrderRequest).
 */
async function priceCart(userId, deliveryAddress) {
  const cart = await ExpressCart.findOne({ user: userId });
  if (!cart || cart.items.length === 0) {
    const err = new Error('Your cart is empty.'); err.statusCode = 400; throw err;
  }
  if (!deliveryAddress || !deliveryAddress.addressLine || !deliveryAddress.phone) {
    const err = new Error('Delivery address, name and phone are required.'); err.statusCode = 400; throw err;
  }

  const config = await getMarginConfig();
  if (!config.isEnabled) {
    const err = new Error('Eptomart Express is currently unavailable.'); err.statusCode = 503; throw err;
  }

  const storeProducts = await ExpressStoreProduct.find({ store: cart.store, isAvailable: true })
    .populate('product')
    .lean();
  const byProductId = new Map(storeProducts.map(sp => [String(sp.product?._id), sp]));

  const items = [];
  let subtotal = 0;
  let totalWeightKg = 0;
  for (const line of cart.items) {
    const sp = byProductId.get(String(line.product));
    if (!sp || !sp.product) { const err = new Error(`"${line.name}" is no longer available.`); err.statusCode = 400; throw err; }
    if (sp.stockQty < line.quantity) { const err = new Error(`Only ${sp.stockQty} of "${line.name}" left in stock.`); err.statusCode = 400; throw err; }

    const pricing = computeSellingPrice(sp.product, config, 1);
    const unitPrice = sp.priceOverride ?? pricing.sellingPricePerUnit;
    const lineTotal = Math.round(unitPrice * line.quantity * 100) / 100;
    subtotal += lineTotal;
    totalWeightKg += toKgEquivalent(sp.product, line.quantity);

    items.push({
      // Name comes from the cart line's own snapshot (captured from the
      // linked Koyambedu product at add-to-cart time) — sp.product itself
      // no longer carries a name field, see ExpressProduct.js.
      product: sp.product._id, name: line.name, unit: sp.product.unit,
      unitPrice, quantity: line.quantity, lineTotal,
    });
  }
  totalWeightKg = Math.round(totalWeightKg * 100) / 100;

  const threshold = config.largeOrderThresholdKg || 12;
  if (totalWeightKg > threshold && config.largeOrderAction === 'block') {
    const err = new Error(`Orders above ${threshold} kg aren't supported on Eptomart Express — please use Koyambedu Daily instead.`);
    err.statusCode = 400; throw err;
  }

  const total = Math.round(subtotal * 100) / 100;
  return { cart, items, subtotal, total, totalWeightKg, largeOrderWarning: totalWeightKg > threshold };
}

/** POST /express/quote */
const getQuote = async (req, res) => {
  try {
    const { deliveryAddress } = req.body;
    const priced = await priceCart(req.user._id, deliveryAddress);
    res.json({ success: true, items: priced.items, subtotal: priced.subtotal, total: priced.total, totalWeightKg: priced.totalWeightKg, largeOrderWarning: priced.largeOrderWarning });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
    console.error('[express.getQuote]', err);
    fail(res, 500, 'Failed to price your order');
  }
};

/** POST /express/orders/create-razorpay */
const createRazorpayOrder = async (req, res) => {
  try {
    const { deliveryAddress, notes, deliverySlot } = req.body;
    const priced = await priceCart(req.user._id, deliveryAddress);

    const isDemo = !!req.user.isDemoAccount;
    const razorpay = isDemo ? null : getRazorpay();
    if (!isDemo && !razorpay) return fail(res, 500, 'Payment gateway not configured');

    const orderId = genOrderId();
    const rzpOrder = isDemo
      ? { id: `demo_${orderId}` }
      : await razorpay.orders.create({
          amount: Math.round(priced.total * 100),
          currency: 'INR',
          receipt: orderId,
          notes: { expressOrderId: orderId, type: 'express_order' },
        });

    const order = await ExpressOrder.create({
      orderId,
      buyer: req.user._id,
      store: priced.cart.store,
      items: priced.items,
      deliveryAddress: {
        name: deliveryAddress.name, phone: deliveryAddress.phone,
        addressLine: deliveryAddress.addressLine, city: deliveryAddress.city || '',
        pincode: deliveryAddress.pincode || '',
        lat: deliveryAddress.lat, lng: deliveryAddress.lng,
      },
      pricing: { subtotal: priced.subtotal, total: priced.total },
      totalWeightKg: priced.totalWeightKg,
      deliverySlot: deliverySlot ? {
        date: deliverySlot.date || null,
        label: deliverySlot.label || null,
        isNextDay: !!deliverySlot.isNextDay,
      } : undefined,
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
    console.error('[express.createRazorpayOrder]', err);
    fail(res, 500, 'Failed to start checkout');
  }
};

/** POST /express/orders/verify-payment */
const verifyPayment = async (req, res) => {
  try {
    const { orderId, razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;
    const order = await ExpressOrder.findOne({ _id: orderId, buyer: req.user._id });
    if (!order) return fail(res, 404, 'Order not found');

    if (order.paymentStatus === 'paid') {
      return res.json({ success: true, message: 'Payment already confirmed', orderId: order.orderId });
    }

    if (!order.isDemoOrder) {
      const secret = process.env.RAZORPAY_KEY_SECRET;
      const body = `${razorpayOrderId}|${razorpayPaymentId}`;
      const expectedSig = crypto.createHmac('sha256', secret).update(body).digest('hex');
      if (expectedSig !== razorpaySignature) {
        order.paymentStatus = 'failed';
        await order.save();
        return fail(res, 400, 'Payment verification failed');
      }
    }

    order.paymentStatus = 'paid';
    order.razorpayPaymentId = razorpayPaymentId;
    order.razorpaySignature = razorpaySignature;
    order.orderStatus = 'confirmed';
    order.timeline.push({ status: 'confirmed', note: 'Payment received' });
    await order.save();

    // Deduct stock now that payment is confirmed. Money has already
    // changed hands at this point, so a stock shortfall (e.g. a POS sale at
    // the same store sold the last unit between checkout and payment
    // confirmation) must not block the order — clamp to zero and flag it
    // for the Store Manager to reconcile, rather than silently going
    // negative (which $inc alone would allow, bypassing the schema's
    // min: 0 validator).
    let stockShortfall = false;
    for (const item of order.items) {
      const updated = await ExpressStoreProduct.findOneAndUpdate(
        { store: order.store, product: item.product, stockQty: { $gte: item.quantity } },
        { $inc: { stockQty: -item.quantity } }
      );
      if (!updated) {
        await ExpressStoreProduct.findOneAndUpdate({ store: order.store, product: item.product }, { stockQty: 0 });
        stockShortfall = true;
      }
    }
    if (stockShortfall) {
      order.notes = (order.notes ? order.notes + ' | ' : '') + 'Stock shortfall at payment time — verify before fulfilling.';
      await order.save();
    }

    // Clear the cart that was just checked out
    await ExpressCart.findOneAndUpdate({ user: req.user._id }, { items: [] });

    res.json({ success: true, message: 'Payment confirmed', orderId: order.orderId, id: order._id });
  } catch (err) {
    console.error('[express.verifyPayment]', err);
    fail(res, 500, 'Failed to verify payment');
  }
};

// ── My Orders ────────────────────────────────────────────────────────────

const getMyOrders = async (req, res) => {
  try {
    const orders = await ExpressOrder.find({ buyer: req.user._id }).sort({ createdAt: -1 }).lean();
    res.json({ success: true, orders });
  } catch (err) {
    console.error('[express.getMyOrders]', err);
    fail(res, 500, 'Failed to load your orders');
  }
};

const getMyOrder = async (req, res) => {
  try {
    const order = await ExpressOrder.findOne({ _id: req.params.orderId, buyer: req.user._id }).lean();
    if (!order) return fail(res, 404, 'Order not found');
    res.json({ success: true, order });
  } catch (err) {
    console.error('[express.getMyOrder]', err);
    fail(res, 500, 'Failed to load order');
  }
};

const cancelMyOrder = async (req, res) => {
  try {
    const order = await ExpressOrder.findOne({ _id: req.params.orderId, buyer: req.user._id });
    if (!order) return fail(res, 404, 'Order not found');
    if (['out_for_delivery', 'delivered', 'cancelled'].includes(order.orderStatus)) {
      return fail(res, 400, `Order can no longer be cancelled (status: ${order.orderStatus})`);
    }
    const wasPaid = order.paymentStatus === 'paid';
    order.orderStatus = 'cancelled';
    order.cancelReason = req.body?.reason || 'Cancelled by customer';
    order.timeline.push({ status: 'cancelled', note: order.cancelReason });
    await order.save();

    // Restock if payment had already gone through and stock was deducted
    if (wasPaid) {
      for (const item of order.items) {
        await ExpressStoreProduct.findOneAndUpdate(
          { store: order.store, product: item.product },
          { $inc: { stockQty: item.quantity } }
        );
      }
    }

    res.json({ success: true, message: 'Order cancelled' });
  } catch (err) {
    console.error('[express.cancelMyOrder]', err);
    fail(res, 500, 'Failed to cancel order');
  }
};

module.exports = {
  getStatus, findNearestStore, getCatalogue,
  getCart, addToCart, updateCartItem, clearCart,
  getQuote, createRazorpayOrder, verifyPayment,
  getMyOrders, getMyOrder, cancelMyOrder,
};
