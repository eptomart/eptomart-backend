// ============================================
// EPTOMART EXPRESS — Customer-Facing Controller (Phase 2)
// Nearest-active-store detection, per-store catalogue with computed
// selling prices, and cart CRUD with the 12kg large-order rule. No
// checkout/payment yet — that's a later phase once the POS/fulfilment
// side exists. Fully isolated from every other vertical's controllers.
// ============================================
const ExpressStore        = require('../models/ExpressStore');
const ExpressProduct      = require('../models/ExpressProduct');
const ExpressStoreProduct = require('../models/ExpressStoreProduct');
const ExpressMarginConfig = require('../models/ExpressMarginConfig');
const ExpressCart         = require('../models/ExpressCart');
const { computeSellingPrice, toKgEquivalent, distanceKm } = require('../services/expressPricingService');

const fail = (res, status, message) => res.status(status).json({ success: false, message });

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
      .populate({ path: 'product', match: { isActive: true } })
      .lean();

    const catalogue = storeProducts
      .filter(sp => sp.product) // drop entries whose product got deactivated/deleted
      .map(sp => {
        const pricing = computeSellingPrice(sp.product, config, 1);
        return {
          storeProductId: sp._id,
          product: {
            _id: sp.product._id,
            name: sp.product.name,
            category: sp.product.category,
            unit: sp.product.unit,
            image: sp.product.image,
          },
          stockQty: sp.stockQty,
          pricePerUnit: pricing.sellingPricePerUnit,
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

    const storeProduct = await ExpressStoreProduct.findOne({ store: storeId, product: productId, isAvailable: true }).populate('product');
    if (!storeProduct || !storeProduct.product) return fail(res, 404, 'Product not available at this store');
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
        name: storeProduct.product.name,
        unit: storeProduct.product.unit,
        price: pricing.sellingPricePerUnit,
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

module.exports = {
  getStatus, findNearestStore, getCatalogue,
  getCart, addToCart, updateCartItem, clearCart,
};
