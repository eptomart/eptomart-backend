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
const ExpressOnlineListing = require('../models/ExpressOnlineListing');
const ExpressBanner       = require('../models/ExpressBanner');
const ExpressHoldWaitlist = require('../models/ExpressHoldWaitlist');
const EptoFreshCoupon     = require('../models/EptoFreshCoupon');
const { computeSellingPrice, toKgEquivalent, distanceKm, computeDeliveryFee, computeDistanceSurcharge, computeDeliveryEta, roundRupee } = require('../services/expressPricingService');
const { sendTemplateWhatsApp } = require('../utils/sendWhatsApp');

const fail = (res, status, message) => res.status(status).json({ success: false, message });

/**
 * Validate + price a coupon against a subtotal — same universal-coupon model
 * (EptoFreshCoupon) and rules /api/coupon/validate uses, applied inline here
 * so priceCart below can fold the discount into the total it returns.
 * Never throws — an invalid/expired code is silently ignored (0 discount)
 * so a stale code left over from a previous session can't block checkout.
 */
const applyCoupon = async (couponCode, subtotal) => {
  if (!couponCode) return { couponDiscount: 0, appliedCode: null };
  const coupon = await EptoFreshCoupon.findOne({
    code: String(couponCode).toUpperCase().trim(),
    isActive: true,
    requestStatus: { $in: ['admin_created', 'approved'] },
    validFrom: { $lte: new Date() },
    validTo:   { $gte: new Date() },
  });
  const platformOk = !coupon || !coupon.platformRestriction || ['all', 'express'].includes(coupon.platformRestriction);
  if (!coupon || !platformOk || coupon.usedCount >= coupon.maxUsage || subtotal < coupon.minOrderValue) {
    return { couponDiscount: 0, appliedCode: null };
  }
  let discount = coupon.discountType === 'flat'
    ? Math.min(coupon.discountValue, subtotal)
    : (subtotal * coupon.discountValue) / 100;
  if (coupon.discountType === 'percent' && coupon.maxDiscount) discount = Math.min(discount, coupon.maxDiscount);
  return { couponDiscount: parseFloat(discount.toFixed(2)), appliedCode: coupon.code };
};

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

// Resolves the minimum-order delivery fee rule for a specific store,
// falling back to the global ExpressMarginConfig's values only for stores
// that predate the per-store deliveryFeeConfig field (so a .lean() read
// with no deliveryFeeConfig in the DB document doesn't silently charge ₹0).
function resolveDeliveryFeeConfig(store, config) {
  return {
    minOrderForFreeDelivery: store?.deliveryFeeConfig?.minOrderForFreeDelivery ?? config.minOrderForFreeDelivery ?? 0,
    deliveryFeeBelowMinimum: store?.deliveryFeeConfig?.deliveryFeeBelowMinimum ?? config.deliveryFeeBelowMinimum ?? 0,
    // Per-store hard delivery-range cutoff — null/undefined (not yet
    // configured for this store) falls back to the global default.
    maxDeliveryDistanceKm: store?.deliveryFeeConfig?.maxDeliveryDistanceKm ?? config.maxDeliveryDistanceKm ?? 12,
    // Distance surcharge tiering — see computeDistanceSurcharge. Every
    // field here defaults to "surcharge disabled" so a store an admin
    // hasn't touched never silently starts charging extra for distance.
    freeDeliveryDistanceKm: store?.deliveryFeeConfig?.freeDeliveryDistanceKm ?? 0,
    distanceStepKm: store?.deliveryFeeConfig?.distanceStepKm ?? 1,
    distanceChargePerStep: store?.deliveryFeeConfig?.distanceChargePerStep ?? 0,
  };
}

// A customer hit the checkout gate because their store is on hold — log
// (or bump) their interest so Admin has a call-back list the moment the
// store reopens, instead of that demand just silently disappearing.
// One row per store+user: repeat attempts just bump the counter and
// refresh the cart snapshot/timestamp rather than spamming new rows.
async function recordHoldInterest(storeId, userId, cart, deliveryAddress) {
  try {
    const cartSummary = (cart.items || []).map(i => ({ name: i.name, unit: i.unit, quantity: i.quantity }));
    const estimatedTotal = (cart.items || []).reduce((sum, i) => sum + (Number(i.price) || 0) * (Number(i.quantity) || 0), 0);
    await ExpressHoldWaitlist.findOneAndUpdate(
      { store: storeId, user: userId },
      {
        $set: {
          name: deliveryAddress?.name || '',
          phone: deliveryAddress?.phone || '',
          cartSummary,
          estimatedTotal: roundRupee(estimatedTotal),
          lastAttemptAt: new Date(),
          calledBack: false, // a fresh attempt means they're still waiting — un-tick any earlier call-back
          calledBackAt: null,
        },
        $inc: { attempts: 1 },
        $setOnInsert: { store: storeId, user: userId },
      },
      { upsert: true, new: true }
    );
  } catch (err) {
    // Never let waitlist logging break the actual checkout-gate response.
    console.error('[express.recordHoldInterest]', err);
  }
}

// Order-status WhatsApp notification to the buyer — mirrors Koyambedu
// Daily's own _notifyBuyer/waSend pattern exactly (same Meta WhatsApp
// template env var, same {name, orderId, status, detail} shape) so the
// customer experience is identical across verticals. order.deliveryAddress
// already carries name/phone captured at checkout, so no extra User lookup
// is needed here (unlike Koyambedu, which looks up buyer.phone from User).
const EXPRESS_STATUS_MESSAGES = {
  confirmed:         ['Order Confirmed ✅',       (o) => `Your Eptomart Express order #${o.orderId} is confirmed and being prepared.`],
  preparing:         ['Being Prepared 📦',        (o) => `Order #${o.orderId} is being packed at the store.`],
  out_for_delivery:  ['On the Way 🚚',            (o) => `Order #${o.orderId} is out for delivery.`],
  delivered:         ['Delivered! 🎉',            (o) => `Order #${o.orderId} has been delivered. Thank you for shopping with Eptomart Express!`],
  cancelled:         ['Order Cancelled ❌',       (o) => `Order #${o.orderId} was cancelled.${o.cancelReason ? ` Reason: ${o.cancelReason}` : ''}`],
};
async function notifyExpressBuyer(order, status) {
  try {
    const phone = order.deliveryAddress?.phone;
    if (!phone) return;
    const tpl = process.env.META_WHATSAPP_STATUS_TEMPLATE;
    if (!tpl) return;
    const [label, detailFn] = EXPRESS_STATUS_MESSAGES[status] || [status, () => ''];
    const params = [order.deliveryAddress?.name || 'Customer', order.orderId, label, detailFn(order)];
    const r = await sendTemplateWhatsApp(phone, tpl, [
      { type: 'body', parameters: params.map(t => ({ type: 'text', text: String(t) })) },
    ]);
    if (!r.success) console.warn('[Express WA] Failed to notify', phone, r.error);
  } catch (err) {
    console.error('[express.notifyExpressBuyer]', err.message);
  }
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

// GET /express/banners — only banners that are isActive AND currently
// within their scheduling window (if one is set). An admin can create a
// flash-sale banner ahead of time with startAt/endAt and it will appear
// and disappear automatically with no further action needed.
const getActiveBanners = async (req, res) => {
  try {
    const now = new Date();
    const banners = await ExpressBanner.find({
      isActive: true,
      $and: [
        { $or: [{ startAt: null }, { startAt: { $lte: now } }] },
        { $or: [{ endAt: null }, { endAt: { $gte: now } }] },
      ],
    }).sort({ sortOrder: 1, createdAt: -1 }).lean();
    res.json({ success: true, banners });
  } catch (err) {
    console.error('[express.getActiveBanners]', err);
    fail(res, 500, 'Failed to load banners');
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

    const activeStores = await ExpressStore.find({ isActive: true, isArchived: false, onlineShopEnabled: true }).lean();

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
      store: { _id: nearest.store._id, name: nearest.store.name, code: nearest.store.code, location: nearest.store.location, deliverySlots: nearest.store.deliverySlots },
      distanceKm: nearest.distanceKm,
      estimatedDeliveryMinutes: computeDeliveryEta(nearest.distanceKm, config),
    });
  } catch (err) {
    console.error('[express.findNearestStore]', err);
    fail(res, 500, 'Failed to find nearest store');
  }
};

// ── All active stores, for the customer to choose from directly ─────────
// Unlike findNearestStore (auto-picks the single closest one and redirects),
// this lists every active store so the customer can see and pick whichever
// one they want. Distance is included (sorted nearest-first) whenever lat/
// lng is provided, but every active store is returned regardless of
// distance — the max-delivery-range cutoff used by findNearestStore does
// not apply here, since the customer is choosing, not being auto-routed.
const listActiveStores = async (req, res) => {
  try {
    const { lat, lng } = req.query;
    const config = await getMarginConfig();
    if (!config.isEnabled) {
      return res.json({ success: true, expressDisabled: true, stores: [], message: 'Eptomart Express is currently unavailable.' });
    }

    const activeStores = await ExpressStore.find({ isActive: true, isArchived: false, onlineShopEnabled: true })
      .select('name code address city location isPaused pauseMessage deliverySlots')
      .lean();

    let stores = activeStores.map(s => {
      const dKm = (lat != null && lng != null) ? distanceKm({ lat: Number(lat), lng: Number(lng) }, s.location) : null;
      return {
        _id: s._id, name: s.name, code: s.code, address: s.address, city: s.city,
        isPaused: !!s.isPaused, pauseMessage: s.pauseMessage || null,
        distanceKm: dKm,
        estimatedDeliveryMinutes: dKm != null ? computeDeliveryEta(dKm, config) : null,
        deliverySlots: s.deliverySlots,
      };
    });

    stores = stores.sort((a, b) => {
      if (a.distanceKm != null && b.distanceKm != null) return a.distanceKm - b.distanceKm;
      return a.name.localeCompare(b.name);
    });

    res.json({ success: true, stores });
  } catch (err) {
    console.error('[express.listActiveStores]', err);
    fail(res, 500, 'Failed to load stores');
  }
};

// ── Live delivery ETA for an already-selected store ──────────────────────
// The customer's chosen store (and the ETA computed for it) is cached in
// the frontend's localStorage so a returning visitor skips re-pinning
// their location — but that means the cached estimatedDeliveryMinutes can
// go stale (admin changes the delivery-time tiers) or be entirely missing
// (the customer picked a store from the list without sharing their
// location at all, so no distance was ever known). ExpressShop.jsx calls
// this once on load — silently, using the browser's last-known/granted
// geolocation — to refresh the "Delivery in ~X min" badge with a current
// number instead of showing a stale or missing one indefinitely.
const getStoreEta = async (req, res) => {
  try {
    const { storeId } = req.params;
    const { lat, lng } = req.query;
    if (lat == null || lng == null) return fail(res, 400, 'lat and lng are required');
    const store = await ExpressStore.findOne({ _id: storeId, isActive: true, isArchived: false }).select('location').lean();
    if (!store) return fail(res, 404, 'Store not found');
    const config = await getMarginConfig();
    const dKm = distanceKm({ lat: Number(lat), lng: Number(lng) }, store.location);
    res.json({ success: true, distanceKm: dKm, estimatedDeliveryMinutes: computeDeliveryEta(dKm, config) });
  } catch (err) {
    console.error('[express.getStoreEta]', err);
    fail(res, 500, 'Failed to compute delivery estimate');
  }
};

// ── Online catalogue (admin-curated subset of Koyambedu Daily's catalog,
// per store) — separate from getCatalogue below, which is driven by
// ExpressStoreProduct's physical stock/availability. This one is driven by
// ExpressOnlineListing: only products an admin has explicitly enabled
// online for this store show up, at the admin-set online price. Response
// shape intentionally matches getCatalogue's exactly, so the shop page
// needs no changes beyond which URL it calls.
const getOnlineCatalogue = async (req, res) => {
  try {
    const { storeId } = req.params;
    // isActive deliberately left OUT of this query (unlike isArchived,
    // which is a true soft-delete) — a store with the master on/off switch
    // flipped off should behave exactly like a paused one for a customer
    // who already has it selected: still browsable, with a "we'll be back
    // soon" banner, not a hard 404 that dumps them out with a generic
    // "failed to load products" error and no indication of why. Checkout
    // itself is still correctly blocked either way (see priceCart).
    const store = await ExpressStore.findOne({ _id: storeId, isArchived: false, onlineShopEnabled: true });
    if (!store) return fail(res, 404, 'Store not found or inactive');

    const listings = await ExpressOnlineListing.find({ store: storeId, isEnabled: true, price: { $ne: null } })
      .populate({ path: 'koyambeduProduct', select: 'name description images category', populate: { path: 'category', select: 'name' } })
      .populate({ path: 'product', select: 'unit name description image category isCombo isWeightBased minOrderQty maxOrderQty' })
      .lean();

    const productIds = listings.map(l => l.product?._id).filter(Boolean);
    const storeProducts = await ExpressStoreProduct.find({ store: storeId, product: { $in: productIds } })
      .select('product stockQty').lean();
    const stockByProduct = Object.fromEntries(storeProducts.map(sp => [String(sp.product), sp.stockQty]));

    // Every listing needs a resolved ExpressProduct (`l.product`) to be
    // sellable — Koyambedu-linked listings additionally need the populated
    // `koyambeduProduct` for display fields; native listings (no
    // koyambeduProduct at all) get display fields from `l.product` itself,
    // never from Koyambedu Daily.
    const catalogue = listings
      .filter(l => l.product) // both native and Koyambedu-linked listings need a resolved ExpressProduct
      .map(l => {
        const isNative = !l.koyambeduProduct;
        const display = isNative ? l.product : l.koyambeduProduct;
        // Native products store category as a plain string (ExpressProduct.
        // category); Koyambedu-linked products store it as a populated
        // KoyambeduCategory ref — resolve both to the same plain string so
        // the shop's category chips never show a raw ObjectId.
        const categoryName = isNative ? (display?.category || null) : (display?.category?.name || null);
        return {
          storeProductId: l._id,
          product: {
            _id: l.product._id,
            name: display?.name,
            description: display?.description,
            category: categoryName,
            unit: l.product.unit,
            image: isNative
              ? (display?.image || null)
              : (display?.images?.find(i => i.isPrimary)?.url || display?.images?.[0]?.url || null),
            isCombo: !!l.product.isCombo,
            isWeightBased: l.product.isWeightBased !== false,
            minOrderQty: l.product.minOrderQty || 0.25,
            maxOrderQty: l.product.maxOrderQty || null,
          },
          stockQty: stockByProduct[String(l.product._id)] || 0,
          pricePerUnit: l.price,
          // Display-only "strike-through" MRP + discount badge — only sent
          // when it's genuinely higher than the selling price, so the
          // frontend never has to re-check that itself.
          mrp: (l.mrp && l.mrp > l.price) ? l.mrp : null,
          discountPercent: (l.mrp && l.mrp > l.price) ? Math.round(((l.mrp - l.price) / l.mrp) * 100) : 0,
        };
      })
      .filter(it => it.product.name); // drop anything that somehow has no display name

    const config = await getMarginConfig();
    const feeConfig = resolveDeliveryFeeConfig(store, config);
    res.json({
      success: true,
      store: {
        _id: store._id, name: store.name,
        // isPaused (temporary hold) and !isActive (master off) both render
        // the same "we'll be back soon" banner on the frontend — merged
        // into one flag here so ExpressShop doesn't need to know about two
        // separate switches.
        isPaused: !!store.isPaused || !store.isActive, pauseMessage: store.pauseMessage || null,
      },
      delivery: {
        minOrderForFreeDelivery: feeConfig.minOrderForFreeDelivery,
        deliveryFeeBelowMinimum: feeConfig.deliveryFeeBelowMinimum,
        maxDeliveryDistanceKm: feeConfig.maxDeliveryDistanceKm,
        freeDeliveryDistanceKm: feeConfig.freeDeliveryDistanceKm,
        distanceStepKm: feeConfig.distanceStepKm,
        distanceChargePerStep: feeConfig.distanceChargePerStep,
      },
      catalogue,
    });
  } catch (err) {
    console.error('[express.getOnlineCatalogue]', err);
    fail(res, 500, 'Failed to load catalogue');
  }
};

// ── Single product detail (for the product detail page) ─────────────────
// GET /express/stores/:storeId/online-catalogue/:productId — productId is
// always the ExpressProduct id (same id used throughout the cart/catalogue
// response), so this works identically for native and Koyambedu-linked
// products. Returns everything getOnlineCatalogue returns for one item,
// plus comboContents when it's a combo (already a name/unit/qty snapshot
// on the ExpressProduct itself — no further lookups needed).
const getOnlineCatalogueItem = async (req, res) => {
  try {
    const { storeId, productId } = req.params;
    // See getOnlineCatalogue above — isActive is deliberately not part of
    // this filter, so a paused-via-master-switch store stays browsable.
    const store = await ExpressStore.findOne({ _id: storeId, isArchived: false, onlineShopEnabled: true });
    if (!store) return fail(res, 404, 'Store not found or inactive');

    const listing = await ExpressOnlineListing.findOne({ store: storeId, product: productId, isEnabled: true, price: { $ne: null } })
      .populate({ path: 'koyambeduProduct', select: 'name description images category', populate: { path: 'category', select: 'name' } })
      .populate({ path: 'product', select: 'unit name description image category isCombo comboContents isWeightBased minOrderQty maxOrderQty' })
      .lean();
    if (!listing || !listing.product) return fail(res, 404, 'Product not available at this store');

    const stockDoc = await ExpressStoreProduct.findOne({ store: storeId, product: productId }).select('stockQty').lean();

    const isNative = !listing.koyambeduProduct;
    const display = isNative ? listing.product : listing.koyambeduProduct;
    const categoryName = isNative ? (display?.category || null) : (display?.category?.name || null);

    res.json({
      success: true,
      store: { _id: store._id, name: store.name },
      product: {
        _id: listing.product._id,
        name: display?.name,
        description: display?.description,
        category: categoryName,
        unit: listing.product.unit,
        image: isNative
          ? (display?.image || null)
          : (display?.images?.find(i => i.isPrimary)?.url || display?.images?.[0]?.url || null),
        isCombo: !!listing.product.isCombo,
        comboContents: listing.product.isCombo ? (listing.product.comboContents || []) : [],
        isWeightBased: listing.product.isWeightBased !== false,
        minOrderQty: listing.product.minOrderQty || 0.25,
        maxOrderQty: listing.product.maxOrderQty || null,
      },
      stockQty: stockDoc?.stockQty || 0,
      pricePerUnit: listing.price,
      mrp: (listing.mrp && listing.mrp > listing.price) ? listing.mrp : null,
      discountPercent: (listing.mrp && listing.mrp > listing.price) ? Math.round(((listing.mrp - listing.price) / listing.mrp) * 100) : 0,
    });
  } catch (err) {
    console.error('[express.getOnlineCatalogueItem]', err);
    fail(res, 500, 'Failed to load product');
  }
};

// ── Store catalogue (section 8 — customer shops without seeing which store) ─
const getCatalogue = async (req, res) => {
  try {
    const { storeId } = req.params;
    const store = await ExpressStore.findOne({ _id: storeId, isActive: true, isArchived: false, onlineShopEnabled: true });
    if (!store) return fail(res, 404, 'Store not found or inactive');

    const config = await getMarginConfig();
    const storeProducts = await ExpressStoreProduct.find({ store: storeId, isAvailable: true, stockQty: { $gt: 0 } })
      .populate({
        path: 'product', match: { isActive: true },
        populate: {
          path: 'koyambeduProduct', select: 'name description images category',
          populate: { path: 'category', select: 'name' },
        },
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
            category: kb.category?.name || null,
            unit: sp.product.unit,
            image: kb.images?.find(i => i.isPrimary)?.url || kb.images?.[0]?.url || null,
            isWeightBased: sp.product.isWeightBased !== false,
            minOrderQty: sp.product.minOrderQty || 0.25,
            maxOrderQty: sp.product.maxOrderQty || null,
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
  const subtotal = roundRupee(cart.items.reduce((sum, i) => sum + i.price * i.quantity, 0));
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

    const store = await ExpressStore.findById(storeId).lean();
    if (!store || !store.isActive || store.isArchived) return fail(res, 400, 'This store is no longer available.');
    // Deliberately NOT blocked by store.isPaused — customers can keep
    // browsing and building their cart while a store is on hold for high
    // demand; only checkout (priceCart below) is gated until the store
    // reopens, so nobody loses the items they picked out while waiting.

    const storeProduct = await ExpressStoreProduct.findOne({ store: storeId, product: productId, isAvailable: true })
      .populate({ path: 'product', populate: { path: 'koyambeduProduct', select: 'name' } });
    // Product is sellable whether it's Koyambedu-linked (name comes from
    // the populated koyambeduProduct) or a native Express product/combo
    // (name lives directly on the ExpressProduct document) — either way we
    // just need the ExpressProduct itself to exist.
    if (!storeProduct || !storeProduct.product) return fail(res, 404, 'Product not available at this store');

    const config = await getMarginConfig();
    const pricing = computeSellingPrice(storeProduct.product, config, 1);
    const productName = storeProduct.product.koyambeduProduct?.name || storeProduct.product.name;

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
    // Checked against the TOTAL the cart would hold after this add
    // (existing quantity + what's being added now), not just the quantity
    // in this one request — otherwise three separate adds of, say, 5 units
    // each would each individually pass a 10-in-stock check while the cart
    // silently accumulates to 15, only surfacing as a confusing "only 10
    // left" error much later at checkout instead of being stopped here.
    const requestedTotal = (existing?.quantity || 0) + Number(quantity);
    if (storeProduct.stockQty < requestedTotal) {
      return fail(res, 400, existing
        ? `Only ${storeProduct.stockQty} of "${productName}" available — you already have ${existing.quantity} in your cart.`
        : `Only ${storeProduct.stockQty} of "${productName}" left in stock.`);
    }
    // Merchant-set per-order cap (maxOrderQty) — a business rule distinct
    // from stock availability, checked in addition to it, not instead of it.
    const maxOrderQty = storeProduct.product.maxOrderQty;
    if (maxOrderQty != null && requestedTotal > maxOrderQty) {
      return fail(res, 400, `You can order at most ${maxOrderQty}${storeProduct.product.unit === 'kg' ? ' kg' : ''} of "${productName}" per order.`);
    }
    if (existing) {
      existing.quantity += Number(quantity);
    } else {
      cart.items.push({
        product: productId,
        name: productName,
        unit: storeProduct.product.unit,
        price: roundRupee(storeProduct.priceOverride ?? pricing.sellingPricePerUnit),
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
      // This endpoint previously had NO stock check at all — the quantity
      // stepper on the shop page (+/-) calls this directly, so a customer
      // could step an item's quantity past what's actually in stock with
      // nothing stopping them, only discovering the mismatch much later as
      // a confusing "only N left" error at checkout. Validate here instead,
      // at the moment the quantity actually changes.
      const storeProduct = await ExpressStoreProduct.findOne({ store: cart.store, product: productId })
        .select('stockQty product').populate({ path: 'product', select: 'maxOrderQty unit' }).lean();
      if (storeProduct && Number(quantity) > storeProduct.stockQty) {
        return fail(res, 400, `Only ${storeProduct.stockQty} of "${item.name}" left in stock.`);
      }
      const maxOrderQty = storeProduct?.product?.maxOrderQty;
      if (maxOrderQty != null && Number(quantity) > maxOrderQty) {
        return fail(res, 400, `You can order at most ${maxOrderQty}${storeProduct.product.unit === 'kg' ? ' kg' : ''} of "${item.name}" per order.`);
      }
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
async function priceCart(userId, deliveryAddress, couponCode) {
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

  const store = await ExpressStore.findById(cart.store).lean();
  // Archived (soft-deleted) is the only truly terminal state — the store is
  // gone, not coming back. Everything else (the master isActive switch
  // flipped off, or a temporary isPaused hold) looks identical to a
  // customer who already has items in their cart: "we're not taking orders
  // right now." Previously isActive=false fell through to this same cold
  // "no longer available" message with no waitlist capture, which read as
  // the hold feature being broken whenever a manager used the master
  // on/off switch instead of the dedicated pause toggle.
  if (!store || store.isArchived) {
    const err = new Error('This store is no longer available.'); err.statusCode = 400; throw err;
  }
  if (store.isPaused || !store.isActive) {
    // Log this as demand waiting to be served (before throwing) so Admin
    // sees exactly who wants to order and can call them back once the
    // store reopens, rather than this interest just disappearing.
    await recordHoldInterest(store._id, userId, cart, deliveryAddress);
    const err = new Error(store.pauseMessage || "We're experiencing high demand right now — we'll open orders again shortly! Your cart is saved, so you can check out the moment we're back.");
    err.statusCode = 409; err.storePaused = true; throw err;
  }

  // Distance-based delivery fee + hard out-of-range cutoff. Beyond
  // maxDeliveryDistanceKm we don't silently fail — we flag it specially so
  // the frontend can offer a "call us for a custom order" option instead.
  // feeConfig is resolved here (not further down, where it used to be) so
  // the hard cutoff itself can use a per-store override, not just the
  // global default.
  const feeConfig = resolveDeliveryFeeConfig(store, config);
  const distKm = distanceKm(
    { lat: Number(deliveryAddress.lat), lng: Number(deliveryAddress.lng) },
    store.location
  );
  const maxKm = feeConfig.maxDeliveryDistanceKm;
  if (Number.isFinite(distKm) && distKm > maxKm) {
    const err = new Error(`You're ${distKm} km from this store, beyond our ${maxKm} km delivery range.`);
    err.statusCode = 400; err.outOfRange = true; err.distanceKm = distKm; err.maxDeliveryDistanceKm = maxKm;
    err.customOrderPhone = config.customOrderPhone || null;
    throw err;
  }

  const storeProducts = await ExpressStoreProduct.find({ store: cart.store, isAvailable: true })
    .populate('product')
    .lean();
  const byProductId = new Map(storeProducts.map(sp => [String(sp.product?._id), sp]));

  const items = [];
  let subtotal = 0;
  let totalWeightKg = 0;
  let itemsProcurementCost = 0;
  for (const line of cart.items) {
    const sp = byProductId.get(String(line.product));
    if (!sp || !sp.product) { const err = new Error(`"${line.name}" is no longer available.`); err.statusCode = 400; throw err; }
    if (sp.stockQty < line.quantity) { const err = new Error(`Only ${sp.stockQty} of "${line.name}" left in stock.`); err.statusCode = 400; throw err; }
    if (sp.product.maxOrderQty != null && line.quantity > sp.product.maxOrderQty) {
      const err = new Error(`You can order at most ${sp.product.maxOrderQty} of "${line.name}" per order.`); err.statusCode = 400; throw err;
    }

    const pricing = computeSellingPrice(sp.product, config, 1);
    const unitPrice = roundRupee(sp.priceOverride ?? pricing.sellingPricePerUnit);
    const lineTotal = roundRupee(unitPrice * line.quantity);
    subtotal += lineTotal;
    totalWeightKg += toKgEquivalent(sp.product, line.quantity);
    // Snapshot of what this line actually cost Express to procure+ship, for
    // bill-wise/overall profit reporting — see pricing.itemsProcurementCost.
    itemsProcurementCost += Math.round(pricing.baseCostPerUnit * line.quantity * 100) / 100;

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

  const roundedSubtotal = roundRupee(subtotal);
  // Delivery fee = value-based fee (free above minOrderForFreeDelivery,
  // else a flat fee) PLUS the distance surcharge beyond the store's free
  // radius — the two stack, they don't replace each other. A store with no
  // distance surcharge configured (the default) gets distanceSurcharge = 0,
  // so its delivery fee is unchanged from before this feature existed.
  const valueFee = computeDeliveryFee(roundedSubtotal, feeConfig);
  const distanceSurcharge = computeDistanceSurcharge(distKm, feeConfig);
  const deliveryFee = roundRupee(valueFee + distanceSurcharge);
  const { couponDiscount, appliedCode } = await applyCoupon(couponCode, roundedSubtotal);
  // Flat platform fee — global, admin-set (0 disables it), charged to the
  // customer alongside the delivery fee rather than quietly folded into it,
  // so it's always shown as its own line item.
  const platformFee = roundRupee(config.platformFeeAmount ?? 75);
  const total = Math.max(0, roundRupee(roundedSubtotal + deliveryFee + platformFee - couponDiscount));
  return {
    cart, items, subtotal: roundedSubtotal, deliveryFee, platformFee, total, totalWeightKg,
    itemsProcurementCost: Math.round(itemsProcurementCost * 100) / 100,
    largeOrderWarning: totalWeightKg > threshold, distanceKm: distKm,
    estimatedDeliveryMinutes: computeDeliveryEta(distKm, config),
    minOrderForFreeDelivery: feeConfig.minOrderForFreeDelivery, deliveryFeeBelowMinimum: feeConfig.deliveryFeeBelowMinimum,
    // Breakdown so the frontend can show the customer exactly why the fee
    // is what it is (e.g. "₹18 delivery fee: 1 km beyond your free 5 km
    // radius, charged per 2 km"), instead of just a single opaque number.
    valueFee, distanceSurcharge,
    freeDeliveryDistanceKm: feeConfig.freeDeliveryDistanceKm, distanceStepKm: feeConfig.distanceStepKm,
    distanceChargePerStep: feeConfig.distanceChargePerStep, maxDeliveryDistanceKm: maxKm,
    couponCode: appliedCode, couponDiscount,
  };
}

/** POST /express/quote */
const getQuote = async (req, res) => {
  try {
    const { deliveryAddress, couponCode } = req.body;
    const priced = await priceCart(req.user._id, deliveryAddress, couponCode);
    res.json({
      success: true, items: priced.items, subtotal: priced.subtotal, deliveryFee: priced.deliveryFee,
      total: priced.total, totalWeightKg: priced.totalWeightKg, largeOrderWarning: priced.largeOrderWarning,
      distanceKm: priced.distanceKm, estimatedDeliveryMinutes: priced.estimatedDeliveryMinutes,
      minOrderForFreeDelivery: priced.minOrderForFreeDelivery, deliveryFeeBelowMinimum: priced.deliveryFeeBelowMinimum,
      platformFee: priced.platformFee,
      valueFee: priced.valueFee, distanceSurcharge: priced.distanceSurcharge,
      freeDeliveryDistanceKm: priced.freeDeliveryDistanceKm, distanceStepKm: priced.distanceStepKm,
      distanceChargePerStep: priced.distanceChargePerStep, maxDeliveryDistanceKm: priced.maxDeliveryDistanceKm,
      couponCode: priced.couponCode, couponDiscount: priced.couponDiscount,
    });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({
        success: false, message: err.message,
        outOfRange: !!err.outOfRange, storePaused: !!err.storePaused,
        distanceKm: err.distanceKm, maxDeliveryDistanceKm: err.maxDeliveryDistanceKm, customOrderPhone: err.customOrderPhone,
      });
    }
    console.error('[express.getQuote]', err);
    fail(res, 500, 'Failed to price your order');
  }
};

/** POST /express/orders/create-razorpay */
const createRazorpayOrder = async (req, res) => {
  try {
    const { deliveryAddress, notes, deliverySlot, couponCode } = req.body;
    const priced = await priceCart(req.user._id, deliveryAddress, couponCode);

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
      pricing: {
        subtotal: priced.subtotal, deliveryFee: priced.deliveryFee, platformFee: priced.platformFee, total: priced.total,
        couponCode: priced.couponCode || null, couponDiscount: priced.couponDiscount || 0,
        itemsProcurementCost: priced.itemsProcurementCost || 0,
      },
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
    if (err.statusCode) {
      return res.status(err.statusCode).json({
        success: false, message: err.message,
        outOfRange: !!err.outOfRange, storePaused: !!err.storePaused,
        distanceKm: err.distanceKm, maxDeliveryDistanceKm: err.maxDeliveryDistanceKm, customOrderPhone: err.customOrderPhone,
      });
    }
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
    // Razorpay's own cut — flat 2% of what the customer actually paid,
    // online payments only (never for demo orders, which never really pay
    // Razorpay anything). Matches the same rate Koyambedu Daily's P&L uses
    // (RAZORPAY_FEE_PERCENT) for consistency across verticals.
    if (!order.isDemoOrder) {
      order.pricing.razorpayFee = Math.round(order.pricing.total * 2) / 100;
    }
    await order.save();
    notifyExpressBuyer(order, 'confirmed').catch(() => {});

    if (order.pricing?.couponCode) {
      EptoFreshCoupon.updateOne({ code: order.pricing.couponCode }, { $inc: { usedCount: 1 } }).catch(() => {});
    }

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
  getStatus, getActiveBanners, findNearestStore, getCatalogue,
  listActiveStores, getStoreEta, getOnlineCatalogue, getOnlineCatalogueItem,
  getCart, addToCart, updateCartItem, clearCart,
  getQuote, createRazorpayOrder, verifyPayment,
  getMyOrders, getMyOrder, cancelMyOrder,
  notifyExpressBuyer,
};
