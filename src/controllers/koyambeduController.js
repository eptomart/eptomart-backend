// ============================================
// KOYAMBEDU DAILY — Combined Controller
// Roles: superAdmin > admin > koyambeduSeller > buyer (user)
//
// SECURITY RULE: seller NEVER sees buyer address/phone.
// Only admin/superAdmin can see full buyer details.
// ============================================
'use strict';

const { applyCalculation, calculateOrderTotals } = require('../utils/orderCalculationService');
const { applyPriceRevision, lockOrderPrices }   = require('../utils/priceRevisionService');

const KoyambeduSeller       = require('../models/KoyambeduSeller');
const KoyambeduSellerAdmin  = require('../models/KoyambeduSellerAdmin');
const KoyambeduCategory     = require('../models/KoyambeduCategory');
const KoyambeduProduct      = require('../models/KoyambeduProduct');
const KoyambeduCart         = require('../models/KoyambeduCart');
const KoyambeduOrder        = require('../models/KoyambeduOrder');
const KoyambeduWallet       = require('../models/KoyambeduWallet');
const KoyambeduSettings     = require('../models/KoyambeduSettings');
const KoyambeduDeliverySlot = require('../models/KoyambeduDeliverySlot');
const KoyambeduProcurementChecklist = require('../models/KoyambeduProcurementChecklist');
const KoyambeduProcurementShare     = require('../models/KoyambeduProcurementShare');
const KoyambeduOfferBroadcast       = require('../models/KoyambeduOfferBroadcast');
const { notifyAudience, notifyAll } = require('../utils/pushNotification');
const User                  = require('../models/User');
const EptoFreshCoupon       = require('../models/EptoFreshCoupon');
const Product                = require('../models/Product');
const { rankByFuzzy }        = require('../utils/fuzzySearch');
const { fetchCandidates: fetchSearchCandidates, MAIN_FILTER, mainLink, toResult } = require('./searchController');
const Razorpay              = require('razorpay');
const crypto                = require('crypto');
const {
  sendTemplateWhatsApp,
  sendOrderStatusWhatsApp,
} = require('../utils/sendWhatsApp');

// ── Delivery constants ───────────────────────
const KOYAMBEDU_LAT  = 13.0748;
const KOYAMBEDU_LNG  = 80.2136;
// No delivery distance limit — serve all areas
const MIN_WEIGHT_KG  = 1;

/** Haversine distance in km */
const haversineKm = (lat1, lon1, lat2, lon2) => {
  const R    = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a    = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

/** Explicit "NN KG"/"NN KGS" weight stated in a product description, e.g. "Farm-fresh box — 13 KG". */
const KG_IN_DESC_RE = /(\d+(?:\.\d+)?)\s*kgs?\b/i;

/**
 * Weight per item in kg — feeds the weight-aware delivery fee slabs
 * (computeDeliveryCharge / the <15kg light-order flat-fee logic) ONLY.
 * Box/bunch products rarely have an explicit `weightKg` set, so before
 * falling back to a flat guess this checks the product description for a
 * stated weight (e.g. "13 KG" for a box). For bunches with no stated
 * weight, falls back to an estimate anchored on two reference points:
 * a 12kg-equivalent order of bunches is either ~5 heavy bunches (12/5 =
 * 2.4kg each) or up to ~10 light bunches (assume under 5kg total for 10,
 * i.e. ~0.5kg each). Does not affect pricing, the separate admin
 * gross-weight display (summarizeOrderWeight, unchanged), or anything else.
 */
const itemWeightKg = (item) => {
  const qty = item.quantity || 0;

  if (item.unit === 'box' || item.unit === 'bunch') {
    // `weightKg` defaults to 1 on every KoyambeduProduct (schema default)
    // and is almost never manually corrected for box/bunch items — treating
    // it as authoritative here would silently ignore a real weight stated
    // in the description (e.g. "13 KGS box"). So for box/bunch specifically,
    // the description is checked FIRST; `weightKg` is only trusted as a
    // fallback when it's been changed from that untouched default.
    // Sellers often put the weight in the product NAME instead of the
    // description (e.g. "Apple Dames Gala New Zealand 20 Kgs") — check both,
    // description first, falling back to the product/cart-item name.
    const descMatch =
      (item.product?.description || '').match(KG_IN_DESC_RE) ||
      (item.product?.name || item.name || '').match(KG_IN_DESC_RE);
    if (descMatch) return parseFloat(descMatch[1]) * qty;

    if (item.product?.weightKg != null && item.product.weightKg !== 1) {
      return item.product.weightKg * qty;
    }

    if (item.unit === 'bunch') {
      const perBunch = qty <= 5 ? 2.4 : 0.5;
      return perBunch * qty;
    }
    return 1 * qty; // box, no description weight, weightKg still at its untouched default
  }

  if (item.product?.weightKg != null) return item.product.weightKg * qty;
  if (item.unit === 'g') return 0.001 * qty;
  return 1 * qty; // unchanged default for everything else
};

/**
 * Live unit price for a product at a given quantity/grade, using the SAME
 * variant-tier matching logic as `updateCart` — kept as a single shared
 * helper so `getCart` (display refresh) and `placeOrder` (final gate) can
 * never compute two different prices for the same product/qty/grade combo.
 * Returns { unitPrice, minQty } — minQty is always `product.minQty`, the
 * same buyer-facing floor shown on the shop/detail page (deliberately NOT
 * derived from variant `fromQty`, which is a pricing-tier boundary, not a
 * minimum-order-quantity field).
 */
const getLiveUnitPriceAndMinQty = (product, quantity, gradeKey) => {
  let activeVariants = product.variants || [];
  if (product.gradesEnabled && product.grades?.length > 0) {
    const grade = product.grades.find(g => g.gradeKey === (gradeKey || 'premium') && g.isActive);
    if (grade) activeVariants = grade.variants || [];
  }
  let unitPrice = product.currentPrice || 0;
  if (activeVariants.length > 0) {
    const matchingVariant = activeVariants.find(v => {
      if (!v.toQty) return quantity >= v.fromQty;
      return quantity >= v.fromQty && quantity <= v.toQty;
    });
    if (matchingVariant?.finalPrice) unitPrice = matchingVariant.finalPrice;
  }
  return { unitPrice, minQty: product.minQty || 0 };
};

/** Delivery charge based on total weight */
const calcDeliveryCharge = (totalKg) => {
  if (totalKg < MIN_WEIGHT_KG)  return { blocked: true,  reason: 'below_min', charge: 0 };
  if (totalKg >= 20)            return { blocked: false,  reason: null,        charge: 249 };
  return                               { blocked: false,  reason: null,        charge: 149 };
};

/**
 * Summarizes a cart/order's items for the weight-aware delivery fee rule
 * (see computeDeliveryCharge): counts total bunches, and separately sums
 * the weight of every NON-bunch item (kg, box, piece, etc. — using the
 * same description/name-aware weight lookup as itemWeightKg). Bunches
 * themselves are only counted here, not weighed — the light-fare rule
 * gates purely on bunch count, not bunch weight.
 */
const summarizeCartForDeliveryFee = (items) => {
  let bunchCount = 0;
  let nonBunchWeightKg = 0;
  for (const it of items || []) {
    const qty = it.quantity || 0;
    if (!qty) continue;
    if (it.unit === 'bunch') {
      bunchCount += qty;
    } else {
      nonBunchWeightKg += itemWeightKg(it);
    }
  }
  return { bunchCount, nonBunchWeightKg: Math.round(nonBunchWeightKg * 100) / 100 };
};

/**
 * Distance + cart-composition based charges for "small orders" — delivery
 * fee, platform fee, and packing charge — with slashed/original prices for
 * a promotional discount display on checkout.
 *
 * A cart qualifies as a small order when it's "light":
 *   • If the cart has ANY bunches: bunch count ≤ 10 AND every non-bunch
 *     item combined weighs ≤ 5kg.
 *   • If the cart has NO bunches at all: non-bunch items combined weigh
 *     ≤ 12kg (the tighter 5kg cap only applies when bunches are present).
 * ...AND the delivery distance is ≤ 30km — beyond that, even a light cart
 * is treated as a normal order (per business rule: "beyond 30km considered
 * as normal order").
 *
 * Small-order delivery fee slabs (discounted price / struck-through original):
 *   0–5km: ₹49 / ₹149    6–10km: ₹99 / ₹199
 *   11–20km: ₹149 / ₹249  21–30km: ₹199 / ₹349
 * Small-order platform fee: ₹25 (vs standard ₹75), shown struck-through.
 * Small-order packing charge: flat ₹35 (no discount shown — this is a new
 * charge, not a markdown of an existing one).
 *
 * Normal (non-small) orders are completely unaffected: standard ₹125-per-4km
 * delivery, ₹75 flat platform fee, no packing charge — exactly as before.
 */
const computeKoyambeduCharges = (distanceKm, cartSummary) => {
  const isLight = !!cartSummary && (
    cartSummary.bunchCount > 0
      ? (cartSummary.bunchCount <= 10 && cartSummary.nonBunchWeightKg <= 5)
      : cartSummary.nonBunchWeightKg <= 12
  );
  const isSmallOrder = isLight && distanceKm <= 30;

  let deliveryCharge, originalDeliveryCharge;
  if (isSmallOrder) {
    if (distanceKm <= 5)       { deliveryCharge = 49;  originalDeliveryCharge = 149; }
    else if (distanceKm <= 10) { deliveryCharge = 99;  originalDeliveryCharge = 199; }
    else if (distanceKm <= 20) { deliveryCharge = 149; originalDeliveryCharge = 249; }
    else                       { deliveryCharge = 199; originalDeliveryCharge = 349; } // 21–30km
  } else {
    deliveryCharge = Math.ceil(distanceKm / 4) * 125;
    originalDeliveryCharge = null;
  }

  return {
    isSmallOrder,
    deliveryCharge,
    originalDeliveryCharge,
    platformFee:         isSmallOrder ? 25 : 75,
    originalPlatformFee: isSmallOrder ? 75 : null,
    packingCharge:        isSmallOrder ? 35 : 0,
  };
};

const getRazorpay = () => {
  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) return null;
  return new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET });
};

// ── WhatsApp helpers (fire-and-forget) ──────
const waSend = (phone, params) => {
  const tpl = process.env.META_WHATSAPP_STATUS_TEMPLATE;
  if (!tpl || !phone) return;
  sendTemplateWhatsApp(phone, tpl, [
    { type: 'body', parameters: params.map(t => ({ type: 'text', text: String(t) })) },
  ]).then(r => {
    if (!r.success) console.warn('[KBD WA] Failed to', phone, r.error);
  }).catch(() => {});
};

// ─── Mask buyer details for seller view ─────
// Seller NEVER sees: full address, phone, payment, GPS coords
// Seller CAN see: areaName (locality), item quantities, delivery date
const maskOrder = (order) => {
  const o = order.toObject ? order.toObject() : { ...order };
  // Remove buyer identity fields
  delete o.buyer;
  delete o.shippingAddress;
  delete o.deliveryPersonPhone;
  delete o.paymentDetails;
  // From buyerLocation, only expose safe area name
  if (o.buyerLocation) {
    o.deliveryArea = o.buyerLocation.areaName || o.buyerLocation.city || 'Chennai';
    delete o.buyerLocation;
  }
  // Keep only safe item fields
  o.items = (o.items || []).map(it => ({
    _id:         it._id,
    name:        it.name,
    unit:        it.unit,
    quantity:    it.quantity,
    deliveryType:it.deliveryType,
    orderedPrice:it.orderedPrice,
    finalPrice:  it.finalPrice,
    priceRevised:it.priceRevised,
    sellerPayout:it.sellerPayout,
    seller:      it.seller,
  }));
  return o;
};

// ══════════════════════════════════════════════
// SECTION 1 — PUBLIC / BUYER ROUTES
// ══════════════════════════════════════════════

/** GET /api/koyambedu/categories */
const getCategories = async (req, res) => {
  const cats = await KoyambeduCategory.find({ status: 'approved', isActive: true })
    .sort({ sortOrder: 1, name: 1 }).lean();
  // Build tree: root categories + their children
  const roots    = cats.filter(c => !c.parent);
  const children = cats.filter(c => c.parent);
  const tree = roots.map(r => ({
    ...r,
    subcategories: children.filter(c => String(c.parent) === String(r._id)),
  }));
  res.json({ success: true, categories: tree });
};

/** GET /api/koyambedu/products?category=&search=&deliveryType=&page= */
const getProducts = async (req, res) => {
  try {
    const { category, search, deliveryType, context, page = 1, limit = 20, sort = 'default' } = req.query;

    // context=navbar: Navbar/homepage search — find any active product regardless of today's slot,
    //                 so the search bar is never empty outside business hours.
    // All other contexts (shop listing, category browse): respect isAvailable.
    const filterAvailability = context !== 'navbar';

    const filter = {
      isActive: true,
      ...(filterAvailability ? { isAvailable: true } : {}),
      // Only show approved products; legacy products (no field) are treated as approved
      $or: [{ approvalStatus: 'approved' }, { approvalStatus: { $exists: false } }],
    };
    // Guard: only set category filter when value is a valid ObjectId.
    // Passing a slug string would cause a Mongoose CastError (500).
    if (category && /^[a-fA-F0-9]{24}$/.test(category)) filter.category = category;
    if (deliveryType === 'today')    filter.isSameDay = true;
    if (deliveryType === 'tomorrow') filter.isNextDay = true;
    if (search) {
      const re = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      // Use $and so the approval $or isn't overwritten by the name-search $or.
      filter.$and = [
        { $or: [{ approvalStatus: 'approved' }, { approvalStatus: { $exists: false } }] },
        { $or: [{ name: re }, { nameTamil: re }, { description: re }] },
      ];
      delete filter.$or;
    }

    const sortMap = {
      price_asc:  { currentPrice: 1,         _id: 1 },
      price_desc: { currentPrice: -1,         _id: 1 },
      fresh:      { freshArrivalDate: -1,     _id: 1 },
      popular:    { totalOrders: -1,          _id: 1 },
      default:    { freshArrivalDate: -1, totalOrders: -1, _id: 1 },
    };

    const skip = (Number(page) - 1) * Number(limit);
    let [products, total] = await Promise.all([
      KoyambeduProduct.find(filter)
        .populate('seller', 'businessName stallNumber marketSection rating servicePincodes')
        .populate('category', 'name icon')
        .sort(sortMap[sort] || sortMap.default)
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      KoyambeduProduct.countDocuments(filter),
    ]);

    // Near-match fallback — a search with a typo ("tomatoe", "bananna")
    // would otherwise return zero results from the literal regex filter
    // above. When that happens (page 1 only — this is a fallback, not a
    // paginated path), fuzzy-rank a broader candidate pool by edit-distance
    // similarity so the customer still sees the closest real products,
    // the way a normal e-commerce/Google search would.
    if (search && total === 0 && Number(page) === 1) {
      const candidateFilter = {
        isActive: true,
        ...(filterAvailability ? { isAvailable: true } : {}),
        $or: [{ approvalStatus: 'approved' }, { approvalStatus: { $exists: false } }],
      };
      const pool = await KoyambeduProduct.find(candidateFilter).sort({ createdAt: -1 }).limit(300).lean();
      const rankedIds = rankByFuzzy(pool, search, ['name', 'nameTamil']).slice(0, Number(limit)).map(r => r.doc._id);
      if (rankedIds.length) {
        const populated = await KoyambeduProduct.find({ _id: { $in: rankedIds } })
          .populate('seller', 'businessName stallNumber marketSection rating servicePincodes')
          .populate('category', 'name icon')
          .lean();
        const byId = new Map(populated.map(p => [String(p._id), p]));
        products = rankedIds.map(id => byId.get(String(id))).filter(Boolean);
        total = products.length;
      }
    }

    // Ecosystem-wide suggestions — surface near-matches from the main
    // Eptomart marketplace alongside Koyambedu's own results, so searching
    // "wherever" in the app searches the whole ecosystem, not just this
    // vertical. Kept as a small separate list (not merged into the paginated
    // grid) so it never disturbs Koyambedu's own pagination/sort order.
    let alsoOnEptomart = [];
    if (search) {
      try {
        const mainCandidates = await fetchSearchCandidates(
          Product, MAIN_FILTER, search, ['name', 'brand', 'tags', 'description'], { createdAt: -1 }
        );
        alsoOnEptomart = rankByFuzzy(mainCandidates, search, ['name', 'brand'])
          .slice(0, 6)
          .map(({ doc }) => toResult(doc, 'main', mainLink));
      } catch { /* never let cross-vertical suggestions break Koyambedu's own search */ }
    }

    // Enrich graded products with lowestUnitPrice across all active grades
    const enrichedProducts = products.map(p => {
      if (p.gradesEnabled && p.grades?.length > 0) {
        return { ...p, lowestUnitPrice: getLowestUnitPriceAcrossGrades(p.grades) };
      }
      return { ...p, lowestUnitPrice: getLowestUnitPrice(p.variants || []) };
    });
    res.json({
      success: true,
      products: enrichedProducts,
      total,
      page: Number(page),
      pages: Math.ceil(total / limit),
      alsoOnEptomart,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/** GET /api/koyambedu/products/featured — home page sections */
const getFeaturedProducts = async (req, res) => {
  try {
    const base = {
      isActive: true,
      isAvailable: true,   // hide products marked unavailable today
      $or: [{ approvalStatus: 'approved' }, { approvalStatus: { $exists: false } }],
    };

    const safeFind = (query) => query.catch(() => []);

    const [freshArrivals, deals, flowers, bulk, seasonal, anyProducts] = await Promise.all([
      safeFind(KoyambeduProduct.find({ ...base, badges: 'fresh_arrival' })
        .populate('category', 'name icon').sort({ freshArrivalDate: -1 }).limit(8).lean()),
      safeFind(KoyambeduProduct.find({ ...base, badges: 'best_seller' })
        .populate('category', 'name icon').sort({ totalOrders: -1 }).limit(8).lean()),
      safeFind(KoyambeduProduct.find({ ...base, category: { $exists: true } })
        .populate('category', 'name icon slug').sort({ totalOrders: -1 }).limit(8).lean()
        .then(prods => prods.filter(p => p.category?.name?.toLowerCase().includes('flower') || p.category?.slug?.includes('flower')))),
      safeFind(KoyambeduProduct.find({ ...base, isBulkAvailable: true })
        .populate('category', 'name icon').sort({ totalOrders: -1 }).limit(6).lean()),
      safeFind(KoyambeduProduct.find({ ...base, badges: 'seasonal' })
        .populate('category', 'name icon').sort({ freshArrivalDate: -1 }).limit(6).lean()),
      safeFind(KoyambeduProduct.find(base)
        .populate('category', 'name icon').sort({ createdAt: -1 }).limit(8).lean()),
    ]);

    // Fallback: if specific badge sections are empty, use any available products
    const fallback = anyProducts || [];
    res.json({
      success: true,
      sections: {
        freshArrivals: freshArrivals.length ? freshArrivals : fallback,
        deals:         deals.length         ? deals         : fallback,
        flowers,
        bulk,
        seasonal:      seasonal.length      ? seasonal      : fallback,
      },
    });
  } catch (err) {
    // Never crash the Koyambedu home page — return empty sections
    res.json({ success: true, sections: { freshArrivals: [], deals: [], flowers: [], bulk: [], seasonal: [] } });
  }
};

/**
 * GET /api/koyambedu/products/homepage?limit=10
 * Curated list for Eptomart home page spotlight section.
 * Priority: best-sellers → recently price-updated → newest.
 * Never crashes — always returns a (possibly empty) array.
 */
const getHomepageProducts = async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 10, 20);
    const base = {
      isActive: true,
      isAvailable: true,
      $or: [{ approvalStatus: 'approved' }, { approvalStatus: { $exists: false } }],
    };

    const products = await KoyambeduProduct.find(base)
      .populate('category', 'name icon')
      .populate('seller', 'businessName stallNumber rating')
      .sort({ totalOrders: -1, priceUpdatedAt: -1, createdAt: -1 })
      .limit(limit)
      .lean();

    const enriched = products.map(p => {
      const lowestUnitPrice = p.gradesEnabled && p.grades?.length > 0
        ? getLowestUnitPriceAcrossGrades(p.grades)
        : getLowestUnitPrice(p.variants || []);
      return { ...p, lowestUnitPrice };
    });

    res.json({ success: true, products: enriched });
  } catch (err) {
    res.json({ success: true, products: [] });
  }
};

/** GET /api/koyambedu/products/:productId */
const getProductDetail = async (req, res) => {
  const product = await KoyambeduProduct.findOne({ _id: req.params.productId, isActive: true })
    .populate('seller', 'businessName stallNumber marketSection rating ratingCount offersSameDay offersNextDay sameDayCutoff')
    .populate('category', 'name nameTamil icon slug')
    .lean();
  if (!product) return res.status(404).json({ success: false, message: 'Product not found' });
  res.json({ success: true, product });
};

/** POST /api/koyambedu/check-delivery — validate location + return delivery charge */
const checkDeliveryAvailability = async (req, res) => {
  const { lat, lng } = req.body;
  if (lat == null || lng == null) {
    return res.status(400).json({
      success: false,
      available: false,
      message: 'Please share your location to check Koyambedu Fresh delivery availability.',
    });
  }

  const distanceKm = haversineKm(Number(lat), Number(lng), KOYAMBEDU_LAT, KOYAMBEDU_LNG);

  // Cart-composition-aware small-order charges (see computeKoyambeduCharges):
  // light carts — ≤10 bunches AND ≤5kg of non-bunch items (or ≤12kg with no
  // bunches) — within 30km get discounted delivery/platform fees plus a
  // packing charge, shown to the customer with the original price struck
  // through; otherwise it's the standard rate with no packing charge.
  let cartSummary = null;
  if (req.user?._id) {
    const cart = await KoyambeduCart.findOne({ user: req.user._id }).populate('items.product', 'weightKg unit description name');
    if (cart?.items?.length) {
      cartSummary = summarizeCartForDeliveryFee(cart.items);
    }
  }
  const kmRounded = Math.round(distanceKm * 10) / 10;
  const charges   = computeKoyambeduCharges(distanceKm, cartSummary);

  res.json({
    success:       true,
    available:     true,
    distanceKm:    kmRounded,
    deliveryCharge:         charges.deliveryCharge,
    originalDeliveryCharge: charges.originalDeliveryCharge,
    platformFee:            charges.platformFee,
    originalPlatformFee:    charges.originalPlatformFee,
    packingCharge:          charges.packingCharge,
    isSmallOrder:           charges.isSmallOrder,
    message:       `Delivery available · ${kmRounded} km from Koyambedu market`,
  });
};

/** GET /api/koyambedu/slots */
const getDeliverySlots = async (req, res) => {
  await KoyambeduDeliverySlot.seedDefaults();
  // One-time migration: fix any old '10:00' or '14:00' cutoffs on today slots to '08:00'
  await KoyambeduDeliverySlot.updateMany(
    { type: 'today', cutoffTime: { $in: ['10:00', '14:00'] } },
    { $set: { cutoffTime: '08:00' } }
  ).catch(() => {});
  // Migrate existing products that still have sameDayCutoff '10:00' to '08:00'
  await KoyambeduProduct.updateMany(
    { sameDayCutoff: '10:00' },
    { $set: { sameDayCutoff: '08:00' } }
  ).catch(() => {});
  const now   = new Date();
  const hhmm  = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  const slots = await KoyambeduDeliverySlot.find({ isActive: true }).sort({ sortOrder: 1 }).lean();
  // Mark today slots as expired if past 8 AM cutoff
  const enriched = slots.map(s => ({
    ...s,
    available: s.type === 'tomorrow' ? true : (hhmm <= s.cutoffTime),
  }));
  res.json({ success: true, slots: enriched });
};

// ══════════════════════════════════════════════
// SECTION 2 — CART (authenticated buyer)
// ══════════════════════════════════════════════

/** GET /api/koyambedu/cart */
const getCart = async (req, res) => {
  // Do NOT use .lean() — we need a Mongoose document so we can save if items need pruning
  const cart = await KoyambeduCart.findOne({ user: req.user._id })
    .populate({
      path: 'items.product',
      select: 'name nameTamil currentPrice unit minQty maxQty qtyStep isAvailable isActive isSameDay isNextDay images weightKg variants gradesEnabled grades',
      populate: { path: 'seller', select: 'businessName isActive status' },
    });

  if (!cart) {
    return res.json({ success: true, cart: { items: [] }, minQtyIssues: [] });
  }

  const isActive = (it) =>
    it.product?.isActive && it.product?.isAvailable &&
    it.product?.seller?.isActive && it.product?.seller?.status === 'approved';

  // If any inactive/unavailable items are present, remove them from the DB now
  // so that placeOrder never encounters them and throws a false "unavailable" error
  const hadInactive = cart.items.some(it => !isActive(it));
  if (hadInactive) {
    cart.items = cart.items.filter(isActive);
  }

  // Always refresh price + collect minQty issues against the LIVE product —
  // a cart is frequently viewed minutes/hours/days after items were added, and
  // daily price updates or admin edits to minQty must never be silently ignored.
  const minQtyIssues = [];
  let pricesChanged = hadInactive;
  for (const it of cart.items) {
    const p = it.product;
    if (!p) continue;
    const { unitPrice, minQty } = getLiveUnitPriceAndMinQty(p, it.quantity, it.gradeKey);
    if (unitPrice && unitPrice !== it.unitPrice) {
      it.unitPrice = unitPrice;
      pricesChanged = true;
    }
    if (minQty > 0 && it.quantity < minQty) {
      minQtyIssues.push({
        productId: p._id, name: p.name, gradeName: it.gradeName || null,
        quantity: it.quantity, minQty, unit: p.unit,
      });
    }
  }
  if (pricesChanged) await cart.save();

  res.json({ success: true, cart: cart.toObject(), minQtyIssues });
};

/** POST /api/koyambedu/cart — add or update item */
const updateCart = async (req, res) => {
  const { productId, quantity, deliveryType = 'tomorrow', gradeKey = null } = req.body;

  // Guard: reject before MongoDB even attempts an ObjectId cast
  if (!productId || String(productId) === 'null' || String(productId) === 'undefined') {
    return res.status(400).json({ success: false, message: 'Invalid product ID' });
  }

  // ── Explicit removal (quantity <= 0) — handled BEFORE the product lookup
  // below. Removing a cart line must never require the referenced product
  // to still exist/be active: if it was deleted or deactivated after being
  // added to the cart, the customer still needs to be able to remove it.
  // The product-existence + availability checks further down are only
  // meaningful for add/increase operations and are left completely
  // unchanged for that path.
  if (Number(quantity) <= 0) {
    let cart = await KoyambeduCart.findOne({ user: req.user._id });
    if (cart) {
      const idx = cart.items.findIndex(i =>
        String(i.product) === String(productId) &&
        (gradeKey ? (i.gradeKey || null) === (gradeKey || null) : true)
      );
      if (idx > -1) {
        cart.items.splice(idx, 1);
        await cart.save();
      }
    } else {
      cart = new KoyambeduCart({ user: req.user._id, items: [] });
    }

    await cart.populate({
      path: 'items.product',
      select: 'name unit images qtyStep minQty maxQty currentPrice variants gradesEnabled grades isActive isAvailable',
      populate: { path: 'seller', select: 'isActive status' },
    });
    const cartObj = cart.toObject();
    cartObj.items = cartObj.items.filter(it =>
      it.product?.isActive && it.product?.isAvailable &&
      it.product?.seller?.isActive && it.product?.seller?.status === 'approved'
    );
    return res.json({ success: true, cart: cartObj });
  }

  const product = await KoyambeduProduct.findOne({ _id: productId, isActive: true, isAvailable: true })
    .populate('seller', '_id status isActive');
  if (!product) return res.status(404).json({ success: false, message: 'Product not found or unavailable' });
  if (product.seller?.status !== 'approved' || !product.seller?.isActive) {
    return res.status(400).json({ success: false, message: 'Seller not available' });
  }
  if (deliveryType === 'today' && !product.isSameDay) {
    return res.status(400).json({ success: false, message: 'Same-day delivery not available for this product' });
  }
  if (deliveryType === 'tomorrow' && !product.isNextDay) {
    return res.status(400).json({ success: false, message: 'Next-day delivery not available for this product' });
  }

  // Resolve grade (for graded products, gradeKey is required)
  let resolvedGradeKey  = null;
  let resolvedGradeName = null;
  let activeVariants    = product.variants || [];

  if (product.gradesEnabled && product.grades?.length > 0) {
    const effectiveGradeKey = gradeKey || 'premium'; // default to first active grade
    const grade = product.grades.find(g => g.gradeKey === effectiveGradeKey && g.isActive);
    if (!grade) return res.status(400).json({ success: false, message: 'Selected grade not available' });
    resolvedGradeKey  = grade.gradeKey;
    resolvedGradeName = grade.gradeName || grade.gradeKey;
    activeVariants    = grade.variants || [];
  }

  let cart = await KoyambeduCart.findOne({ user: req.user._id });
  if (!cart) cart = new KoyambeduCart({ user: req.user._id, items: [] });

  // For graded products: match on product + gradeKey; otherwise match on product only
  const idx = cart.items.findIndex(i =>
    String(i.product) === String(productId) &&
    (product.gradesEnabled ? (i.gradeKey || null) === (resolvedGradeKey || null) : true)
  );

  const qtyNum = Number(quantity);

  if (qtyNum <= 0) {
    // Explicit remove
    if (idx > -1) cart.items.splice(idx, 1);
  } else {
    const maxQtyVal = (product.maxQty != null) ? product.maxQty : Infinity;
    const qty = Math.min(maxQtyVal, qtyNum);

    // Determine unit price from the matching variant tier (grade-aware)
    let unitPrice = product.currentPrice || 0;
    if (activeVariants.length > 0) {
      const matchingVariant = activeVariants.find(v => {
        if (!v.toQty) return qty >= v.fromQty;
        return qty >= v.fromQty && qty <= v.toQty;
      });
      if (matchingVariant?.finalPrice) unitPrice = matchingVariant.finalPrice;
    }

    const itemData = {
      product:     product._id,
      seller:      product.seller._id,
      name:        product.name,
      unitPrice,
      unit:        product.unit,
      quantity:    qty,
      deliveryType,
      gradeKey:    resolvedGradeKey,
      gradeName:   resolvedGradeName,
    };
    if (idx > -1) { Object.assign(cart.items[idx], itemData); }
    else          { cart.items.push(itemData); }
  }

  await cart.save();

  // Populate product (+ seller) so frontend stepper gets full product data (images, qtyStep, etc.)
  // Also populate seller so we can apply the same active/approved filter as getCart —
  // this prevents previously-filtered items from reappearing after every quantity update.
  await cart.populate({
    path: 'items.product',
    select: 'name unit images qtyStep minQty maxQty currentPrice variants gradesEnabled grades isActive isAvailable',
    populate: { path: 'seller', select: 'isActive status' },
  });

  const cartObj = cart.toObject();
  cartObj.items = cartObj.items.filter(it =>
    it.product?.isActive && it.product?.isAvailable &&
    it.product?.seller?.isActive && it.product?.seller?.status === 'approved'
  );

  res.json({ success: true, cart: cartObj });
};

/** DELETE /api/koyambedu/cart/clear */
const clearCart = async (req, res) => {
  await KoyambeduCart.findOneAndUpdate({ user: req.user._id }, { items: [] });
  res.json({ success: true });
};

// ══════════════════════════════════════════════
// SECTION 3 — ORDERS (buyer)
// ══════════════════════════════════════════════

/** POST /api/koyambedu/orders — place order */
const placeOrder = async (req, res) => {
  const { shippingAddress, paymentMethod = 'razorpay', deliverySlot, deliverySlotKey, deliveryDate, notes, buyerLocation, couponCode } = req.body;

  // ── 1. Location mandatory ──────────────────────────────────
  if (!buyerLocation?.lat || !buyerLocation?.lng) {
    return res.status(400).json({
      success: false,
      message: 'Please share your location to check Koyambedu Fresh delivery availability.',
    });
  }

  // ── 1b. Delivery slot mandatory ────────────────────────────
  const VALID_SLOT_KEYS = ['slot1', 'slot2', 'slot3', 'slot4'];
  if (!deliverySlotKey || !VALID_SLOT_KEYS.includes(deliverySlotKey)) {
    return res.status(400).json({ success: false, message: 'Please select a delivery slot.' });
  }
  if (!deliveryDate) {
    return res.status(400).json({ success: false, message: 'Please select a delivery date.' });
  }

  // ── 1c. Validate slot against DB schedule (Super Admin managed) ─
  const { validateSlotForOrder } = require('./koyambeduScheduleController');
  const slotCheck = await validateSlotForOrder(deliveryDate, deliverySlotKey);
  if (!slotCheck.valid) {
    return res.status(400).json({ success: false, message: slotCheck.message });
  }

  const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
  const nowIST    = new Date(Date.now() + IST_OFFSET_MS);
  const todayISO  = nowIST.toISOString().split('T')[0];

  // ── 2. Distance check ─────────────────────────────────────
  const distanceKm = haversineKm(
    Number(buyerLocation.lat), Number(buyerLocation.lng),
    KOYAMBEDU_LAT, KOYAMBEDU_LNG
  );
  // ── 3. Address ────────────────────────────────────────────
  if (!shippingAddress?.fullName || !shippingAddress?.addressLine1 || !shippingAddress?.pincode) {
    return res.status(400).json({ success: false, message: 'Full shipping address required' });
  }

  // ── 4. Cart ───────────────────────────────────────────────
  const cart = await KoyambeduCart.findOne({ user: req.user._id })
    .populate({
      path: 'items.product',
      populate: { path: 'seller', select: 'status isActive commissionRate contact businessName notifyWhatsApp servicePincodes' },
    });

  if (!cart || !cart.items.length) {
    return res.status(400).json({ success: false, message: 'Cart is empty' });
  }

  // ── 4b. Pincode check — buyer pincode must match each seller's servicePincodes ──
  const buyerPincode = String(shippingAddress.pincode).trim();
  for (const ci of cart.items) {
    const seller = ci.product?.seller;
    if (seller?.servicePincodes?.length > 0) {
      if (!seller.servicePincodes.includes(buyerPincode)) {
        return res.status(400).json({
          success: false,
          message: `"${ci.product?.name || 'A product'}" is not available for delivery to pincode ${buyerPincode}. This seller only delivers to: ${seller.servicePincodes.join(', ')}.`,
          pincodeBlocked: true,
          blockedProduct: ci.product?.name,
          sellerPincodes: seller.servicePincodes,
        });
      }
    }
  }

  // ── 5. Weight check ───────────────────────────────────────
  const totalWeightKg = cart.items.reduce((s, ci) => s + itemWeightKg(ci), 0);

  if (totalWeightKg < MIN_WEIGHT_KG) {
    return res.status(400).json({ success: false, message: 'Minimum order quantity is 1 kg.' });
  }

  // ── 6. Build order items ──────────────────────────────────
  // Price + minimum-quantity are ALWAYS recomputed from the live product
  // here — never trust what was snapshotted into the cart at add-to-cart
  // time, since either can have changed since then (daily price updates,
  // admin editing minQty, etc.). Any item now below its current minQty
  // blocks the whole order with a structured list the frontend can use to
  // highlight exactly which items need fixing before payment.
  let subtotal = 0;
  const orderItems     = [];
  const deliveryTypes  = new Set();
  const minQtyViolations = [];

  for (const ci of cart.items) {
    const p  = ci.product;
    const sl = p.seller;
    if (!p?.isActive || !p?.isAvailable || sl?.status !== 'approved' || !sl?.isActive) {
      return res.status(400).json({ success: false, message: `"${p?.name || 'A product'}" is currently unavailable` });
    }
    const { unitPrice, minQty } = getLiveUnitPriceAndMinQty(p, ci.quantity, ci.gradeKey);
    if (minQty > 0 && ci.quantity < minQty) {
      minQtyViolations.push({
        productId: p._id, name: p.name, gradeName: ci.gradeName || null,
        quantity: ci.quantity, minQty, unit: p.unit,
      });
      continue; // skip pricing this item — request will be rejected below
    }
    const lineTotal    = unitPrice * ci.quantity;
    const commission   = (sl.commissionRate || 8) / 100;
    const sellerPayout = lineTotal * (1 - commission);
    subtotal += lineTotal;
    deliveryTypes.add(ci.deliveryType);
    // Embed grade in name so every downstream surface (order detail, SA panel,
    // invoices, reports) shows the grade even without checking gradeKey separately.
    const itemDisplayName = (p.gradesEnabled && ci.gradeName)
      ? `${p.name} (${ci.gradeName})`
      : p.name;

    orderItems.push({
      product:      p._id,
      seller:       sl._id,
      name:         itemDisplayName,
      unit:         p.unit,
      quantity:     ci.quantity,
      deliveryType: ci.deliveryType,
      orderedPrice: unitPrice,
      finalPrice:   unitPrice,
      sellerPayout: Math.round(sellerPayout * 100) / 100,
      gradeKey:     ci.gradeKey  || null,
      gradeName:    ci.gradeName || null,
    });
  }

  if (minQtyViolations.length > 0) {
    return res.status(400).json({
      success: false,
      message: `Minimum quantity not met for ${minQtyViolations.length} item${minQtyViolations.length > 1 ? 's' : ''}. Please update your cart before proceeding.`,
      minQtyViolations,
    });
  }

  // ── 6b. Same-day delivery global gate (Super Admin controlled) ──────
  // Checked IN ADDITION TO the per-slot schedule validation in step 1c above
  // (that one only knows about individual slot start times; this is a single
  // platform-wide on/off switch + cutoff time, replacing what used to be a
  // hardcoded 9 AM check that lived only in the checkout frontend).
  if (deliveryTypes.has('today')) {
    const KoyambeduSettings = require('../models/KoyambeduSettings');
    const sameDay = await KoyambeduSettings.getSameDayDelivery();
    if (!sameDay.enabled) {
      return res.status(400).json({ success: false, message: 'Same-day delivery is currently unavailable. Please choose tomorrow\'s delivery instead.' });
    }
    if (todayISO === String(deliveryDate).slice(0, 10)) {
      const [cutH, cutM] = sameDay.cutoffTime.split(':').map(Number);
      const cutoffMinutes = cutH * 60 + cutM;
      const nowMinutes = nowIST.getUTCHours() * 60 + nowIST.getUTCMinutes();
      if (nowMinutes >= cutoffMinutes) {
        return res.status(400).json({ success: false, message: `Same-day ordering closes at ${sameDay.cutoffTime}. Please choose tomorrow's delivery instead.` });
      }
    }
  }

  // ── 7. Minimum order check ────────────────────────────────────
  const MIN_ORDER_VALUE = 799;
  if (subtotal < MIN_ORDER_VALUE) {
    return res.status(400).json({
      success: false,
      message: `Minimum order value is ₹${MIN_ORDER_VALUE.toLocaleString('en-IN')}. Your cart total is ₹${subtotal.toFixed(0)}.`,
    });
  }

  // ── 7b. Delivery charge — cart-composition-aware distance slabs (see computeDeliveryCharge) ──
  // Uses its own bunch-count/non-bunch-weight summary, kept separate from
  // `totalWeightKg` above (which stays exactly as-is for the unrelated
  // 1kg minimum-order-quantity gate).
  const charges = computeKoyambeduCharges(distanceKm, summarizeCartForDeliveryFee(cart.items));
  const { deliveryCharge, originalDeliveryCharge, platformFee, originalPlatformFee, packingCharge, isSmallOrder } = charges;
  const deliveryType   = deliveryTypes.size > 1 ? 'mixed' : [...deliveryTypes][0];

  // ── 7b. Coupon discount (applied on subtotal, shipping excluded) ──
  let couponDiscount = 0;
  let appliedCoupon  = null;
  if (couponCode) {
    const coupon = await EptoFreshCoupon.findOne({
      code:          couponCode.toUpperCase().trim(),
      isActive:      true,
      requestStatus: { $in: ['admin_created', 'approved'] },
      validFrom:     { $lte: new Date() },
      validTo:       { $gte: new Date() },
    });
    // Koyambedu: allow 'all' or 'koyambedu' platform coupons
    const koyPlatformOk = !coupon || !coupon.platformRestriction || ['all', 'koyambedu'].includes(coupon.platformRestriction);
    if (coupon && koyPlatformOk && coupon.usedCount < coupon.maxUsage && subtotal >= coupon.minOrderValue) {
      if (coupon.discountType === 'flat') {
        couponDiscount = Math.min(coupon.discountValue, subtotal);
      } else {
        couponDiscount = (subtotal * coupon.discountValue) / 100;
        if (coupon.maxDiscount) couponDiscount = Math.min(couponDiscount, coupon.maxDiscount);
      }
      couponDiscount = parseFloat(couponDiscount.toFixed(2));
      appliedCoupon  = coupon;
    }
  }

  // ── 7c. Wallet balance adjustment (Feature 5 — Next Order Recovery) ───────
  // Positive wallet → apply as discount (capped at order total, never negative).
  // Negative wallet → recover debt (add to total).
  let walletAdjustment = 0;
  let walletDoc = null;
  try {
    walletDoc = await KoyambeduWallet.findOne({ user: req.user._id });
    if (walletDoc && walletDoc.balance !== 0) {
      const baseTotal = parseFloat((subtotal + deliveryCharge + platformFee + packingCharge - couponDiscount).toFixed(2));
      if (walletDoc.balance > 0) {
        // Credit: only available balance (total − reserved) can be applied at checkout
        const available = parseFloat((walletDoc.balance - (walletDoc.reservedBalance || 0)).toFixed(2));
        walletAdjustment = Math.min(Math.max(0, available), baseTotal);
      } else {
        // Debt: add full amount to recover on this order
        walletAdjustment = parseFloat(walletDoc.balance.toFixed(2));
      }
    }
  } catch (_) { /* non-blocking */ }

  // walletAdjustment: positive = reduces total, negative = increases total
  const baseTotal = parseFloat((subtotal + deliveryCharge + platformFee + packingCharge - couponDiscount).toFixed(2));
  const total = parseFloat((baseTotal - walletAdjustment).toFixed(2));

  // ── 8. Save order ─────────────────────────────────────────
  // Validate deliveryDate: must be today or future, not more than 2 days ahead
  let parsedDeliveryDate = null;
  if (deliveryDate) {
    parsedDeliveryDate = new Date(deliveryDate);
    parsedDeliveryDate.setHours(0, 0, 0, 0);
    const todayMidnight = new Date(); todayMidnight.setHours(0, 0, 0, 0);
    const maxDate = new Date(todayMidnight); maxDate.setDate(maxDate.getDate() + 2);
    if (parsedDeliveryDate < todayMidnight || parsedDeliveryDate > maxDate) {
      return res.status(400).json({ success: false, message: 'Invalid delivery date. You can book max 2 days in advance.' });
    }
  }

  // Build itemsOrdered snapshot (immutable — never changes after save)
  const itemsOrderedSnapshot = orderItems.map(it => ({
    product:      it.product,
    seller:       it.seller,
    name:         it.name,
    unit:         it.unit,
    orderedQty:   it.quantity,
    unitPrice:    it.orderedPrice,
    lineTotal:    it.orderedPrice * it.quantity,
    sellerPayout: it.sellerPayout,
    gradeKey:     it.gradeKey  || null,
    gradeName:    it.gradeName || null,
  }));

  // Enrich items with orderedQty / confirmedQty / itemStatus fields
  const enrichedItems = orderItems.map(it => ({
    ...it,
    orderedQty:   it.quantity,
    confirmedQty: it.quantity,   // starts equal to orderedQty
    declinedQty:  0,
    itemStatus:   'pending',
  }));

  const pricingObj = {
    subtotal,
    deliveryCharge,
    deliveryDistance: Math.round(distanceKm * 10) / 10,
    platformFee,
    packingLogisticsFee: packingCharge,
    discount:       couponDiscount,
    couponCode:     appliedCoupon?.code || undefined,
    walletAdjustment, // positive = customer saved, negative = debt recovered
    total,
    isSmallOrder,
    originalDeliveryCharge: originalDeliveryCharge ?? undefined,
    originalPlatformFee:    originalPlatformFee    ?? undefined,
  };

  // ── 9. Build the order ───────────────────────────────────────────────────────
  // For Razorpay: order status is 'payment_pending' until verifyPayment succeeds.
  //   - Cart is NOT cleared here (preserved so customer can retry if payment fails)
  //   - Coupon usage is NOT incremented here (done in verifyPayment after confirmation)
  //   - Seller notification is NOT sent here (sent after payment confirmation)
  // For COD / wallet_full: order is immediately placed, cart cleared, coupon incremented,
  //   wallet deducted, seller notified.
  const isRazorpay = paymentMethod === 'razorpay';
  const isWalletFull = paymentMethod === 'wallet_full';

  // Description label used in timeline event
  const orderPlacedDesc = isWalletFull
    ? 'Order placed by customer (Wallet — full payment)'
    : 'Order placed by customer (COD)';

  const order = new KoyambeduOrder({
    buyer:        req.user._id,
    buyerLocation: {
      lat:        Number(buyerLocation.lat),
      lng:        Number(buyerLocation.lng),
      areaName:   buyerLocation.areaName || '',
      city:       buyerLocation.city || shippingAddress.city || 'Chennai',
      pincode:    buyerLocation.pincode || shippingAddress.pincode || '',
      distanceKm: Math.round(distanceKm * 10) / 10,
    },
    shippingAddress,
    itemsOrdered: itemsOrderedSnapshot,
    items:        enrichedItems,
    deliveryType,
    deliveryDate:    parsedDeliveryDate,
    deliverySlot:    deliverySlot    || '9 AM – 12 PM',
    deliverySlotKey: deliverySlotKey || 'slot2',
    orderTimestamp:  new Date(),
    cutoffCycle:     getProcurementCycle(new Date()),
    procurementDate: new Date(getProcurementCycle(new Date())),
    paymentMethod,
    // wallet_full is fully paid at placement (no cash collected, wallet was debited)
    paymentStatus: isWalletFull ? 'paid' : 'pending',
    // Razorpay: hold at payment_pending until payment is verified.
    // COD / wallet_full: immediately placed.
    orderStatus:  isRazorpay ? 'payment_pending' : 'placed',
    pricing:      pricingObj,
    adminNotes:   notes || '',
    invoices: isRazorpay ? {} : {
      // For COD/wallet_full, generate proforma immediately. For Razorpay, generated in verifyPayment.
      proforma: {
        number:      `PRO-${Date.now().toString(36).toUpperCase()}`,
        generatedAt: new Date(),
        isAvailable: true,
      },
    },
    timeline: isRazorpay ? [] : [{
      // For Razorpay, timeline starts in verifyPayment. For others, record placement now.
      event:       'order_placed',
      description: orderPlacedDesc,
      actor:       { role: 'customer', userId: req.user._id, name: req.user.name || '' },
      timestamp:   new Date(),
    }],
  });

  // Compute calculatedPricing using the service
  applyCalculation(order);

  await order.save();

  if (!isRazorpay) {
    // ── COD / wallet_full: clear cart, increment coupon, deduct wallet, notify sellers ──
    try {
      await KoyambeduCart.findOneAndUpdate({ user: req.user._id }, { items: [] });
    } catch (e) {
      console.error('[KBD] Cart-clear failed after COD/wallet order', order.orderId, ':', e.message);
    }

    if (appliedCoupon) {
      await EptoFreshCoupon.findByIdAndUpdate(appliedCoupon._id, { $inc: { usedCount: 1 } });
    }

    // Wallet deduction for COD / wallet_full orders
    if (walletAdjustment !== 0 && walletDoc) {
      try {
        if (walletAdjustment > 0) {
          await walletDoc.debit(walletAdjustment, 'wallet_applied', {
            orderId:  order.orderId,
            orderRef: order._id,
            reason:   isWalletFull
              ? 'Full order paid via wallet balance'
              : 'Wallet credit applied to reduce COD order total',
          });
        } else {
          await walletDoc.credit(Math.abs(walletAdjustment), 'debt_recovery', {
            orderId:  order.orderId,
            orderRef: order._id,
            reason:   'Wallet debt recovered via order payment',
          });
        }
      } catch (wErr) {
        console.error('[KBD] Wallet deduction failed for order:', wErr.message);
      }
    }

    setImmediate(() => _notifySellerNewOrder(order).catch(() => {}));
  }

  res.status(201).json({ success: true, order: { _id: order._id, orderId: order.orderId, total, paymentMethod, deliveryCharge } });
};

/** POST /api/koyambedu/orders/create-razorpay — initiate Razorpay payment */
const createRazorpayOrder = async (req, res) => {
  const { orderId } = req.body;
  const razorpay = getRazorpay();
  if (!razorpay) return res.status(503).json({ success: false, message: 'Payment gateway not configured' });

  const order = await KoyambeduOrder.findOne({ _id: orderId, buyer: req.user._id });
  if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

  const rzpOrder = await razorpay.orders.create({
    amount:   Math.round(order.pricing.total * 100),
    currency: 'INR',
    receipt:  order.orderId,
    notes:    { kbdOrderId: String(order._id) },
  });

  order.paymentDetails.razorpayOrderId = rzpOrder.id;
  await order.save();

  res.json({ success: true, rzpOrderId: rzpOrder.id, amount: order.pricing.total, currency: 'INR', orderId: order._id, keyId: process.env.RAZORPAY_KEY_ID });
};

/** POST /api/koyambedu/orders/verify-payment */
const verifyPayment = async (req, res) => {
  const { orderId, razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;
  const order = await KoyambeduOrder.findOne({ _id: orderId, buyer: req.user._id });
  if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

  // ── Idempotency guard ───────────────────────────────────────────────────────
  // Razorpay may fire the success callback more than once (user refreshes, webhook
  // retry, etc.). If the order is already marked paid we skip all side-effects and
  // return success so the frontend can safely proceed to the confirmation page.
  // We still make a best-effort cart-clear attempt here (idempotent — clearing an
  // already-empty cart is a no-op): if the FIRST verify-payment call marked the
  // order paid but then failed/timed out before it could clear the cart, this is
  // the only chance a retry gets to actually finish the job — the block below
  // would otherwise never run again for this order.
  if (order.paymentStatus === 'paid') {
    KoyambeduCart.findOneAndUpdate({ user: order.buyer }, { items: [] })
      .catch(e => console.error('[KBD] Retry cart-clear failed for', order.orderId, ':', e.message));
    return res.json({ success: true, message: 'Payment already confirmed', orderId: order.orderId });
  }

  const secret = process.env.RAZORPAY_KEY_SECRET;
  const body   = `${razorpayOrderId}|${razorpayPaymentId}`;
  const expectedSig = crypto.createHmac('sha256', secret).update(body).digest('hex');
  if (expectedSig !== razorpaySignature) {
    return res.status(400).json({ success: false, message: 'Payment verification failed' });
  }

  order.paymentStatus = 'paid';
  order.orderStatus   = 'pending_confirmation';
  order.paymentDetails.razorpayOrderId   = razorpayOrderId;
  order.paymentDetails.razorpayPaymentId = razorpayPaymentId;
  order.paymentDetails.razorpaySignature = razorpaySignature;
  order.paymentDetails.paidAt = new Date();

  // ── Post-payment side effects (done here, not in placeOrder, for Razorpay) ──
  // Generate proforma invoice now that payment is confirmed
  if (!order.invoices?.proforma?.isAvailable) {
    order.invoices = order.invoices || {};
    order.invoices.proforma = {
      number:      `PRO-${Date.now().toString(36).toUpperCase()}`,
      generatedAt: new Date(),
      isAvailable: true,
    };
  }
  // Add order_placed timeline event
  order.timeline.push({
    event:       'order_placed',
    description: 'Order placed — payment confirmed',
    actor:       { role: 'customer', userId: order.buyer, name: '' },
    timestamp:   new Date(),
  });

  await order.save();

  // Clear the customer's cart (preserved during payment_pending state).
  // Wrapped so a transient DB hiccup here can never turn into a 500 that makes
  // the frontend think payment verification itself failed — the payment is
  // already captured and the order is already marked paid by this point; a
  // failed clear just means the (idempotent) retry above gets another shot.
  try {
    await KoyambeduCart.findOneAndUpdate({ user: order.buyer }, { items: [] });
  } catch (e) {
    console.error('[KBD] Cart-clear failed after payment for', order.orderId, ':', e.message);
  }

  // Increment coupon usage now that payment is confirmed
  if (order.pricing?.couponCode) {
    await EptoFreshCoupon.findOneAndUpdate(
      { code: order.pricing.couponCode },
      { $inc: { usedCount: 1 } }
    ).catch(() => {}); // Non-blocking
  }

  // ── Apply wallet adjustment synchronously before responding ─────────────────
  // Deduct BEFORE sending the response so the customer's wallet page shows the
  // updated balance immediately after they land on the confirmation screen.
  // walletAdjustment: positive = credit was applied (debit wallet), negative = debt (credit wallet)
  const walletAdj = order.pricing?.walletAdjustment || 0;
  if (walletAdj !== 0) {
    try {
      let w = await KoyambeduWallet.findOne({ user: order.buyer });
      if (!w) w = new KoyambeduWallet({ user: order.buyer, balance: 0 });
      if (walletAdj > 0) {
        await w.debit(walletAdj, 'wallet_applied', {
          orderId:  order.orderId,
          orderRef: order._id,
          reason:   'Wallet credit applied to reduce order total',
        });
      } else {
        await w.credit(Math.abs(walletAdj), 'debt_recovery', {
          orderId:  order.orderId,
          orderRef: order._id,
          reason:   'Pending wallet adjustment recovered in this order',
        });
      }
    } catch (e) {
      // Non-blocking — payment is already captured; log and continue
      console.error('[KBD] Wallet apply error after verifyPayment:', e.message);
    }
  }

  setImmediate(() => _notifySellerNewOrder(order).catch(() => {}));

  res.json({ success: true, message: 'Payment confirmed!', orderId: order.orderId });
};

// ─────────────────────────────────────────────────────────────────
// DEV-ONLY: Test payment endpoint
// Guarded by Super Admin-controlled paymentTestMode setting in DB.
// Backend validates DB flag before processing — hiding the buttons
// on the frontend is not sufficient security.
// ─────────────────────────────────────────────────────────────────
/** POST /api/koyambedu/orders/test-payment — DEV ONLY */
const testPayment = async (req, res) => {
  const modeStatus = await KoyambeduSettings.checkPaymentTestMode();
  if (!modeStatus.enabled) {
    return res.status(403).json({
      success: false,
      message: 'Payment Testing is currently disabled. A Super Admin must enable it from the admin panel.',
    });
  }
  const { orderId } = req.body;
  const order = await KoyambeduOrder.findOne({ _id: orderId, buyer: req.user._id });
  if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

  // Idempotency guard — same as verifyPayment. Also retries the cart clear
  // (idempotent) in case it failed on a previous call for this order.
  if (order.paymentStatus === 'paid') {
    KoyambeduCart.findOneAndUpdate({ user: order.buyer }, { items: [] })
      .catch(e => console.error('[KBD][TEST] Retry cart-clear failed for', order.orderId, ':', e.message));
    return res.json({ success: true, message: '[TEST] Payment already confirmed', orderId: order.orderId });
  }

  // Mirror verifyPayment logic exactly — no signature check
  order.paymentStatus = 'paid';
  order.orderStatus   = 'pending_confirmation';
  order.paymentDetails.razorpayPaymentId = `test_pay_${Date.now()}`;
  order.paymentDetails.paidAt = new Date();

  // Generate proforma invoice if not already present
  if (!order.invoices?.proforma?.isAvailable) {
    order.invoices = order.invoices || {};
    order.invoices.proforma = {
      number:      `PRO-${Date.now().toString(36).toUpperCase()}`,
      generatedAt: new Date(),
      isAvailable: true,
    };
  }
  order.timeline.push({
    event:       'order_placed',
    description: '[TEST] Order placed — test payment confirmed',
    actor:       { role: 'customer', userId: order.buyer, name: '' },
    timestamp:   new Date(),
  });
  await order.save();

  // Clear cart and increment coupon (same as verifyPayment)
  try {
    await KoyambeduCart.findOneAndUpdate({ user: order.buyer }, { items: [] });
  } catch (e) {
    console.error('[KBD][TEST] Cart-clear failed after payment for', order.orderId, ':', e.message);
  }
  if (order.pricing?.couponCode) {
    await EptoFreshCoupon.findOneAndUpdate(
      { code: order.pricing.couponCode },
      { $inc: { usedCount: 1 } }
    ).catch(() => {});
  }

  // Apply wallet adjustment synchronously (same as verifyPayment)
  const walletAdj = order.pricing?.walletAdjustment || 0;
  if (walletAdj !== 0) {
    try {
      let w = await KoyambeduWallet.findOne({ user: order.buyer });
      if (!w) w = new KoyambeduWallet({ user: order.buyer, balance: 0 });
      if (walletAdj > 0) {
        await w.debit(walletAdj, 'wallet_applied', {
          orderId: order.orderId, orderRef: order._id,
          reason: '[TEST] Wallet credit applied to reduce order total',
        });
      } else {
        await w.credit(Math.abs(walletAdj), 'debt_recovery', {
          orderId: order.orderId, orderRef: order._id,
          reason: '[TEST] Pending wallet adjustment recovered in this order',
        });
      }
    } catch (e) { console.error('[KBD][TEST] Wallet apply error:', e.message); }
  }

  setImmediate(() => _notifySellerNewOrder(order).catch(() => {}));
  res.json({ success: true, message: '[TEST] Payment completed!', orderId: order.orderId });
};

/** GET /api/koyambedu/my-orders */
const getMyOrders = async (req, res) => {
  const orders = await KoyambeduOrder.find({
    buyer: req.user._id,
    paymentStatus: { $ne: 'pending' },  // hide orders where payment was never completed
  })
    .select('-buyer -shippingAddress.phone -deliveryPersonPhone')
    .populate('items.product', 'name images unit')
    .sort({ createdAt: -1 })
    .lean();
  res.json({ success: true, orders });
};

/** DELETE /api/koyambedu/orders/:orderId/pending
 *  Deletes an order only if it belongs to the user AND paymentStatus is still 'pending'.
 *  Called by the frontend when the user closes Razorpay without paying.
 */
const cancelPendingOrder = async (req, res) => {
  const deleted = await KoyambeduOrder.findOneAndDelete({
    _id:           req.params.orderId,
    buyer:         req.user._id,
    paymentStatus: 'pending',
  });
  if (!deleted) return res.status(404).json({ success: false, message: 'No pending order found' });
  res.json({ success: true, message: 'Pending order removed' });
};

/** GET /api/koyambedu/my-orders/:orderId */
const getMyOrder = async (req, res) => {
  const order = await KoyambeduOrder.findOne({ _id: req.params.orderId, buyer: req.user._id })
    .populate('items.product', 'name images unit currentPrice')
    .lean();
  if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
  res.json({ success: true, order });
};

/** POST /api/koyambedu/orders/:orderId/approve-revision — buyer approves price revision */
const approveRevision = async (req, res) => {
  const { approve } = req.body; // true or false
  const order = await KoyambeduOrder.findOne({ _id: req.params.orderId, buyer: req.user._id });
  if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
  if (order.orderStatus !== 'price_revision_pending') {
    return res.status(400).json({ success: false, message: 'No pending price revision for this order' });
  }

  if (approve) {
    order.priceRevision.buyerResponse = 'approved';
    order.priceRevision.respondedAt   = new Date();
    order.pricing.revisedTotal        = order.priceRevision.revisedTotal;
    order.orderStatus                 = 'confirmed';
    // Update finalPrice on each revised item
    for (const rev of order.priceRevision.revisedItems) {
      const item = order.items.find(i => String(i.product) === String(rev.productId));
      if (item) { item.finalPrice = rev.revisedPrice; item.priceRevised = true; }
    }
    await order.save();

    // Notify admin
    console.log(`[KBD] Buyer approved price revision for order ${order.orderId}`);
    res.json({ success: true, message: 'Price revision approved. Your order is now confirmed!', order });
  } else {
    order.priceRevision.buyerResponse = 'rejected';
    order.priceRevision.respondedAt   = new Date();
    order.orderStatus  = 'cancelled';
    order.cancelReason = 'Buyer rejected revised pricing';
    await order.save();

    // Initiate refund if online payment
    if (order.paymentStatus === 'paid' && order.paymentMethod === 'razorpay') {
      setImmediate(() => _refundOrder(order).catch(() => {}));
    }
    res.json({ success: true, message: 'Order cancelled. Refund will be initiated shortly.' });
  }
};

/** POST /api/koyambedu/orders/:orderId/cancel — buyer cancel */
const cancelOrder = async (req, res) => {
  const order = await KoyambeduOrder.findOne({ _id: req.params.orderId, buyer: req.user._id });
  if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
  if (['dispatched','delivered','cancelled'].includes(order.orderStatus)) {
    return res.status(400).json({ success: false, message: 'Order cannot be cancelled at this stage' });
  }
  order.orderStatus  = 'cancelled';
  order.cancelReason = req.body.reason || 'Cancelled by buyer';

  // Refund = subtotal + delivery charge − coupon discount (platform fee is NON-refundable).
  // This single credit covers both the cash paid (Razorpay/COD) and the wallet portion
  // that was applied at checkout — no separate wallet-adj reversal needed.
  const refundAmt = parseFloat((
    (order.pricing?.subtotal      || 0) +
    (order.pricing?.deliveryCharge || 0) -
    (order.pricing?.discount       || 0)
  ).toFixed(2));

  order.refund = order.paymentStatus === 'paid' && refundAmt > 0
    ? { status: 'initiated', amount: refundAmt, reason: order.cancelReason, initiatedAt: new Date() }
    : { status: 'not_applicable', amount: 0, reason: order.cancelReason };

  await order.save();

  if (order.paymentStatus === 'paid' && refundAmt > 0) {
    setImmediate(async () => {
      try {
        let wallet = await KoyambeduWallet.findOne({ user: order.buyer });
        if (!wallet) wallet = await KoyambeduWallet.create({ user: order.buyer });
        await wallet.credit(refundAmt, 'order_cancelled', {
          orderId:  order.orderId,
          orderRef: order._id,
          reason:   `Order ${order.orderId} cancelled — refund (platform fee excluded)`,
        });
        order.refund.status = 'completed';
        order.paymentStatus = 'refunded';
        await order.save();
      } catch(e) { console.error('[KBD] Cancel wallet refund failed:', e.message); }
    });
  }

  res.json({ success: true, message: 'Order cancelled' });
};

// ══════════════════════════════════════════════
// SECTION 4 — SELLER ROUTES
// ══════════════════════════════════════════════

/** POST /api/koyambedu/seller/register */
const sellerRegister = async (req, res) => {
  const existing = await KoyambeduSeller.findOne({ user: req.user._id });
  if (existing) return res.status(400).json({ success: false, message: 'You already have a Koyambedu seller account' });

  const {
    businessName, ownerName, stallNumber, marketSection,
    contactPhone, contactEmail, productTypes, description,
    bankAccountName, bankAccountNumber, bankIfsc, bankName, bankUpi,
  } = req.body;

  if (!businessName || !ownerName || !contactPhone) {
    return res.status(400).json({ success: false, message: 'Business name, owner name and phone are required' });
  }

  const seller = await KoyambeduSeller.create({
    user: req.user._id,
    businessName, ownerName, stallNumber, marketSection, description,
    contact: { phone: contactPhone, email: contactEmail },
    productTypes: productTypes || [],
    bankDetails: {
      accountName: bankAccountName,
      accountNumber: bankAccountNumber,
      ifsc: bankIfsc,
      bankName: bankName,
      upiId: bankUpi,
    },
  });

  res.status(201).json({ success: true, message: 'Registration submitted. Awaiting admin approval.', seller });
};

/** GET /api/koyambedu/seller/profile */
const getSellerProfile = async (req, res) => {
  const seller = await KoyambeduSeller.findOne({ user: req.user._id });
  if (!seller) return res.status(404).json({ success: false, message: 'Seller profile not found' });
  res.json({ success: true, seller });
};

/** PUT /api/koyambedu/seller/profile */
const updateSellerProfile = async (req, res) => {
  const seller = await KoyambeduSeller.findOne({ user: req.user._id });
  if (!seller) return res.status(404).json({ success: false, message: 'Seller profile not found' });
  const { businessName, ownerName, stallNumber, marketSection, description,
    offersSameDay, offersNextDay, sameDayCutoff, notifyWhatsApp } = req.body;
  Object.assign(seller, {
    ...(businessName  && { businessName }),
    ...(ownerName     && { ownerName }),
    ...(stallNumber   !== undefined && { stallNumber }),
    ...(marketSection !== undefined && { marketSection }),
    ...(description   !== undefined && { description }),
    ...(offersSameDay !== undefined && { offersSameDay }),
    ...(offersNextDay !== undefined && { offersNextDay }),
    ...(sameDayCutoff && { sameDayCutoff }),
    ...(notifyWhatsApp!== undefined && { notifyWhatsApp }),
  });
  await seller.save();
  res.json({ success: true, seller });
};

// ── SELLER PRODUCTS ──────────────────────────

/** GET /api/koyambedu/seller/products */
const getSellerProducts = async (req, res) => {
  const seller = await KoyambeduSeller.findOne({ user: req.user._id });
  if (!seller) return res.status(403).json({ success: false, message: 'Seller profile not found' });
  const products = await KoyambeduProduct.find({ seller: seller._id })
    .populate('category', 'name icon').sort({ createdAt: -1 }).lean();
  res.json({ success: true, products });
};

/** POST /api/koyambedu/seller/products */
const createSellerProduct = async (req, res) => {
  const seller = await KoyambeduSeller.findOne({ user: req.user._id, status: 'approved', isActive: true });
  if (!seller) return res.status(403).json({ success: false, message: 'Seller not approved' });

  const {
    categoryId, name, nameTamil, description, unit,
    minQty, maxQty, qtyStep, marketPriceMin, marketPriceMax, currentPrice,
    stockQty, freshArrivalTime, isSameDay, isNextDay, sameDayCutoff,
    badges, tags, isBulkAvailable, bulkMinQty, bulkPricePerUnit, isRecurringAllowed,
  } = req.body;

  if (!categoryId || !name || !currentPrice) {
    return res.status(400).json({ success: false, message: 'Category, name and price are required' });
  }

  const category = await KoyambeduCategory.findOne({ _id: categoryId, status: 'approved', isActive: true });
  if (!category) return res.status(400).json({ success: false, message: 'Invalid or unapproved category' });

  const product = await KoyambeduProduct.create({
    seller: seller._id, category: category._id,
    name, nameTamil, description, unit: unit || 'kg',
    minQty: minQty || 0.5, maxQty: maxQty || 50, qtyStep: qtyStep || 0.5,
    weightKg: req.body.weightKg != null ? Number(req.body.weightKg) : (unit === 'g' ? 0.001 : 1),
    marketPriceMin, marketPriceMax, currentPrice: Number(currentPrice),
    stockQty: stockQty || 0,
    freshArrivalTime: freshArrivalTime || '',
    freshArrivalDate: freshArrivalTime ? new Date() : undefined,
    isSameDay: isSameDay !== false, isNextDay: isNextDay !== false,
    sameDayCutoff: sameDayCutoff || seller.sameDayCutoff,
    badges: badges || [], tags: tags || [],
    isBulkAvailable: isBulkAvailable || false, bulkMinQty, bulkPricePerUnit,
    isRecurringAllowed: isRecurringAllowed || false,
    images: req.body.images || [],
  });

  res.status(201).json({ success: true, product });
};

/** PUT /api/koyambedu/seller/products/:productId */
const updateSellerProduct = async (req, res) => {
  const seller  = await KoyambeduSeller.findOne({ user: req.user._id });
  if (!seller) return res.status(403).json({ success: false, message: 'Not a seller' });
  const product = await KoyambeduProduct.findOne({ _id: req.params.productId, seller: seller._id });
  if (!product) return res.status(404).json({ success: false, message: 'Product not found' });

  const allowed = ['name','nameTamil','description','unit','minQty','maxQty','qtyStep',
    'marketPriceMin','marketPriceMax','currentPrice','stockQty','freshArrivalTime',
    'isSameDay','isNextDay','sameDayCutoff','badges','tags','isActive','isAvailable',
    'isBulkAvailable','bulkMinQty','bulkPricePerUnit','isRecurringAllowed','weightKg','images'];

  for (const k of allowed) {
    if (req.body[k] !== undefined) product[k] = req.body[k];
  }
  if (req.body.freshArrivalTime) product.freshArrivalDate = new Date();
  if (req.body.currentPrice)     product.priceUpdatedAt   = new Date();
  await product.save();

  res.json({ success: true, product });
};

/** PATCH /api/koyambedu/seller/products/:productId/toggle */
const toggleProductAvailability = async (req, res) => {
  const seller  = await KoyambeduSeller.findOne({ user: req.user._id });
  if (!seller) return res.status(403).json({ success: false, message: 'Not a seller' });
  const product = await KoyambeduProduct.findOne({ _id: req.params.productId, seller: seller._id });
  if (!product) return res.status(404).json({ success: false, message: 'Product not found' });
  product.isAvailable = !product.isAvailable;
  await product.save();
  res.json({ success: true, isAvailable: product.isAvailable });
};

/** DELETE /api/koyambedu/seller/products/:productId */
const deleteSellerProduct = async (req, res) => {
  const seller = await KoyambeduSeller.findOne({ user: req.user._id });
  if (!seller) return res.status(403).json({ success: false, message: 'Not a seller' });
  const product = await KoyambeduProduct.findOneAndDelete({ _id: req.params.productId, seller: seller._id });
  if (!product) return res.status(404).json({ success: false, message: 'Product not found' });
  res.json({ success: true, message: 'Product deleted' });
};

// ── SELLER ORDERS (masked — no buyer info) ──────

/** GET /api/koyambedu/seller/orders */
const getSellerOrders = async (req, res) => {
  const seller = await KoyambeduSeller.findOne({ user: req.user._id });
  if (!seller) return res.status(403).json({ success: false, message: 'Not a seller' });

  const orders = await KoyambeduOrder.find({
    'items.seller': seller._id,
    orderStatus: { $nin: ['placed'] }, // only show after payment confirmed
  }).sort({ createdAt: -1 }).lean();

  // Filter items per this seller only + mask buyer details
  const masked = orders.map(o => {
    const sellerItems = o.items.filter(i => String(i.seller) === String(seller._id));
    const payout = sellerItems.reduce((s, i) => s + (i.sellerPayout || 0) * i.quantity, 0);
    return {
      _id:          o._id,
      orderId:      o.orderId,
      orderStatus:  o.orderStatus,
      deliveryType: o.deliveryType,
      deliverySlot: o.deliverySlot,
      deliveryDate: o.deliveryDate,
      items:        sellerItems,
      estimatedPayout: Math.round(payout * 100) / 100,
      priceRevision:  o.priceRevision?.requested ? {
        requested:    true,
        buyerResponse:o.priceRevision.buyerResponse,
      } : { requested: false },
      placedAt:     o.placedAt,
      createdAt:    o.createdAt,
    };
  });

  res.json({ success: true, orders: masked });
};

/** POST /api/koyambedu/seller/orders/:orderId/confirm-stock */
const confirmStock = async (req, res) => {
  const seller = await KoyambeduSeller.findOne({ user: req.user._id });
  if (!seller) return res.status(403).json({ success: false, message: 'Not a seller' });

  const order = await KoyambeduOrder.findOne({
    _id: req.params.orderId,
    'items.seller': seller._id,
    orderStatus: 'pending_confirmation',
  });
  if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

  order.orderStatus = 'confirmed';
  order.confirmedAt = new Date();
  await order.save();

  // Notify buyer: order confirmed
  _notifyBuyer(order, 'confirmed');

  res.json({ success: true, message: 'Stock confirmed. Order is now processing.' });
};

/** POST /api/koyambedu/seller/orders/:orderId/request-price-revision */
const requestPriceRevision = async (req, res) => {
  const seller = await KoyambeduSeller.findOne({ user: req.user._id });
  if (!seller) return res.status(403).json({ success: false, message: 'Not a seller' });

  const { revisedItems } = req.body; // [{ productId, revisedPrice }]
  if (!revisedItems?.length) return res.status(400).json({ success: false, message: 'Revised items required' });

  const order = await KoyambeduOrder.findOne({
    _id: req.params.orderId,
    'items.seller': seller._id,
    orderStatus: { $in: ['pending_confirmation', 'confirmed'] },
  });
  if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

  // Build revision detail
  const revisedItemDetails = [];
  let   newTotal = order.pricing.subtotal;

  for (const rev of revisedItems) {
    const item = order.items.find(i => String(i.product) === String(rev.productId));
    if (!item) continue;
    const diff = (rev.revisedPrice - item.orderedPrice) * item.quantity;
    newTotal += diff;
    revisedItemDetails.push({
      productId:     item.product,
      name:          item.name,
      originalPrice: item.orderedPrice,
      revisedPrice:  Number(rev.revisedPrice),
    });
  }

  order.priceRevision = {
    requested:    true,
    requestedAt:  new Date(),
    requestedBy:  seller._id,
    revisedItems: revisedItemDetails,
    revisedTotal: newTotal + order.pricing.deliveryCharge + (order.pricing.platformFee || order.pricing.serviceFee || 75) + (order.pricing.packingLogisticsFee || 0),
    buyerResponse:'pending',
  };
  order.orderStatus = 'price_revision_pending';
  await order.save();

  // Notify buyer for approval
  _notifyBuyerPriceRevision(order);

  res.json({ success: true, message: 'Price revision request sent to buyer.' });
};

// ── SELLER CATEGORIES ────────────────────────

/** POST /api/koyambedu/seller/categories */
const createSellerCategory = async (req, res) => {
  const seller = await KoyambeduSeller.findOne({ user: req.user._id, status: 'approved' });
  if (!seller) return res.status(403).json({ success: false, message: 'Seller not approved' });
  const { name, nameTamil, icon, parentId, description } = req.body;
  if (!name) return res.status(400).json({ success: false, message: 'Category name required' });
  const cat = await KoyambeduCategory.create({
    name, nameTamil, icon, description,
    parent: parentId || null,
    createdBy: seller._id,
    status: 'pending', // requires admin approval
  });
  res.status(201).json({ success: true, message: 'Category submitted for admin approval', category: cat });
};

// ══════════════════════════════════════════════
// SECTION 5 — ADMIN ROUTES
// ══════════════════════════════════════════════

/** GET /api/koyambedu/admin/dashboard */
const adminDashboard = async (req, res) => {
  const today = new Date(); today.setHours(0,0,0,0);
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);

  const [
    todayOrders, pendingDispatch, delivered, revenue,
    pendingRevisions, sellers, pendingCategories,
  ] = await Promise.all([
    // Only count orders whose payment actually completed — a Razorpay order
    // gets created (and this doc saved) the moment checkout starts, before
    // payment succeeds, so counting all of them here previously included
    // abandoned/failed payment attempts alongside real orders.
    KoyambeduOrder.countDocuments({ createdAt: { $gte: today }, paymentStatus: 'paid' }),
    KoyambeduOrder.countDocuments({ orderStatus: { $in: ['confirmed','packing'] } }),
    KoyambeduOrder.countDocuments({ orderStatus: 'delivered', deliveredAt: { $gte: today } }),
    KoyambeduOrder.aggregate([
      { $match: { paymentStatus: 'paid', createdAt: { $gte: today } } },
      { $group: { _id: null, total: { $sum: '$pricing.total' } } },
    ]),
    KoyambeduOrder.countDocuments({ orderStatus: 'price_revision_pending' }),
    KoyambeduSeller.countDocuments({ isApproved: true, isActive: true }),
    KoyambeduCategory.countDocuments({ status: 'pending' }),
  ]);

  res.json({ success: true, stats: {
    todayOrders, pendingDispatch, delivered,
    todayRevenue: revenue[0]?.total || 0,
    pendingRevisions, activeSellers: sellers, pendingCategories,
  }});
};

/** GET /api/koyambedu/admin/orders */
const adminGetOrders = async (req, res) => {
  const { status, page = 1, limit = 20, deliveryType, search, deliveryDate, deliverySlot, sellerAdmin, itemStatus, customerSearch } = req.query;
  const filter = {};
  if (status) filter.orderStatus = status;
  if (deliveryType) filter.deliveryType = deliveryType;
  if (search) filter.orderId = { $regex: search, $options: 'i' };
  if (deliverySlot) filter.deliverySlot = deliverySlot;
  if (itemStatus === 'declined') filter['items.status'] = 'declined';
  if (deliveryDate) {
    const d = new Date(deliveryDate);
    filter.deliveryDate = { $gte: d, $lt: new Date(d.getTime() + 86400000) };
  }
  if (customerSearch) {
    const regex = { $regex: customerSearch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
    const matchingBuyers = await User.find({ $or: [{ name: regex }, { phone: regex }] }).select('_id').lean();
    filter.buyer = { $in: matchingBuyers.map(u => u._id) };
  }
  if (sellerAdmin) {
    // Get all sellers under this SA
    const sa = await KoyambeduSellerAdmin.findById(sellerAdmin).select('_id');
    if (sa) {
      const sellerIds = (await KoyambeduSeller.find({ createdBySellerAdmin: sa._id }).select('_id').lean()).map(s => s._id);
      filter['items.seller'] = { $in: sellerIds };
    }
  }

  const skip = (Number(page) - 1) * Number(limit);
  const [orders, total] = await Promise.all([
    KoyambeduOrder.find(filter)
      .populate('buyer', 'name email phone')
      .populate('items.seller', 'businessName stallNumber contact')
      .populate('items.product', 'weightKg unit')
      .sort({ createdAt: -1 }).skip(skip).limit(Number(limit)).lean(),
    KoyambeduOrder.countDocuments(filter),
  ]);
  // Decline details become visible to Super Admin only after the Seller
  // Admin SUBMITS the review. Before that, in-progress edits are masked.
  const shaped = orders.map(o => {
    const weightSummary = summarizeOrderWeight(o.items);
    const submitted = !['placed', 'pending_confirmation'].includes(o.orderStatus);
    if (!submitted) {
      return {
        ...o,
        items: (o.items || []).map(it => ({ ...it, itemStatus: 'pending', declinedQty: 0, confirmedQty: it.orderedQty ?? it.quantity, declinedReason: undefined })),
        calculatedPricing: o.calculatedPricing
          ? { ...o.calculatedPricing, declinedRefundAmount: 0, confirmedItemsTotal: o.calculatedPricing.originalOrderValue, finalPayableAmount: o.pricing?.total || 0 }
          : o.calculatedPricing,
        saReview: o.saReview ? { ...o.saReview, pendingRefundAmount: 0 } : o.saReview,
        reviewSummary: null,
        weightSummary,
      };
    }
    const declined = (o.items || []).filter(it => ['declined', 'partial'].includes(it.itemStatus));
    return {
      ...o,
      weightSummary,
      reviewSummary: declined.length ? {
        pendingRefundAmount: o.saReview?.pendingRefundAmount || o.calculatedPricing?.declinedRefundAmount || 0,
        declinedItems: declined.map(it => ({
          name: it.name, unit: it.unit,
          orderedQty: it.orderedQty || it.quantity,
          declinedQty: it.itemStatus === 'declined' ? (it.orderedQty || it.quantity) : it.declinedQty,
          refundAmount: (it.itemStatus === 'declined' ? (it.orderedQty || it.quantity || 0) : (it.declinedQty || 0)) * (it.orderedPrice || it.finalPrice || 0),
          reason: it.declinedReason || 'unavailable',
        })),
      } : null,
    };
  });

  res.json({ success: true, orders: shaped, total, page: Number(page), pages: Math.ceil(total / limit) });
};

/**
 * GET /api/koyambedu/admin/orders/print-list
 * Standalone, print-only order list for the thermal-printer admin tab.
 * Deliberately separate from adminGetOrders (used by the existing Orders
 * tab) — this never touches that function or its response shape, so the
 * existing Orders tab is completely unaffected by this feature.
 *
 * Filters: dateFrom/dateTo (on placedAt — when the order was placed, not
 * delivery date, since packing/printing is usually organised by "orders
 * placed today" rather than delivery slot) and status. Returns only the
 * fields a packing slip needs, already flattened/print-ready.
 */
const getOrdersForPrinting = async (req, res) => {
  try {
    const { dateFrom, dateTo, status, page = 1, limit = 50 } = req.query;
    const filter = {};
    if (status) filter.orderStatus = status;
    if (dateFrom || dateTo) {
      filter.placedAt = {};
      if (dateFrom) filter.placedAt.$gte = new Date(`${dateFrom}T00:00:00`);
      if (dateTo)   filter.placedAt.$lte = new Date(`${dateTo}T23:59:59.999`);
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [orders, total] = await Promise.all([
      KoyambeduOrder.find(filter)
        .populate('buyer', 'name phone')
        .select('orderId placedAt createdAt orderStatus deliveryDate deliverySlot shippingAddress buyerLocation buyer items itemsOrdered packingProgress')
        .sort({ placedAt: -1, createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      KoyambeduOrder.countDocuments(filter),
    ]);

    const slips = orders.map(o => {
      const sourceItems = o.itemsOrdered?.length ? o.itemsOrdered : (o.items || []);
      return {
        _id: o._id,
        orderId: o.orderId,
        placedAt: o.placedAt || o.createdAt,
        orderStatus: o.orderStatus,
        deliveryDate: o.deliveryDate,
        deliverySlot: o.deliverySlot,
        customerName: o.shippingAddress?.fullName || o.buyer?.name || '—',
        customerPhone: o.shippingAddress?.phone || o.buyer?.phone || '',
        // Area/locality only — used on pack labels (a label stuck on a
        // pack that may pass through several hands doesn't need the full
        // street address, just enough to identify roughly where it's going).
        customerArea: o.buyerLocation?.areaName || o.shippingAddress?.landmark || o.shippingAddress?.city || '',
        // Full delivery address — used on the full packing slip, which stays
        // with the order rather than being handled loosely like a pack label.
        customerAddress: [
          o.shippingAddress?.addressLine1,
          o.shippingAddress?.addressLine2,
          o.shippingAddress?.landmark,
          o.shippingAddress?.city,
          o.shippingAddress?.pincode,
        ].filter(Boolean).join(', '),
        printedItemNames: o.packingProgress?.printedItemNames || [],
        items: sourceItems
          .filter(it => it.itemStatus !== 'declined')
          .map(it => ({
            name: it.name,
            unit: it.unit || it.unitLabel || '',
            qty: it.confirmedQty ?? it.orderedQty ?? it.quantity ?? 0,
            gradeName: it.gradeName || null,
          })),
      };
    });

    res.json({ success: true, orders: slips, total, page: Number(page), pages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * POST /api/koyambedu/admin/orders/:orderId/packing/mark-printed
 * Records that the given item names were just printed as a pack label, so
 * they show as already-packed (disabled) next time this order's item list
 * is rendered — the admin doesn't have to remember which items they already
 * selected/printed for a previous pack. Additive-only ($addToSet — de-dupes
 * automatically), never removes anything; only "packing/reset" below clears it.
 */
const markItemsPrinted = async (req, res) => {
  try {
    const { itemNames } = req.body;
    if (!Array.isArray(itemNames) || !itemNames.length) {
      return res.status(400).json({ success: false, message: 'itemNames array is required' });
    }
    const order = await KoyambeduOrder.findByIdAndUpdate(
      req.params.orderId,
      { $addToSet: { 'packingProgress.printedItemNames': { $each: itemNames } } },
      { new: true }
    ).select('packingProgress');
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    res.json({ success: true, printedItemNames: order.packingProgress?.printedItemNames || [] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * POST /api/koyambedu/admin/orders/:orderId/packing/reset
 * Clears the "already printed" list for this order so every item becomes
 * selectable again — requires a reason, kept as an audit trail (e.g. a pack
 * was damaged and needs re-labeling). Does not touch order status, items,
 * or pricing in any way.
 */
const resetPackingProgress = async (req, res) => {
  try {
    const { reason } = req.body;
    if (!reason || !reason.trim()) {
      return res.status(400).json({ success: false, message: 'A reason is required to reset packing progress' });
    }
    const order = await KoyambeduOrder.findByIdAndUpdate(
      req.params.orderId,
      {
        $set: { 'packingProgress.printedItemNames': [] },
        $push: { 'packingProgress.resets': { reason: reason.trim(), resetBy: req.user?._id, resetAt: new Date() } },
      },
      { new: true }
    ).select('packingProgress');
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    res.json({ success: true, printedItemNames: order.packingProgress?.printedItemNames || [] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/** GET /api/koyambedu/admin/orders/:orderId/wallet-history */
const adminGetOrderWalletHistory = async (req, res) => {
  const order = await KoyambeduOrder.findById(req.params.orderId).select('buyer orderId').lean();
  if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

  const wallet = await KoyambeduWallet.findOne({ user: order.buyer }).lean();
  if (!wallet) return res.json({ success: true, transactions: [] });

  const txns = (wallet.transactions || [])
    .filter(t => t.orderRef && t.orderRef.toString() === order._id.toString())
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  res.json({ success: true, transactions: txns });
};

/** PATCH /api/koyambedu/admin/orders/:orderId/status */
const adminUpdateOrderStatus = async (req, res) => {
  const { status, deliveryPartner, deliveryPersonPhone, adminNotes } = req.body;
  const order = await KoyambeduOrder.findById(req.params.orderId)
    .populate('buyer', 'email phone name');
  if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

  const prev = order.orderStatus;
  order.orderStatus = status;
  if (adminNotes)         order.adminNotes         = adminNotes;
  if (deliveryPartner)    order.deliveryPartner     = deliveryPartner;
  if (deliveryPersonPhone)order.deliveryPersonPhone = deliveryPersonPhone;
  if (status === 'dispatched') order.dispatchedAt = new Date();
  if (status === 'delivered')  order.deliveredAt  = new Date();

  // Apply daily price revision before saving (idempotent — skips if prices unchanged)
  await applyPriceRevision(order, { triggeredBy: 'status_update', actorId: req.user._id });

  await order.save();

  // Notify buyer on key status changes
  if (['confirmed','packing','dispatched','delivered'].includes(status)) {
    _notifyBuyer(order, status);
  }

  res.json({ success: true, order });
};

/** PATCH /api/koyambedu/admin/orders/:orderId/items/:itemIndex/qty — edit item quantity */
const adminEditOrderItemQty = async (req, res) => {
  const { newQty } = req.body;
  if (!newQty || newQty < 1) return res.status(400).json({ success: false, message: 'newQty must be >= 1' });
  const order = await KoyambeduOrder.findById(req.params.orderId);
  if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
  const item = order.items[Number(req.params.itemIndex)];
  if (!item) return res.status(404).json({ success: false, message: 'Item not found' });

  const price = item.finalPrice || item.orderedPrice || 0;
  const oldLine = price * item.quantity;
  item.quantity = newQty;
  const newLine = price * newQty;
  // Adjust pricing
  if (order.pricing) {
    order.pricing.subtotal = (order.pricing.subtotal || 0) - oldLine + newLine;
    order.pricing.total    = (order.pricing.total    || 0) - oldLine + newLine;
  }
  await order.save();
  res.json({ success: true, order });
};

/** PATCH /api/koyambedu/admin/orders/:orderId/items/:itemIndex/decline — decline item + credit wallet */
const adminDeclineOrderItem = async (req, res) => {
  const order = await KoyambeduOrder.findById(req.params.orderId)
    .populate('buyer', 'name email phone');
  if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
  const item = order.items[Number(req.params.itemIndex)];
  if (!item) return res.status(404).json({ success: false, message: 'Item not found' });
  if (item.itemStatus === 'declined') return res.status(400).json({ success: false, message: 'Item already declined' });

  // Apply market-price revision before modifying item status so that the
  // declined refund is computed at the current (revised) finalPrice.
  await applyPriceRevision(order, { triggeredBy: 'admin_decline_item', actorId: req.user._id });

  // Use finalPrice (may have been revised above) — ensures declined refund
  // nets out correctly with any prior wallet credits/debits from price revision.
  const price        = item.finalPrice || item.orderedPrice || 0;
  const refundAmount = price * (item.orderedQty || item.quantity || 0);

  item.itemStatus  = 'declined';
  item.declinedQty = item.orderedQty || item.quantity || 0;
  item.confirmedQty = 0;
  item.declinedReason = req.body.reason || 'unavailable';

  // Recalculate via service
  applyCalculation(order);

  // Log timeline + audit
  order.timeline.push({ event: 'item_declined', description: `${item.name} declined by Super Admin`, actor: { role: 'super_admin', userId: req.user._id }, timestamp: new Date(), meta: { itemName: item.name, refundAmount } });
  order.auditLog.push({ action: 'item_declined', actorRole: 'super_admin', actorId: req.user._id, timestamp: new Date(), previousValue: { itemStatus: 'pending' }, newValue: { itemStatus: 'declined' }, amount: refundAmount });

  await order.save();

  // Credit wallet (fire-and-forget)
  setImmediate(async () => {
    try {
      let wallet = await KoyambeduWallet.findOne({ user: order.buyer?._id || order.buyer });
      if (!wallet) wallet = await KoyambeduWallet.create({ user: order.buyer?._id || order.buyer });
      await wallet.credit(refundAmount, 'item_declined', {
        orderId:  order.orderId,
        orderRef: order._id,
        reason:   `${item.name} declined from order ${order.orderId}`,
      });
    } catch(e) { console.error('Wallet credit for declined item failed', e); }
  });

  // WhatsApp notification
  _notifyBuyerItemDeclined(order, item, refundAmount);

  res.json({ success: true, message: `${item.name} declined — ₹${refundAmount} credited to customer wallet`, order });
};

/** GET /api/koyambedu/admin/sellers */
const adminGetSellers = async (req, res) => {
  const { status, page = 1, limit = 20 } = req.query;
  const filter = {};
  if (status) filter.status = status; // pending_review | approved | rejected | suspended
  const skip = (Number(page) - 1) * Number(limit);
  const [sellers, total] = await Promise.all([
    KoyambeduSeller.find(filter)
      .populate('user', 'name email')
      .populate('createdBySellerAdmin', 'name businessName')
      .sort({ createdAt: -1 }).skip(skip).limit(Number(limit)).lean(),
    KoyambeduSeller.countDocuments(filter),
  ]);
  res.json({ success: true, sellers, total });
};

/** PATCH /api/koyambedu/admin/sellers/:sellerId/approve — SuperAdmin only */
const adminApproveSeller = async (req, res) => {
  const { action, reason } = req.body; // action: 'approve' | 'reject' | 'suspend' | 'unsuspend'
  const seller = await KoyambeduSeller.findById(req.params.sellerId).populate('user', 'name email');
  if (!seller) return res.status(404).json({ success: false, message: 'Seller not found' });

  switch (action) {
    case 'approve':
      seller.status      = 'approved';
      seller.isActive    = true;
      seller.approvedBy  = req.user._id;
      seller.approvedAt  = new Date();
      seller.rejectedReason = undefined;
      break;
    case 'reject':
      seller.status         = 'rejected';
      seller.isActive       = false;
      seller.rejectedReason = reason || 'Does not meet requirements';
      break;
    case 'suspend':
      seller.status   = 'suspended';
      seller.isActive = false;
      await KoyambeduProduct.updateMany({ seller: seller._id }, { isActive: false });
      break;
    case 'unsuspend':
      seller.status   = 'approved';
      seller.isActive = true;
      await KoyambeduProduct.updateMany({ seller: seller._id }, { isActive: true });
      break;
    default:
      return res.status(400).json({ success: false, message: 'Invalid action. Use: approve | reject | suspend | unsuspend' });
  }
  await seller.save();
  res.json({ success: true, seller });
};

/** POST /api/koyambedu/admin/sellers — SuperAdmin creates a seller directly (pre-approved) */
const adminCreateSeller = async (req, res) => {
  const {
    businessName, ownerName, stallNumber, marketSection,
    contactPhone, contactEmail, commissionRate, description,
    assignedSellerAdminId,
  } = req.body;

  if (!businessName || !ownerName || !contactPhone) {
    return res.status(400).json({ success: false, message: 'businessName, ownerName and contactPhone are required' });
  }

  const existing = await KoyambeduSeller.findOne({ 'contact.phone': contactPhone });
  if (existing) return res.status(400).json({ success: false, message: 'A seller with this phone number already exists' });

  // Validate assigned seller admin if provided
  let sellerAdmin = null;
  if (assignedSellerAdminId) {
    sellerAdmin = await KoyambeduSellerAdmin.findById(assignedSellerAdminId);
    if (!sellerAdmin) return res.status(400).json({ success: false, message: 'SellerAdmin not found' });
    if (sellerAdmin.status !== 'approved') return res.status(400).json({ success: false, message: 'SellerAdmin must be approved before assigning sellers' });
  }

  const seller = await KoyambeduSeller.create({
    businessName, ownerName, stallNumber, marketSection, description,
    contact: { phone: contactPhone, email: contactEmail || '' },
    commissionRate: commissionRate != null ? Number(commissionRate) : 10,
    status:   'approved',
    isActive: true,
    approvedBy: req.user._id,
    approvedAt: new Date(),
    ...(sellerAdmin && { createdBySellerAdmin: sellerAdmin._id }),
  });

  // Link seller to the SellerAdmin's sellers array if assigned
  if (sellerAdmin) {
    if (!sellerAdmin.sellers) sellerAdmin.sellers = [];
    sellerAdmin.sellers.push(seller._id);
    await sellerAdmin.save();
  }

  res.status(201).json({ success: true, message: 'Seller created and approved.', seller });
};

/** PATCH /api/koyambedu/admin/sellers/:sellerId/contact — SuperAdmin edits seller details */
const adminEditSellerContact = async (req, res) => {
  const seller = await KoyambeduSeller.findById(req.params.sellerId).populate('user', '_id name email phone');
  if (!seller) return res.status(404).json({ success: false, message: 'Seller not found' });

  const {
    ownerName, businessName, stallNumber, marketSection, description,
    contactPhone, contactEmail, syncToAccount,
  } = req.body;

  if (ownerName     !== undefined) seller.ownerName     = ownerName;
  if (businessName  !== undefined) seller.businessName  = businessName;
  if (stallNumber   !== undefined) seller.stallNumber   = stallNumber;
  if (marketSection !== undefined) seller.marketSection = marketSection;
  if (description   !== undefined) seller.description   = description;
  if (contactPhone  !== undefined) seller.contact.phone = contactPhone;
  if (contactEmail  !== undefined) seller.contact.email = contactEmail ? contactEmail.toLowerCase() : '';

  await seller.save();

  // Optionally sync phone/email to the linked Eptomart account
  if (syncToAccount && seller.user) {
    const updates = {};
    if (contactPhone !== undefined) updates.phone = contactPhone;
    if (contactEmail !== undefined) updates.email = contactEmail ? contactEmail.toLowerCase() : '';
    if (Object.keys(updates).length) {
      await User.findByIdAndUpdate(seller.user._id || seller.user, updates);
    }
  }

  const updated = await KoyambeduSeller.findById(seller._id).populate('user', 'name email phone').lean();
  res.json({ success: true, seller: updated });
};

/** PATCH /api/koyambedu/admin/sellers/:sellerId/toggle — admin toggle active */
const adminToggleSeller = async (req, res) => {
  const seller = await KoyambeduSeller.findById(req.params.sellerId);
  if (!seller) return res.status(404).json({ success: false, message: 'Seller not found' });
  seller.isActive = !seller.isActive;
  await seller.save();
  if (!seller.isActive) {
    await KoyambeduProduct.updateMany({ seller: seller._id }, { isActive: false });
  }
  res.json({ success: true, isActive: seller.isActive });
};

// ══════════════════════════════════════════════
// SECTION 5B — SELLER ADMIN ROUTES (SuperAdmin only)
// ══════════════════════════════════════════════

/** GET /api/koyambedu/admin/user-search?q=email_or_phone — find an Eptomart user */
const adminUserSearch = async (req, res) => {
  const { q } = req.query;
  if (!q || q.trim().length < 3) return res.json({ success: true, users: [] });
  const User = require('../models/User');
  const regex = new RegExp(q.trim(), 'i');
  const users = await User.find({
    $or: [{ email: regex }, { phone: regex }, { name: regex }],
    role: 'user',
    isActive: true,
  }).select('_id name email phone').limit(8).lean();
  res.json({ success: true, users });
};

/** POST /api/koyambedu/admin/seller-admins — create a SellerAdmin */
const adminCreateSellerAdmin = async (req, res) => {
  const { userId, name, businessName, contactPhone, contactEmail, notes } = req.body;
  if (!userId || !name) {
    return res.status(400).json({ success: false, message: 'userId and name are required' });
  }
  const existing = await KoyambeduSellerAdmin.findOne({ user: userId });
  if (existing) return res.status(400).json({ success: false, message: 'This user is already a SellerAdmin' });

  const sa = await KoyambeduSellerAdmin.create({
    user: userId, name, businessName, contactPhone, contactEmail, notes,
    createdBy: req.user._id,
    status:    'pending_review',
  });
  res.status(201).json({ success: true, sellerAdmin: sa });
};

/** GET /api/koyambedu/admin/seller-admins */
const adminGetSellerAdmins = async (req, res) => {
  const { status } = req.query;
  const filter = status ? { status } : {};
  const sas = await KoyambeduSellerAdmin.find(filter)
    .populate('user', 'name email')
    .populate('createdBy', 'name')
    .sort({ createdAt: -1 }).lean();
  res.json({ success: true, sellerAdmins: sas });
};

/** PATCH /api/koyambedu/admin/seller-admins/:saId/approve */
const adminApproveSellerAdmin = async (req, res) => {
  const { action, reason } = req.body; // approve | reject | suspend
  const sa = await KoyambeduSellerAdmin.findById(req.params.saId);
  if (!sa) return res.status(404).json({ success: false, message: 'SellerAdmin not found' });

  if (action === 'approve') {
    sa.status     = 'approved';
    sa.approvedBy = req.user._id;
    sa.approvedAt = new Date();
  } else if (action === 'reject') {
    sa.status         = 'rejected';
    sa.rejectedReason = reason || 'Rejected by SuperAdmin';
  } else if (action === 'suspend') {
    sa.status = 'suspended';
  } else {
    return res.status(400).json({ success: false, message: 'Invalid action' });
  }
  await sa.save();
  res.json({ success: true, sellerAdmin: sa });
};

// ── SellerAdmin Portal (protectSellerAdmin middleware required) ──

/** GET /api/koyambedu/seller-admin/profile */
const sellerAdminGetProfile = async (req, res) => {
  const sa = await KoyambeduSellerAdmin.findOne({ user: req.user._id });
  if (!sa) return res.status(404).json({ success: false, message: 'SellerAdmin profile not found' });
  res.json({ success: true, sellerAdmin: sa });
};

/** GET /api/koyambedu/seller-admin/orders — orders whose items belong to this SA's sellers */
const sellerAdminGetOrders = async (req, res) => {
  const sa = await KoyambeduSellerAdmin.findOne({ user: req.user._id, status: 'approved' });
  if (!sa) return res.status(403).json({ success: false, message: 'SellerAdmin not approved' });

  // Get sellers this SA manages
  const sellers = await KoyambeduSeller.find({ createdBySellerAdmin: sa._id }).select('_id').lean();
  const sellerIds = sellers.map(s => s._id);

  // Build filter
  const filter = { 'items.seller': { $in: sellerIds } };
  const { orderDate, deliveryDate, deliverySlot, status, customerSearch } = req.query;
  if (status) filter.orderStatus = { $in: String(status).split(',') };
  if (orderDate) {
    const d = new Date(orderDate);
    filter.createdAt = { $gte: d, $lt: new Date(d.getTime() + 86400000) };
  }
  if (deliveryDate) {
    const d = new Date(deliveryDate);
    filter.deliveryDate = { $gte: d, $lt: new Date(d.getTime() + 86400000) };
  }
  if (deliverySlot) filter.deliverySlot = deliverySlot;
  if (customerSearch) {
    const regex = { $regex: customerSearch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
    const matchingBuyers = await User.find({ $or: [{ name: regex }, { phone: regex }] }).select('_id').lean();
    filter.buyer = { $in: matchingBuyers.map(u => u._id) };
  }

  const orders = await KoyambeduOrder.find(filter)
    .populate('items.product', 'name images unit')
    .populate('buyer', 'name phone email')
    .sort({ createdAt: -1 })
    .limit(200)
    .lean();

  // Filter items to only those belonging to SA's sellers
  const enriched = orders.map(o => ({
    ...o,
    myItems: o.items.filter(it => sellerIds.some(id => String(id) === String(it.seller))),
  }));

  res.json({ success: true, orders: enriched });
};

/** GET /api/koyambedu/seller-admin/sellers — list sellers this SA created */
const sellerAdminGetSellers = async (req, res) => {
  const sa = await KoyambeduSellerAdmin.findOne({ user: req.user._id, status: 'approved' });
  if (!sa) return res.status(403).json({ success: false, message: 'SellerAdmin not approved' });
  const sellers = await KoyambeduSeller.find({ createdBySellerAdmin: sa._id })
    .populate('user', 'name email').sort({ createdAt: -1 }).lean();
  res.json({ success: true, sellers });
};

/** POST /api/koyambedu/seller-admin/sellers — register a new seller under this SA */
const sellerAdminCreateSeller = async (req, res) => {
  const sa = await KoyambeduSellerAdmin.findOne({ user: req.user._id, status: 'approved' });
  if (!sa) return res.status(403).json({ success: false, message: 'SellerAdmin not approved' });

  const {
    businessName, ownerName, stallNumber, marketSection,
    contactPhone, contactEmail, productTypes, description,
    bankAccountName, bankAccountNumber, bankIfsc, bankName, bankUpi,
    // optional Eptomart account creation
    createAccount, accountPhone, accountEmail,
  } = req.body;

  if (!businessName || !ownerName || !contactPhone) {
    return res.status(400).json({ success: false, message: 'businessName, ownerName and contactPhone are required' });
  }

  // Check duplicate by phone to avoid accidental duplicates
  const existing = await KoyambeduSeller.findOne({ 'contact.phone': contactPhone });
  if (existing) return res.status(400).json({ success: false, message: 'A seller with this phone number already exists' });

  // Optionally create / link an Eptomart account so the seller can log in later
  let linkedUserId = null;
  if (createAccount && (accountPhone || accountEmail)) {
    const orQuery = [];
    if (accountPhone) orQuery.push({ phone: accountPhone });
    if (accountEmail) orQuery.push({ email: accountEmail.toLowerCase() });
    let linkedUser = await User.findOne({ $or: orQuery });
    if (!linkedUser) {
      linkedUser = await User.create({
        name:     ownerName,
        phone:    accountPhone  || undefined,
        email:    accountEmail ? accountEmail.toLowerCase() : undefined,
        role:     'user',
        isActive: true,
      });
    }
    linkedUserId = linkedUser._id;
  }

  const seller = await KoyambeduSeller.create({
    ...(linkedUserId && { user: linkedUserId }),
    businessName, ownerName, stallNumber, marketSection, description,
    contact: { phone: contactPhone, email: contactEmail },
    productTypes: productTypes || [],
    bankDetails: {
      accountName: bankAccountName,
      accountNumber: bankAccountNumber,
      ifsc: bankIfsc, bankName, upiId: bankUpi,
    },
    status:               'pending_review',
    createdBySellerAdmin: sa._id,
  });

  res.status(201).json({ success: true, message: 'Seller registered. Awaiting SuperAdmin approval.', seller });
};

// ── Variant price calculator ─────────────────────────────────────────────────
const calcVariantFinalPrice = (basePrice, procPct, platPct, logPct) => {
  const total = (Number(procPct) || 0) + (Number(platPct) || 0) + (Number(logPct) || 0);
  return Math.round(Number(basePrice) * (1 + total / 100)); // always whole number
};

// ── Shared name-uniqueness guard ──────────────────────────────────────────────
// Throws a 400 error if any other product already has the same name (case-insensitive).
// Pass excludeId to allow a product to keep its own name during an update.
const _checkNameUnique = async (name, excludeId = null) => {
  const escaped = name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const query = { name: new RegExp(`^${escaped}$`, 'i') };
  if (excludeId) query._id = { $ne: excludeId };
  const existing = await KoyambeduProduct.findOne(query).select('_id name').lean();
  if (existing) {
    throw Object.assign(
      new Error(`A product named "${name.trim()}" already exists. Please use a different name.`),
      { statusCode: 400 }
    );
  }
};

// ── Shared product-creation helper ──────────────────────────────────────────
const _createProductForSeller = async (seller, body, opts = {}) => {
  const {
    categoryId, name, nameTamil, description, unit,
    stockQty, freshArrivalTime, isSameDay, isNextDay, sameDayCutoff,
    badges, tags, weightKg,
    // Variant pricing
    variants,
    variantDiffPercent,
    procurementChargePercent,
    platformChargePercent,
    logisticsChargePercent,
    // Grade system
    gradesEnabled, grades,
    // Legacy fallback (single-price products)
    currentPrice, minQty, maxQty, qtyStep,
  } = body;

  if (!categoryId || !name) {
    throw Object.assign(new Error('Category and name are required'), { statusCode: 400 });
  }

  const category = await KoyambeduCategory.findOne({ _id: categoryId, isActive: true });
  if (!category) throw Object.assign(new Error('Invalid or inactive category'), { statusCode: 400 });

  // Enforce unique product name across the whole Koyambedu Daily catalog
  await _checkNameUnique(name);

  const procPct = procurementChargePercent != null ? Number(procurementChargePercent) : 0;
  const platPct = platformChargePercent  != null ? Number(platformChargePercent)  : 0;
  const logPct  = logisticsChargePercent != null ? Number(logisticsChargePercent) : 0;

  // ── Grade mode ────────────────────────────────────────────────────────────
  if (gradesEnabled && grades && Array.isArray(grades) && grades.length > 0) {
    const processedGrades = _processGradeVariants(grades, procPct, platPct, logPct);
    const derivedCurrentPrice = getLowestUnitPriceAcrossGrades(processedGrades) || 0;
    return KoyambeduProduct.create({
      seller: seller._id, category: category._id,
      name, nameTamil, description,
      unit: unit || 'kg',
      minQty: minQty || 0.5, maxQty: maxQty || null,
      qtyStep: qtyStep || 0.5,
      weightKg: weightKg != null ? Number(weightKg) : (unit === 'g' ? 0.001 : 1),
      currentPrice: derivedCurrentPrice,
      gradesEnabled: true, grades: processedGrades,
      procurementChargePercent: procPct, platformChargePercent: platPct, logisticsChargePercent: logPct,
      stockQty: stockQty || 0,
      freshArrivalTime: freshArrivalTime || '',
      freshArrivalDate: freshArrivalTime ? new Date() : undefined,
      isSameDay: isSameDay !== false, isNextDay: isNextDay !== false,
      sameDayCutoff: sameDayCutoff || seller.sameDayCutoff || '10:00',
      badges: badges || [], tags: tags || [], images: body.images || [],
      approvalStatus: opts.approvalStatus || 'approved',
    });
  }

  // ── Variant mode ──────────────────────────────────────────────────────────
  let processedVariants = [];
  let derivedCurrentPrice = currentPrice != null ? Number(currentPrice) : null;
  let derivedMinQty = minQty || 0.5;
  let derivedMaxQty = maxQty || 50;

  if (variants && Array.isArray(variants) && variants.length > 0) {
    const total = Math.min(variants.length, 4);
    for (let i = 0; i < total; i++) {
      const v = variants[i];
      const isLast = i === total - 1;
      if (!v.basePrice || !v.fromQty || (!v.toQty && !isLast)) {
        throw Object.assign(new Error(`Variant ${i + 1}: basePrice and fromQty are required${isLast ? '' : ', toQty also required for non-last tiers'}`), { statusCode: 400 });
      }
      const toQty = v.toQty ? Number(v.toQty) : null;
      if (toQty !== null && Number(v.fromQty) >= toQty) {
        throw Object.assign(new Error(`Variant ${i + 1}: fromQty must be less than toQty`), { statusCode: 400 });
      }
      processedVariants.push({
        basePrice:  Number(v.basePrice),
        fromQty:    Number(v.fromQty),
        toQty,
        finalPrice: calcVariantFinalPrice(v.basePrice, procPct, platPct, logPct),
      });
    }
    for (let i = 1; i < processedVariants.length; i++) {
      const prevToQty = processedVariants[i - 1].toQty;
      if (prevToQty !== null && processedVariants[i].fromQty <= prevToQty) {
        throw Object.assign(new Error(`Variant ${i + 1}: qty range overlaps with previous variant`), { statusCode: 400 });
      }
    }
    derivedCurrentPrice = Math.min(...processedVariants.map(v => v.finalPrice));
    derivedMinQty = processedVariants[0].fromQty;
    derivedMaxQty = processedVariants[processedVariants.length - 1].toQty || null;
  } else if (derivedCurrentPrice == null) {
    throw Object.assign(new Error('Either variants, grades, or currentPrice is required'), { statusCode: 400 });
  }

  return KoyambeduProduct.create({
    seller:   seller._id,
    category: category._id,
    name, nameTamil, description,
    unit:      unit      || 'kg',
    minQty:    derivedMinQty,
    maxQty:    derivedMaxQty,
    qtyStep:   qtyStep   || (processedVariants.length > 0 ? processedVariants[0].fromQty : 0.5),
    weightKg:  weightKg  != null ? Number(weightKg) : (unit === 'g' ? 0.001 : 1),
    currentPrice: derivedCurrentPrice,
    variants:     processedVariants,
    variantDiffPercent: variantDiffPercent != null ? Number(variantDiffPercent) : 2,
    procurementChargePercent: procPct,
    platformChargePercent:    platPct,
    logisticsChargePercent:   logPct,
    stockQty:     stockQty || 0,
    freshArrivalTime: freshArrivalTime || '',
    freshArrivalDate: freshArrivalTime ? new Date() : undefined,
    isSameDay:    isSameDay    !== false,
    isNextDay:    isNextDay    !== false,
    sameDayCutoff: sameDayCutoff || seller.sameDayCutoff || '10:00',
    badges: badges || [],
    tags:   tags   || [],
    images: body.images || [],
    approvalStatus: opts.approvalStatus || 'approved',
  });
};

/** POST /api/koyambedu/seller-admin/sellers/:sellerId/products — SA adds product for their seller */
const sellerAdminCreateProduct = async (req, res) => {
  const sa = await KoyambeduSellerAdmin.findOne({ user: req.user._id, status: 'approved' });
  if (!sa) return res.status(403).json({ success: false, message: 'SellerAdmin not approved' });

  const seller = await KoyambeduSeller.findOne({ _id: req.params.sellerId, createdBySellerAdmin: sa._id });
  if (!seller) return res.status(403).json({ success: false, message: 'Seller not managed by this SellerAdmin' });
  if (seller.status !== 'approved') {
    return res.status(400).json({ success: false, message: 'Seller must be approved before adding products' });
  }

  const product = await _createProductForSeller(seller, req.body, { approvalStatus: 'pending' });
  res.status(201).json({ success: true, product, pendingApproval: true });
};

/** POST /api/koyambedu/seller-admin/categories — SA submits a new category for admin approval */
const sellerAdminCreateCategory = async (req, res) => {
  const sa = await KoyambeduSellerAdmin.findOne({ user: req.user._id, status: 'approved' });
  if (!sa) return res.status(403).json({ success: false, message: 'SellerAdmin not approved' });

  const { name, nameTamil, icon, image, parentId, description } = req.body;
  if (!name) return res.status(400).json({ success: false, message: 'Category name is required' });

  // Check for duplicate name (case-insensitive)
  const existing = await KoyambeduCategory.findOne({ name: new RegExp(`^${name.trim()}$`, 'i') });
  if (existing) return res.status(400).json({ success: false, message: 'A category with this name already exists' });

  const cat = await KoyambeduCategory.create({
    name: name.trim(), nameTamil, icon: icon || '🌿', image: image || '',
    description, parent: parentId || null,
    status: 'pending', // must be approved by admin
    // createdBy is KoyambeduSeller ref — leave null for SA-created categories
  });

  res.status(201).json({ success: true, message: 'Category submitted for admin approval', category: cat });
};

/** GET /api/koyambedu/seller-admin/categories — list categories (for product form dropdowns) */
const sellerAdminGetCategories = async (req, res) => {
  const { status } = req.query;
  const filter = { isActive: true };
  if (status) filter.status = status; // e.g. ?status=pending to list SA's pending ones
  const cats = await KoyambeduCategory.find(filter).sort({ name: 1 }).lean();
  res.json({ success: true, categories: cats });
};

/** GET /api/koyambedu/admin/products — list all products (admin/superAdmin) */
const adminGetAllProducts = async (req, res) => {
  const { seller: sellerId, category, search, available } = req.query;
  const filter = {};
  if (sellerId)  filter.seller   = sellerId;
  if (category)  filter.category = category;
  if (available !== undefined) filter.isAvailable = available === 'true';
  if (search)    filter.name     = { $regex: search, $options: 'i' };

  const products = await KoyambeduProduct.find(filter)
    .populate('seller',   'businessName ownerName stallNumber marketSection')
    .populate('category', 'name icon')
    .sort({ createdAt: -1 })
    .lean();
  res.json({ success: true, products });
};

// Helper: process grade variants (used in admin create/update/approve-edit)
const _processGradeVariants = (grades, procPct, platPct, logPct) =>
  (grades || [])
    .filter(g => g.gradeKey !== 'base') // strip any incoming base grade — we auto-inject it below
    .map(g => {
      // Only include variants that have a real basePrice (guard against empty form rows)
      const rawVariants = (g.variants || []).filter(v => v.basePrice && Number(v.basePrice) > 0 && v.fromQty);
      const processed = rawVariants.map(v => ({
        basePrice:  Number(v.basePrice),
        fromQty:    Number(v.fromQty),
        toQty:      (v.toQty !== '' && v.toQty != null) ? Number(v.toQty) : null,
        finalPrice: calcVariantFinalPrice(v.basePrice, procPct, platPct, logPct),
      }));
      const prices = processed.filter(v => v.finalPrice > 0).map(v => v.finalPrice);
      return {
        gradeKey:           g.gradeKey,
        gradeName:          g.gradeName || '',
        isActive:           g.isActive !== false,
        variants:           processed,
        variantDiffPercent: g.variantDiffPercent != null ? Number(g.variantDiffPercent) : 2,
        lowestUnitPrice:    prices.length ? Math.min(...prices) : 0,
      };
    })
    .filter(g => g.variants.length > 0); // drop grades with no valid variants

// Helper: auto-inject a hidden 'base' grade (copy of first active grade's structure).
// The base grade is a backend-only reference used for procurement costing and
// daily-price fallback. It must NEVER appear in any customer or admin UI.
const _injectBaseGrade = (processedGrades) => {
  // Find the first active grade that has real variant data
  const source = processedGrades.find(
    g => g.gradeKey !== 'base' && g.isActive !== false && g.variants && g.variants.some(v => v.basePrice > 0)
  );
  if (!source) return processedGrades; // nothing to copy from — leave as-is
  const baseGrade = {
    gradeKey:           'base',
    gradeName:          'Base Grade',
    isActive:           true,
    variants:           source.variants.map(v => ({ ...v })),
    variantDiffPercent: source.variantDiffPercent,
    lowestUnitPrice:    source.lowestUnitPrice,
  };
  // Replace any existing base grade (handles re-saves / updates)
  return [...processedGrades.filter(g => g.gradeKey !== 'base'), baseGrade];
};

/** PUT /api/koyambedu/admin/products/:productId — admin edits any product */
const adminUpdateProduct = async (req, res) => {
  const product = await KoyambeduProduct.findById(req.params.productId);
  if (!product) return res.status(404).json({ success: false, message: 'Product not found' });

  // Check name uniqueness before applying the update (exclude this product itself)
  if (req.body.name !== undefined && req.body.name.trim().toLowerCase() !== product.name.trim().toLowerCase()) {
    const escaped = req.body.name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const dup = await KoyambeduProduct.findOne({ _id: { $ne: product._id }, name: new RegExp(`^${escaped}$`, 'i') }).select('_id').lean();
    if (dup) return res.status(400).json({ success: false, message: `A product named "${req.body.name.trim()}" already exists. Please use a different name.` });
  }

  const allowed = [
    'name','nameTamil','unit','description','badges',
    'stockQty','isAvailable','isSameDay','isNextDay',
    'sameDayCutoff','weightKg','images',
  ];
  for (const k of allowed) {
    if (req.body[k] !== undefined) product[k] = req.body[k];
  }
  // category field is named 'category' in the model but 'categoryId' from the frontend
  if (req.body.categoryId !== undefined) product.category = req.body.categoryId;

  // ── Charge percents (used by both variant + grade paths) ──────────────
  const _procRaw = req.body.procurementChargePercent ?? product.procurementChargePercent;
  const procPct = _procRaw != null ? Number(_procRaw) : 0;
  const _platRaw = req.body.platformChargePercent  ?? product.platformChargePercent;
  const platPct  = _platRaw != null ? Number(_platRaw) : 0;
  const _logRaw  = req.body.logisticsChargePercent ?? product.logisticsChargePercent;
  const logPct   = _logRaw  != null ? Number(_logRaw)  : 0;

  // ── Grade system ───────────────────────────────────────────────────────
  if (req.body.gradesEnabled !== undefined) product.gradesEnabled = !!req.body.gradesEnabled;

  if (req.body.grades && Array.isArray(req.body.grades)) {
    product.procurementChargePercent = procPct;
    product.platformChargePercent    = platPct;
    product.logisticsChargePercent   = logPct;
    product.grades = _processGradeVariants(req.body.grades, procPct, platPct, logPct);
    product.markModified('grades');
    if (product.gradesEnabled) {
      product.currentPrice = getLowestUnitPriceAcrossGrades(product.grades) || 0;
      product.priceUpdatedAt = new Date();
    }
  }

  // ── Standard variant update (non-graded) ──────────────────────────────
  if (!req.body.gradesEnabled && req.body.variants && Array.isArray(req.body.variants) && req.body.variants.length > 0) {
    const allVars = req.body.variants.slice(0, 4);
    const processed = allVars.map(v => ({
      basePrice:  Number(v.basePrice),
      fromQty:    Number(v.fromQty),
      toQty:      (v.toQty !== '' && v.toQty != null) ? Number(v.toQty) : null,
      finalPrice: calcVariantFinalPrice(v.basePrice, procPct, platPct, logPct),
    }));
    for (let i = 1; i < processed.length; i++) {
      const prevToQty = processed[i - 1].toQty;
      if (prevToQty !== null && processed[i].fromQty <= prevToQty) {
        return res.status(400).json({ success: false, message: `Variant ${i + 1}: qty range overlaps with the previous tier — start must be at least ${prevToQty + 1}` });
      }
    }
    product.variants = processed;
    product.procurementChargePercent = procPct;
    product.platformChargePercent    = platPct;
    product.logisticsChargePercent   = logPct;
    if (req.body.variantDiffPercent !== undefined) {
      product.variantDiffPercent = Number(req.body.variantDiffPercent);
    }
    product.currentPrice = Math.min(...processed.map(v => v.finalPrice));
    product.minQty = processed[0].fromQty;
    product.maxQty = processed[processed.length - 1].toQty || null;
    product.priceUpdatedAt = new Date();
  } else if (!req.body.grades && req.body.currentPrice !== undefined) {
    product.currentPrice = Number(req.body.currentPrice);
    product.priceUpdatedAt = new Date();
  }

  await product.save();
  res.json({ success: true, product });
};

/** PATCH /api/koyambedu/admin/products/:productId/toggle — toggle availability */
const adminToggleProduct = async (req, res) => {
  const product = await KoyambeduProduct.findById(req.params.productId);
  if (!product) return res.status(404).json({ success: false, message: 'Product not found' });
  product.isAvailable = !product.isAvailable;
  await product.save();
  res.json({ success: true, isAvailable: product.isAvailable });
};

/**
 * POST /api/koyambedu/admin/products/bulk-availability
 * Body: { updates: [{ productId, gradeKey? }], available: boolean }
 *
 * - If gradeKey is provided → set grades[gradeKey].isActive only (grade-level).
 * - If no gradeKey → set product.isAvailable (whole-product level).
 * Used by WhatsApp "Not Available Today" detection.
 */
const adminBulkSetAvailability = async (req, res) => {
  try {
    const { updates, available } = req.body;
    if (!Array.isArray(updates) || updates.length === 0) {
      return res.status(400).json({ success: false, message: 'updates array required' });
    }
    if (typeof available !== 'boolean') {
      return res.status(400).json({ success: false, message: 'available (boolean) required' });
    }

    let count = 0;
    for (const u of updates) {
      try {
        if (u.gradeKey) {
          // Grade-level: set isActive on the matching grade subdocument
          const r = await KoyambeduProduct.updateOne(
            { _id: u.productId, 'grades.gradeKey': u.gradeKey },
            { $set: { 'grades.$.isActive': available } }
          );
          if (r.modifiedCount) count++;
        } else {
          // Product-level: set isAvailable on the whole product
          const r = await KoyambeduProduct.updateOne(
            { _id: u.productId },
            { $set: { isAvailable: available } }
          );
          if (r.modifiedCount) count++;
        }
      } catch (_) {}
    }
    res.json({ success: true, updated: count, available });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/** POST /api/koyambedu/admin/sellers/:sellerId/products — admin adds product for any seller */
const adminCreateProduct = async (req, res) => {
  const seller = await KoyambeduSeller.findById(req.params.sellerId);
  if (!seller) return res.status(404).json({ success: false, message: 'Seller not found' });

  const product = await _createProductForSeller(seller, req.body);
  res.status(201).json({ success: true, product });
};

/** PATCH /api/koyambedu/seller-admin/sellers/:sellerId/products/:productId/toggle — toggle availability */
const sellerAdminToggleProduct = async (req, res) => {
  const sa = await KoyambeduSellerAdmin.findOne({ user: req.user._id, status: 'approved' });
  if (!sa) return res.status(403).json({ success: false, message: 'SellerAdmin not approved' });
  const seller = await KoyambeduSeller.findOne({ _id: req.params.sellerId, createdBySellerAdmin: sa._id });
  if (!seller) return res.status(403).json({ success: false, message: 'Seller not managed by this SellerAdmin' });
  const product = await KoyambeduProduct.findOne({ _id: req.params.productId, seller: seller._id });
  if (!product) return res.status(404).json({ success: false, message: 'Product not found' });
  product.isAvailable = !product.isAvailable;
  await product.save();
  res.json({ success: true, isAvailable: product.isAvailable });
};

// ══════════════════════════════════════════════════════════════════
// PRODUCT APPROVAL WORKFLOW — SuperAdmin endpoints
// SA creates/edits products; SuperAdmin approves before they go live
// ══════════════════════════════════════════════════════════════════

/** GET /api/koyambedu/admin/products/pending — list new products + pending edits awaiting approval */
const adminGetPendingProducts = async (req, res) => {
  const [pendingNew, pendingEdits] = await Promise.all([
    KoyambeduProduct.find({ approvalStatus: 'pending' })
      .populate('seller', 'businessName stallNumber')
      .populate('category', 'name icon')
      .populate('pendingEditBy', 'name email')
      .sort({ createdAt: -1 }).lean(),
    KoyambeduProduct.find({ pendingEdit: { $exists: true, $ne: null } })
      .populate('seller', 'businessName stallNumber')
      .populate('category', 'name icon')
      .populate('pendingEditBy', 'name email')
      .sort({ pendingEditAt: -1 }).lean(),
  ]);
  res.json({ success: true, pendingNew, pendingEdits });
};

/** POST /api/koyambedu/admin/products/:productId/approve — approve a new pending product */
const adminApproveProduct = async (req, res) => {
  const product = await KoyambeduProduct.findById(req.params.productId);
  if (!product) return res.status(404).json({ success: false, message: 'Product not found' });
  if (product.approvalStatus !== 'pending') return res.status(400).json({ success: false, message: 'Product is not pending approval' });
  product.approvalStatus = 'approved';
  product.approvedBy     = req.user._id;
  product.approvedAt     = new Date();
  product.approvalNote   = undefined;
  await product.save();
  res.json({ success: true, product });
};

/** POST /api/koyambedu/admin/products/:productId/reject — reject a new pending product */
const adminRejectProduct = async (req, res) => {
  const product = await KoyambeduProduct.findById(req.params.productId);
  if (!product) return res.status(404).json({ success: false, message: 'Product not found' });
  if (product.approvalStatus !== 'pending') return res.status(400).json({ success: false, message: 'Product is not pending approval' });
  product.approvalStatus = 'rejected';
  product.approvalNote   = req.body.note || '';
  await product.save();
  res.json({ success: true, product });
};

/** POST /api/koyambedu/admin/products/:productId/approve-edit — apply pendingEdit to live product */
const adminApproveProductEdit = async (req, res) => {
  const product = await KoyambeduProduct.findById(req.params.productId);
  if (!product) return res.status(404).json({ success: false, message: 'Product not found' });
  if (!product.pendingEdit) return res.status(400).json({ success: false, message: 'No pending edit found' });

  const edit = product.pendingEdit;

  // Check name uniqueness before applying (exclude this product itself)
  if (edit.name !== undefined && edit.name.trim().toLowerCase() !== product.name.trim().toLowerCase()) {
    const escaped = edit.name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const dup = await KoyambeduProduct.findOne({ _id: { $ne: product._id }, name: new RegExp(`^${escaped}$`, 'i') }).select('_id').lean();
    if (dup) return res.status(400).json({ success: false, message: `Cannot approve: a product named "${edit.name.trim()}" already exists. Reject this edit and ask the SA to use a different name.` });
  }

  // Apply plain catalog fields
  const directFields = ['name', 'nameTamil', 'unit', 'description', 'badges', 'weightKg', 'images'];
  for (const k of directFields) {
    if (edit[k] !== undefined) product[k] = edit[k];
  }
  // categoryId from frontend maps to 'category' in the model
  if (edit.categoryId !== undefined) product.category = edit.categoryId;

  // Resolve charge percents (used by both paths)
  const _procRaw2 = edit.procurementChargePercent ?? product.procurementChargePercent;
  const procPct   = _procRaw2 != null ? Number(_procRaw2) : 0;
  const _platRaw2 = edit.platformChargePercent  ?? product.platformChargePercent;
  const platPct   = _platRaw2 != null ? Number(_platRaw2)  : 0;
  const _logRaw2  = edit.logisticsChargePercent ?? product.logisticsChargePercent;
  const logPct    = _logRaw2  != null ? Number(_logRaw2)   : 0;

  // Apply grade system fields
  if (edit.gradesEnabled !== undefined) product.gradesEnabled = !!edit.gradesEnabled;
  if (edit.grades && Array.isArray(edit.grades)) {
    product.grades = _processGradeVariants(edit.grades, procPct, platPct, logPct);
    product.markModified('grades');
    product.procurementChargePercent = procPct;
    product.platformChargePercent    = platPct;
    product.logisticsChargePercent   = logPct;
    if (product.gradesEnabled) {
      product.currentPrice   = getLowestUnitPriceAcrossGrades(product.grades) || 0;
      product.priceUpdatedAt = new Date();
    }
  }

  // Apply variants (with recalculation) — non-graded path
  if (!edit.gradesEnabled && edit.variants && Array.isArray(edit.variants) && edit.variants.length > 0) {
    const processed = edit.variants.slice(0, 4).map(v => ({
      basePrice:  Number(v.basePrice),
      fromQty:    Number(v.fromQty),
      toQty:      (v.toQty !== '' && v.toQty != null) ? Number(v.toQty) : null,
      finalPrice: calcVariantFinalPrice(v.basePrice, procPct, platPct, logPct),
    }));
    product.variants = processed;
    product.procurementChargePercent = procPct;
    product.platformChargePercent    = platPct;
    product.logisticsChargePercent   = logPct;
    if (edit.variantDiffPercent !== undefined) {
      product.variantDiffPercent = Number(edit.variantDiffPercent);
    }
    product.currentPrice = Math.min(...processed.map(v => v.finalPrice));
    product.minQty = processed[0].fromQty;
    product.maxQty = processed[processed.length - 1].toQty || null;
    product.priceUpdatedAt = new Date();
  }

  // Clear the pending edit
  product.pendingEdit   = undefined;
  product.pendingEditBy = undefined;
  product.pendingEditAt = undefined;
  product.markModified('pendingEdit');
  await product.save();
  res.json({ success: true, product });
};

/** POST /api/koyambedu/admin/products/:productId/reject-edit — discard pendingEdit without applying */
const adminRejectProductEdit = async (req, res) => {
  const product = await KoyambeduProduct.findById(req.params.productId);
  if (!product) return res.status(404).json({ success: false, message: 'Product not found' });
  if (!product.pendingEdit) return res.status(400).json({ success: false, message: 'No pending edit found' });
  product.pendingEdit   = undefined;
  product.pendingEditBy = undefined;
  product.pendingEditAt = undefined;
  product.markModified('pendingEdit');
  await product.save();
  res.json({ success: true, message: 'Pending edit discarded' });
};

/** DELETE /api/koyambedu/admin/products/:productId — super admin hard-delete */
const adminDeleteProduct = async (req, res) => {
  const product = await KoyambeduProduct.findByIdAndDelete(req.params.productId);
  if (!product) return res.status(404).json({ success: false, message: 'Product not found' });
  res.json({ success: true, message: 'Product deleted' });
};

/** PUT /api/koyambedu/seller-admin/sellers/:sellerId/products/:productId — update product
 *
 * Operational fields (stockQty, isAvailable, isSameDay, isNextDay, sameDayCutoff)
 * are applied immediately.
 *
 * Catalog fields (name, description, variants, images, etc.) are parked in
 * pendingEdit and require superadmin approval before they go live.
 */
const sellerAdminUpdateProduct = async (req, res) => {
  const sa = await KoyambeduSellerAdmin.findOne({ user: req.user._id, status: 'approved' });
  if (!sa) return res.status(403).json({ success: false, message: 'SellerAdmin not approved' });

  const seller = await KoyambeduSeller.findOne({ _id: req.params.sellerId, createdBySellerAdmin: sa._id });
  if (!seller) return res.status(403).json({ success: false, message: 'Seller not managed by this SellerAdmin' });

  const product = await KoyambeduProduct.findOne({ _id: req.params.productId, seller: seller._id });
  if (!product) return res.status(404).json({ success: false, message: 'Product not found' });

  // ── 1. Apply operational fields immediately (no approval needed) ──────────
  const immediateFields = ['stockQty', 'isAvailable', 'isSameDay', 'isNextDay', 'sameDayCutoff'];
  for (const k of immediateFields) {
    if (req.body[k] !== undefined) product[k] = req.body[k];
  }

  // ── 2. Queue catalog fields for superadmin approval ───────────────────────
  // Name uniqueness: if SA is trying to change the name, check it now so the
  // admin doesn't approve an edit that would later fail.
  if (req.body.name !== undefined && req.body.name.trim().toLowerCase() !== product.name.trim().toLowerCase()) {
    const escaped = req.body.name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const dup = await KoyambeduProduct.findOne({ _id: { $ne: product._id }, name: new RegExp(`^${escaped}$`, 'i') }).select('_id').lean();
    if (dup) return res.status(400).json({ success: false, message: `A product named "${req.body.name.trim()}" already exists. Please use a different name.` });
  }

  const catalogKeys = [
    'name', 'nameTamil', 'unit', 'description', 'badges',
    'categoryId', 'weightKg', 'images',
    'variants', 'variantDiffPercent', 'procurementChargePercent', 'platformChargePercent', 'logisticsChargePercent',
    'gradesEnabled', 'grades',
  ];
  const pendingChanges = {};
  for (const k of catalogKeys) {
    if (req.body[k] !== undefined) pendingChanges[k] = req.body[k];
  }

  let pendingApproval = false;
  if (Object.keys(pendingChanges).length > 0) {
    product.pendingEdit   = pendingChanges;
    product.pendingEditBy = req.user._id;
    product.pendingEditAt = new Date();
    product.markModified('pendingEdit');
    pendingApproval = true;
  }

  await product.save();
  res.json({ success: true, product, pendingApproval });
};

/** GET /api/koyambedu/seller-admin/sellers/:sellerId/products */
const sellerAdminGetProducts = async (req, res) => {
  const sa = await KoyambeduSellerAdmin.findOne({ user: req.user._id, status: 'approved' });
  if (!sa) return res.status(403).json({ success: false, message: 'SellerAdmin not approved' });
  const seller = await KoyambeduSeller.findOne({ _id: req.params.sellerId, createdBySellerAdmin: sa._id });
  if (!seller) return res.status(403).json({ success: false, message: 'Seller not managed by this SellerAdmin' });
  const products = await KoyambeduProduct.find({ seller: seller._id }).populate('category','name icon').lean();
  res.json({ success: true, products });
};

/** PATCH /api/koyambedu/seller-admin/sellers/:sellerId/edit-request
 *  SA submits proposed edits for a seller — stored in pendingEdit, not live yet
 */
const sellerAdminRequestEdit = async (req, res) => {
  const sa = await KoyambeduSellerAdmin.findOne({ user: req.user._id, status: 'approved' });
  if (!sa) return res.status(403).json({ success: false, message: 'SellerAdmin not approved' });

  const seller = await KoyambeduSeller.findOne({ _id: req.params.sellerId, createdBySellerAdmin: sa._id });
  if (!seller) return res.status(403).json({ success: false, message: 'Seller not managed by this SellerAdmin' });

  // Reject if there is already a pending edit awaiting review
  if (seller.pendingEdit && seller.pendingEdit.submittedAt) {
    return res.status(400).json({ success: false, message: 'There is already a pending edit awaiting admin review' });
  }

  const {
    ownerName, businessName, stallNumber, marketSection, description,
    contactPhone, contactEmail, contactAltPhone,
  } = req.body;

  // Build pendingEdit — only include fields that were actually sent
  const pendingEdit = {
    submittedAt: new Date(),
    submittedBy: sa._id,
  };
  if (ownerName     !== undefined) pendingEdit.ownerName     = ownerName;
  if (businessName  !== undefined) pendingEdit.businessName  = businessName;
  if (stallNumber   !== undefined) pendingEdit.stallNumber   = stallNumber;
  if (marketSection !== undefined) pendingEdit.marketSection = marketSection;
  if (description   !== undefined) pendingEdit.description   = description;
  if (contactPhone  !== undefined || contactEmail !== undefined || contactAltPhone !== undefined) {
    pendingEdit.contact = {};
    if (contactPhone    !== undefined) pendingEdit.contact.phone    = contactPhone;
    if (contactEmail    !== undefined) pendingEdit.contact.email    = contactEmail?.toLowerCase() || '';
    if (contactAltPhone !== undefined) pendingEdit.contact.altPhone = contactAltPhone;
  }

  seller.pendingEdit = pendingEdit;
  await seller.save();

  res.json({ success: true, message: 'Edit request submitted for SuperAdmin review', seller });
};

/** POST /api/koyambedu/admin/sellers/:sellerId/review-edit
 *  SuperAdmin approves or rejects a pending edit from a SellerAdmin
 */
const adminReviewSellerEdit = async (req, res) => {
  const { approve, rejectReason } = req.body;
  const seller = await KoyambeduSeller.findById(req.params.sellerId).populate('user', '_id');
  if (!seller) return res.status(404).json({ success: false, message: 'Seller not found' });
  if (!seller.pendingEdit || !seller.pendingEdit.submittedAt) {
    return res.status(400).json({ success: false, message: 'No pending edit found for this seller' });
  }

  if (approve) {
    const pe = seller.pendingEdit;
    // Apply the pending changes to the live fields
    if (pe.ownerName     !== undefined) seller.ownerName     = pe.ownerName;
    if (pe.businessName  !== undefined) seller.businessName  = pe.businessName;
    if (pe.stallNumber   !== undefined) seller.stallNumber   = pe.stallNumber;
    if (pe.marketSection !== undefined) seller.marketSection = pe.marketSection;
    if (pe.description   !== undefined) seller.description   = pe.description;
    if (pe.contact) {
      if (!seller.contact) seller.contact = {};
      if (pe.contact.phone    !== undefined) seller.contact.phone    = pe.contact.phone;
      if (pe.contact.email    !== undefined) seller.contact.email    = pe.contact.email;
      if (pe.contact.altPhone !== undefined) seller.contact.altPhone = pe.contact.altPhone;

      // Sync to linked Eptomart user account so OTP login keeps working
      if (seller.user) {
        const userUpdates = {};
        if (pe.contact.phone !== undefined) userUpdates.phone = pe.contact.phone;
        if (pe.contact.email !== undefined) userUpdates.email = pe.contact.email;
        if (Object.keys(userUpdates).length) {
          await User.findByIdAndUpdate(seller.user._id || seller.user, userUpdates);
        }
      }
    }
  }

  // Clear pending edit regardless of approve/reject
  seller.pendingEdit = undefined;
  await seller.save();

  res.json({
    success: true,
    message: approve ? 'Edit approved and applied' : `Edit rejected: ${rejectReason || 'No reason given'}`,
    seller,
  });
};

/** GET /api/koyambedu/admin/categories */
const adminGetCategories = async (req, res) => {
  const { status } = req.query;
  const filter = status ? { status } : {};
  const cats = await KoyambeduCategory.find(filter)
    .populate('createdBy','businessName').sort({ sortOrder: 1, name: 1 }).lean();
  res.json({ success: true, categories: cats });
};

/** POST /api/koyambedu/admin/categories — admin creates a category directly (auto-approved) */
const adminCreateCategory = async (req, res) => {
  const { name, nameTamil, icon, image, description, sortOrder } = req.body;
  if (!name?.trim()) return res.status(400).json({ success: false, message: 'Category name is required' });
  const existing = await KoyambeduCategory.findOne({ name: new RegExp(`^${name.trim()}$`, 'i') });
  if (existing) return res.status(400).json({ success: false, message: 'A category with this name already exists' });
  const cat = await KoyambeduCategory.create({
    name: name.trim(), nameTamil, icon: icon || '🌿', image: image || '',
    description, status: 'approved', isActive: true,
    approvedBy: req.user._id, approvedAt: new Date(),
    sortOrder: sortOrder || 0,
  });
  res.status(201).json({ success: true, category: cat });
};

/** PUT /api/koyambedu/admin/categories/:catId — admin edits a category */
const adminEditCategory = async (req, res) => {
  const cat = await KoyambeduCategory.findById(req.params.catId);
  if (!cat) return res.status(404).json({ success: false, message: 'Category not found' });
  const { name, nameTamil, icon, image, description, sortOrder, isActive } = req.body;
  if (name !== undefined)        cat.name        = name.trim();
  if (nameTamil !== undefined)   cat.nameTamil   = nameTamil;
  if (icon !== undefined)        cat.icon        = icon;
  if (image !== undefined)       cat.image       = image;
  if (description !== undefined) cat.description = description;
  if (sortOrder !== undefined)   cat.sortOrder   = Number(sortOrder);
  if (isActive !== undefined)    cat.isActive    = isActive;
  cat.slug = cat.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  await cat.save();
  res.json({ success: true, category: cat });
};

/** PATCH /api/koyambedu/admin/categories/:catId/approve */
const adminApproveCategory = async (req, res) => {
  const { approve, reason } = req.body;
  const cat = await KoyambeduCategory.findById(req.params.catId);
  if (!cat) return res.status(404).json({ success: false, message: 'Category not found' });
  cat.status         = approve ? 'approved' : 'rejected';
  cat.approvedBy     = req.user._id;
  cat.approvedAt     = approve ? new Date() : undefined;
  cat.rejectedReason = !approve ? reason : undefined;
  await cat.save();
  res.json({ success: true, category: cat });
};

/** GET /api/koyambedu/admin/analytics */
const adminAnalytics = async (req, res) => {
  const { days = 7 } = req.query;
  const since = new Date(Date.now() - Number(days) * 24 * 3600 * 1000);

  const [revenueByDay, topProducts, ordersByStatus, categoryPerf] = await Promise.all([
    KoyambeduOrder.aggregate([
      { $match: { paymentStatus: 'paid', createdAt: { $gte: since } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, revenue: { $sum: '$pricing.total' }, orders: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    KoyambeduOrder.aggregate([
      { $match: { createdAt: { $gte: since } } },
      { $unwind: '$items' },
      { $group: { _id: '$items.product', name: { $first: '$items.name' }, totalQty: { $sum: '$items.quantity' }, totalRevenue: { $sum: { $multiply: ['$items.finalPrice','$items.quantity'] } } } },
      { $sort: { totalRevenue: -1 } },
      { $limit: 10 },
    ]),
    KoyambeduOrder.aggregate([
      { $match: { createdAt: { $gte: since } } },
      { $group: { _id: '$orderStatus', count: { $sum: 1 } } },
    ]),
    KoyambeduOrder.aggregate([
      { $match: { createdAt: { $gte: since } } },
      { $unwind: '$items' },
      { $lookup: { from: 'koyambedupromducts', localField: 'items.product', foreignField: '_id', as: 'prod' } },
      { $group: { _id: '$prod.category', revenue: { $sum: { $multiply: ['$items.finalPrice','$items.quantity'] } } } },
      { $sort: { revenue: -1 } },
      { $limit: 8 },
    ]),
  ]);

  res.json({ success: true, analytics: { revenueByDay, topProducts, ordersByStatus, categoryPerf } });
};

// ══════════════════════════════════════════════
// SECTION 6 — INTERNAL HELPERS
// ══════════════════════════════════════════════

const _notifySellerNewOrder = async (order) => {
  try {
    const fullOrder = await KoyambeduOrder.findById(order._id)
      .populate('items.seller')
      .populate('buyer', 'name phone');
    const sellerIds = [...new Set(fullOrder.items.map(i => String(i.seller?._id || i.seller)))];

    // Build a single item summary for platform admin
    const allItems   = fullOrder.items.map(i => `${i.name} ×${i.quantity}`).join(', ');
    const areaLabel  = fullOrder.buyerLocation?.areaName || fullOrder.buyerLocation?.city || 'Chennai';
    const delivDate  = fullOrder.deliveryDate
      ? new Date(fullOrder.deliveryDate).toLocaleDateString('en-IN', { day:'numeric', month:'short' })
      : 'TBD';

    // 1. Notify each product seller (existing behaviour)
    for (const sid of sellerIds) {
      const seller = await KoyambeduSeller.findById(sid);
      if (!seller || !seller.contact?.phone || !seller.notifyWhatsApp) continue;

      const sellerItems = fullOrder.items.filter(i => String(i.seller?._id || i.seller) === sid);
      const total       = sellerItems.reduce((s, i) => s + (i.finalPrice || i.orderedPrice || 0) * i.quantity, 0);
      const itemSummary = sellerItems.map(i => `${i.name} ×${i.quantity}${i.unit ? ` ${i.unit}` : ''}`).join(', ');

      waSend(seller.contact.phone, [
        seller.businessName,
        fullOrder.orderId,
        'New Koyambedu Order 📦',
        `${itemSummary}. Area: ${areaLabel}. Delivery: ${delivDate}. Est. payout: ₹${Math.round(total * 0.92).toLocaleString('en-IN')}. Confirm at eptomart.com/koyambedu/seller`,
      ]);

      // 2. Notify seller admin for this seller (if any)
      const sellerAdmin = await KoyambeduSellerAdmin.findOne({ sellers: seller._id, status: 'approved' });
      if (sellerAdmin?.contact?.phone) {
        waSend(sellerAdmin.contact.phone, [
          sellerAdmin.name || 'Admin',
          fullOrder.orderId,
          'New Koyambedu Order 📦',
          `${itemSummary}. Area: ${areaLabel}. Delivery: ${delivDate}. Payout: ₹${Math.round(total * 0.92).toLocaleString('en-IN')}. Manage at eptomart.com/koyambedu/seller-admin`,
        ]);
      }
    }

    // 3. Notify platform admin
    const adminPhone = process.env.PLATFORM_ADMIN_WHATSAPP || process.env.ADMIN_WHATSAPP_PHONE;
    if (adminPhone) {
      waSend(adminPhone, [
        'Koyambedu Admin',
        fullOrder.orderId,
        'New Koyambedu Order Received 📦',
        `Order #${fullOrder.orderId}: ${allItems}. Delivery area: ${areaLabel}. Date: ${delivDate}. Total: ₹${fullOrder.pricing?.total?.toLocaleString('en-IN') || '-'}. Manage at eptomart.com/admin`,
      ]);
    }

    // 4. Notify buyer — order confirmation
    const buyerPhone = fullOrder.buyer?.phone || fullOrder.shippingAddress?.phone;
    const buyerName  = fullOrder.buyer?.name  || fullOrder.shippingAddress?.fullName || 'Customer';
    if (buyerPhone) {
      const total = fullOrder.pricing?.total?.toLocaleString('en-IN') || '-';
      waSend(buyerPhone, [
        buyerName,
        fullOrder.orderId,
        'Order Placed Successfully ✅',
        `Thank you for your order! Order #${fullOrder.orderId}: ${allItems}. Delivery on ${delivDate}. Total: ₹${total}. Track your order at eptomart.com/koyambedu/orders`,
      ]);
    }
  } catch (err) {
    console.error('[KBD] Seller notify error:', err.message);
  }
};

const _notifyBuyer = async (order, event) => {
  try {
    const buyer = await User.findById(order.buyer).select('phone email name').lean();
    if (!buyer?.phone) return;
    const messages = {
      confirmed:  ['Your Order is Confirmed ✅', `Order #${order.orderId} confirmed by seller. Fresh produce is being arranged for you!`],
      packing:    ['Order Being Packed 📦', `Order #${order.orderId} is being packed and will be dispatched soon.`],
      dispatched: ['Your Order is On the Way 🚚', `Order #${order.orderId} is dispatched. Expected delivery: ${order.deliverySlot}.`],
      delivered:  ['Order Delivered! 🎉', `Order #${order.orderId} delivered. Thank you for choosing Koyambedu Daily!`],
    };
    const [status, detail] = messages[event] || [event, ''];
    waSend(buyer.phone, [buyer.name || 'Customer', order.orderId, status, detail]);
  } catch (err) {
    console.error('[KBD] Buyer notify error:', err.message);
  }
};

const _notifyBuyerPriceRevision = async (order) => {
  try {
    const buyer = await User.findById(order.buyer).select('phone name').lean();
    if (!buyer?.phone) return;
    const revisedTotal = order.priceRevision?.revisedTotal || 0;
    waSend(buyer.phone, [
      buyer.name || 'Customer',
      order.orderId,
      'Price Revision Requested ⚠️',
      `Market price for some items in order #${order.orderId} has changed. New total: ₹${revisedTotal.toLocaleString('en-IN')}. Login to approve or cancel: eptomart.com/koyambedu/orders`,
    ]);
  } catch (err) {
    console.error('[KBD] Price revision notify error:', err.message);
  }
};

const _refundOrder = async (order) => {
  try {
    const rzpKeyId     = process.env.RAZORPAY_KEY_ID;
    const rzpKeySecret = process.env.RAZORPAY_KEY_SECRET;
    const paymentId    = order.paymentDetails?.razorpayPaymentId;
    if (!rzpKeyId || !paymentId) return;
    const https  = require('https');
    const amount = Math.round(order.pricing.total * 100);
    const body   = JSON.stringify({ amount, speed: 'normal' });
    const auth   = Buffer.from(`${rzpKeyId}:${rzpKeySecret}`).toString('base64');
    await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'api.razorpay.com',
        path:     `/v1/payments/${paymentId}/refund`,
        method:   'POST',
        headers:  { 'Content-Type': 'application/json', 'Authorization': `Basic ${auth}`, 'Content-Length': Buffer.byteLength(body) },
      }, (res) => {
        let d = ''; res.on('data', c => d += c);
        res.on('end', () => resolve(JSON.parse(d || '{}')));
      });
      req.on('error', reject);
      req.write(body); req.end();
    });
    order.paymentStatus    = 'refunded';
    order.refund           = { status: 'initiated', amount: order.pricing.total, initiatedAt: new Date() };
    await order.save();
    console.log(`[KBD] Refund initiated for order ${order.orderId}`);
  } catch (err) {
    console.error('[KBD] Refund error:', err.message);
  }
};

// ══════════════════════════════════════════════
// AI — Translate & Describe
// ══════════════════════════════════════════════
const { callClaude } = require('../utils/claudeAI');

/** POST /api/koyambedu/ai/translate  { text } → { tamil } */
const aiTranslate = async (req, res) => {
  const { text } = req.body;
  if (!text?.trim()) return res.status(400).json({ success: false, message: 'text is required' });

  const tamil = await callClaude(
    `Translate the following produce/vegetable/fruit name from English to Tamil. Return ONLY the Tamil text, nothing else.\n\n"${text.trim()}"`,
    'You are a Tamil language expert specialising in Koyambedu market produce names. Return only the Tamil translation, no explanation.'
  );
  res.json({ success: true, tamil });
};

/** POST /api/koyambedu/ai/describe  { name, nameTamil, category, unit } → { description } */
const aiDescribe = async (req, res) => {
  const { name, nameTamil, category, unit } = req.body;
  if (!name?.trim()) return res.status(400).json({ success: false, message: 'name is required' });

  const prompt = [
    `Write a short, appealing product description (2–3 sentences) for a fresh produce listing on an ecommerce app.`,
    `Product: ${name.trim()}`,
    nameTamil ? `Tamil name: ${nameTamil}` : '',
    category  ? `Category: ${category}`    : '',
    unit      ? `Sold by: ${unit}`         : '',
    `Focus on freshness, taste, and health benefits. Keep it simple and friendly for Indian shoppers. No emojis.`,
  ].filter(Boolean).join('\n');

  const description = await callClaude(
    prompt,
    'You are a helpful assistant writing concise, friendly product descriptions for a Koyambedu daily-fresh produce marketplace in India.'
  );
  res.json({ success: true, description });
};

/** POST /api/koyambedu/upload-image  multipart: image field "image" */
const uploadImage = async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: 'No image uploaded' });
  res.json({
    success:   true,
    url:       req.file.path,
    publicId:  req.file.filename,
  });
};

// ══════════════════════════════════════════════
// SUPERADMIN — Wipe all Koyambedu data
// Deletes: products, sellers, seller-admins, orders, carts, categories
// Does NOT touch main User accounts
// ══════════════════════════════════════════════
const adminWipeAll = async (req, res) => {
  try {
    const [products, sellers, sellerAdmins, orders, carts, categories] = await Promise.all([
      KoyambeduProduct.deleteMany({}),
      KoyambeduSeller.deleteMany({}),
      KoyambeduSellerAdmin.deleteMany({}),
      KoyambeduOrder.deleteMany({}),
      KoyambeduCart.deleteMany({}),
      KoyambeduCategory.deleteMany({}),
    ]);
    res.json({
      success: true,
      message: 'All Koyambedu data wiped',
      deleted: {
        products:     products.deletedCount,
        sellers:      sellers.deletedCount,
        sellerAdmins: sellerAdmins.deletedCount,
        orders:       orders.deletedCount,
        carts:        carts.deletedCount,
        categories:   categories.deletedCount,
      },
    });
  } catch (err) {
    console.error('Koyambedu wipe error:', err);
    res.status(500).json({ message: 'Wipe failed', error: err.message });
  }
};

// ══════════════════════════════════════════════
// HELPERS — price formula
// ══════════════════════════════════════════════
const calcFinalPrice = ({ basePrice, platformFeePercent = 10, logisticsPercent = 10, sellerMarginPercent = 15 }) => {
  const pf = (basePrice * platformFeePercent) / 100;
  const lf = (basePrice * logisticsPercent)   / 100;
  const sm = (basePrice * sellerMarginPercent) / 100;
  return Math.round((basePrice + pf + lf + sm) * 100) / 100;
};

// Order statuses that count as "confirmed" for SuperAdmin-facing reports
// (Order Report, Product Consolidation, Cash Flow, Area Wise, Procurement).
// An order is confirmed once SuperAdmin has approved it and it starts moving
// through fulfilment — pre-confirmation states (still awaiting SA/SuperAdmin
// review) and cancelled/refunded orders are excluded so procurement and
// financial numbers aren't inflated by orders that may still change or never
// go out. Scoped to these report endpoints only — does NOT affect the
// Seller-Admin's own procurement/slot-wise reports or the live dashboard,
// which intentionally show a broader set of orders for operational visibility.
const CONFIRMED_REPORT_STATUSES = ['confirmed', 'packing', 'dispatched', 'delivered', 'reported', 'closed'];

// ── Per-order gross weight / unit-count summary ─────────────────────
// Used to show admins, at a glance, how much to physically carry for an
// order: total gross weight in kg (quantity × product.weightKg, which is
// "kg per 1 unit" regardless of what that unit is), PLUS a separate count
// per non-weight unit (boxes, bunches, pieces, etc.) since a box count
// matters for packing even though its weight is already folded into the
// gross-weight total. Purely a read-side computation — requires
// items.product to be populated with `weightKg` and does not change any
// order/pricing data.
const summarizeOrderWeight = (items) => {
  let grossWeightKg = 0;
  const unitCounts = {}; // e.g. { box: 3, bunch: 2, piece: 12 }
  for (const it of items || []) {
    if (it.itemStatus === 'declined') continue;
    const qty = it.quantity || it.confirmedQty || it.orderedQty || 0;
    if (!qty) continue;
    const weightPerUnit = it.product?.weightKg ?? 1;
    grossWeightKg += qty * weightPerUnit;
    const unit = it.unit || it.product?.unit || 'unit';
    if (unit !== 'kg' && unit !== 'g') {
      unitCounts[unit] = (unitCounts[unit] || 0) + qty;
    }
  }
  return {
    grossWeightKg: Math.round(grossWeightKg * 100) / 100,
    unitCounts,
  };
};

// procurement cycle date: orders before midnight belong to "today", after midnight → "tomorrow"
const getProcurementCycle = (ts = new Date()) => {
  // Use IST (UTC+5:30)
  const ist = new Date(ts.getTime() + (5.5 * 60 * 60 * 1000));
  const h = ist.getUTCHours(), m = ist.getUTCMinutes();
  // After 23:59 → next day cycle
  const base = new Date(ist);
  if (h === 23 && m >= 59) base.setUTCDate(base.getUTCDate() + 1);
  return base.toISOString().slice(0, 10); // "2026-06-22"
};

// Delivery slot definitions
const DELIVERY_SLOTS = {
  slot1: 'Slot 1: 9 AM – 12 PM',
  slot2: 'Slot 2: 12 PM – 3 PM',
  slot3: 'Slot 3: 3 PM – 6 PM',
};

// ══════════════════════════════════════════════
// FEATURE 1 — Dynamic Pricing (product code auto-gen)
// ══════════════════════════════════════════════
const generateProductCode = (name) => {
  const prefix = name.trim().replace(/\s+/g, '').substring(0, 3).toUpperCase();
  const suffix = Date.now().toString(36).slice(-4).toUpperCase();
  return `${prefix}${suffix}`;
};

// ══════════════════════════════════════════════
// FEATURE 4 — Daily Price Update Panel (v2 — variant-aware)
//
// Business rule: user enters ONE base price (for the HIGHEST qty variant).
// System auto-calculates all smaller variant prices via variantPricingService.
//
// Routes (shared handler, role detected from req.user.role):
//   GET  /seller-admin/daily-price          — SA: own sellers only
//   GET  /admin/daily-price                 — Admin: by sellerAdmin + category params
//   PATCH /seller-admin/daily-price/:id     — update one product
//   PATCH /admin/daily-price/:id            — admin update one product
//   POST  /seller-admin/daily-price/bulk    — bulk update
//   POST  /admin/daily-price/bulk           — admin bulk update
// ══════════════════════════════════════════════
const KoyambeduPriceHistory = require('../models/KoyambeduPriceHistory');
const { calculateVariantPricing, getHighestVariant, getLowestUnitPrice, computeGradeVariants, getLowestUnitPriceAcrossGrades } = require('../utils/variantPricingService');

// ── Helper: resolve seller IDs for a price panel request ──────────────
// • SA role  → only their own sellers (req.user links to a SellerAdmin doc)
// • Admin role → filtered by optional sellerAdmin query param
const _resolveSellerIds = async (req) => {
  const isAdmin = req.user.role === 'superAdmin' || req.user.role === 'admin';
  if (isAdmin) {
    const { sellerAdmin } = req.query;
    if (sellerAdmin) {
      const sellers = await KoyambeduSeller
        .find({ createdBySellerAdmin: sellerAdmin, status: 'approved' })
        .select('_id').lean();
      return sellers.map(s => s._id);
    }
    // Admin with no SA filter → all sellers
    const sellers = await KoyambeduSeller.find({}).select('_id').lean();
    return sellers.map(s => s._id);
  }
  // Seller Admin — scope to their own sellers
  const saDoc = await KoyambeduSellerAdmin.findOne({ user: req.user._id }).select('_id').lean();
  if (!saDoc) return [];
  const sellers = await KoyambeduSeller
    .find({ createdBySellerAdmin: saDoc._id, status: 'approved' })
    .select('_id').lean();
  return sellers.map(s => s._id);
};

const getDailyPricePanel = async (req, res) => {
  try {
    const { category } = req.query;
    const sellerIds = await _resolveSellerIds(req);
    if (!sellerIds.length) return res.json({ success: true, products: [] });

    const filter = { seller: { $in: sellerIds }, isActive: true };
    if (category) filter.category = category;

    const products = await KoyambeduProduct.find(filter)
      .populate('seller', 'name businessName')
      .populate('category', 'name')
      .select([
        'name', 'nameTamil', 'productCode', 'unit',
        'variants', 'variantDiffPercent',
        'gradesEnabled', 'grades',
        'procurementChargePercent', 'platformChargePercent', 'logisticsChargePercent',
        'currentPrice', 'finalPrice', 'basePrice',
        'priceUpdatedAt', 'seller', 'category',
      ].join(' '))
      .lean();

    // Annotate each product with derived display fields
    const annotated = products.map(p => {
      if (p.gradesEnabled && p.grades?.length > 0) {
        // Grade-enabled: return one annotation per active grade (skip hidden 'base' grade)
        const gradeRows = p.grades.filter(g => g.isActive && g.gradeKey !== 'base').map(g => ({
          gradeKey:          g.gradeKey,
          gradeName:         g.gradeName || g.gradeKey,
          highestVariant:    getHighestVariant(g.variants || []),
          lowestUnitPrice:   getLowestUnitPrice(g.variants || []),
          variantDiffPercent: g.variantDiffPercent || 2,
          variants:          g.variants || [],
        }));
        return {
          ...p,
          gradeRows,
          highestVariant:    null, // not used for graded products
          lowestUnitPrice:   getLowestUnitPriceAcrossGrades(p.grades),
          variantDiffPercent: p.variantDiffPercent || 2,
        };
      }
      const highestVariant  = getHighestVariant(p.variants || []);
      const lowestUnitPrice = getLowestUnitPrice(p.variants || []);
      return {
        ...p,
        highestVariant,
        lowestUnitPrice,
        variantDiffPercent: p.variantDiffPercent || 2,
      };
    });

    res.json({ success: true, products: annotated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const updateDailyPrice = async (req, res) => {
  try {
    const { productId } = req.params;
    const { highestBasePrice, variantDiffPercent, note, gradeKey } = req.body;

    // Validation
    if (highestBasePrice === undefined || Number(highestBasePrice) <= 0) {
      return res.status(400).json({ success: false, message: 'highestBasePrice must be a positive number' });
    }
    if (variantDiffPercent !== undefined && (Number(variantDiffPercent) < 0 || Number(variantDiffPercent) > 50)) {
      return res.status(400).json({ success: false, message: 'variantDiffPercent must be between 0 and 50' });
    }

    const product = await KoyambeduProduct.findById(productId);
    if (!product) return res.status(404).json({ success: false, message: 'Product not found' });

    // SA ownership check
    const isAdmin = req.user.role === 'superAdmin' || req.user.role === 'admin';
    if (!isAdmin) {
      const saDoc = await KoyambeduSellerAdmin.findOne({ user: req.user._id }).select('_id').lean();
      const seller = await KoyambeduSeller.findById(product.seller).select('createdBySellerAdmin').lean();
      if (!saDoc || !seller || String(seller.createdBySellerAdmin) !== String(saDoc._id)) {
        return res.status(403).json({ success: false, message: 'You can only update your own products' });
      }
    }

    let updatedVariants, highestUpdated, prevPrice;

    if (product.gradesEnabled && gradeKey) {
      // ── Grade-aware update ──────────────────────────────────
      const gradeIdx = product.grades.findIndex(g => g.gradeKey === gradeKey);
      if (gradeIdx === -1) return res.status(404).json({ success: false, message: 'Grade not found' });
      const grade = product.grades[gradeIdx];

      const prevHighest = getHighestVariant(grade.variants || []);
      prevPrice = prevHighest?.finalPrice || 0;

      if (variantDiffPercent !== undefined) grade.variantDiffPercent = Number(variantDiffPercent);

      updatedVariants = computeGradeVariants(product, grade, {
        highestBasePrice:   Number(highestBasePrice),
        variantDiffPercent: grade.variantDiffPercent,
      });

      // Apply back to grade variants
      for (const upd of updatedVariants) {
        const v = grade.variants.find(x => String(x.fromQty) === String(upd.fromQty));
        if (v) { v.basePrice = upd.basePrice; v.finalPrice = upd.finalPrice; }
      }
      // Store lowest unit price snapshot on grade
      highestUpdated = getHighestVariant(updatedVariants);
      grade.lowestUnitPrice = getLowestUnitPrice(updatedVariants);

      // Update top-level currentPrice = cheapest rate across all active grades
      product.currentPrice   = getLowestUnitPriceAcrossGrades(product.grades) || 0;
      product.priceUpdatedAt = new Date();
    } else {
      // ── Standard (non-graded) update ────────────────────────
      const prevHighestVariant = getHighestVariant(product.variants || []);
      prevPrice = prevHighestVariant?.finalPrice || product.currentPrice;

      if (variantDiffPercent !== undefined) product.variantDiffPercent = Number(variantDiffPercent);

      updatedVariants = calculateVariantPricing(product, {
        highestBasePrice:   Number(highestBasePrice),
        variantDiffPercent: product.variantDiffPercent,
      });

      for (const upd of updatedVariants) {
        const v = product.variants.id ? product.variants.id(upd._id) : null;
        const vByIdx = product.variants.find(x => String(x.fromQty) === String(upd.fromQty));
        const target = v || vByIdx;
        if (target) { target.basePrice = upd.basePrice; target.finalPrice = upd.finalPrice; }
      }

      highestUpdated = getHighestVariant(updatedVariants);
      product.basePrice      = Number(highestBasePrice);
      product.finalPrice     = highestUpdated?.finalPrice || 0;
      product.currentPrice   = getLowestUnitPrice(updatedVariants) || highestUpdated?.finalPrice || 0;
      product.priceUpdatedAt = new Date();
    }

    await product.save();

    // Record history + touch global lastProductUpdateTime
    setImmediate(async () => {
      try {
        await KoyambeduPriceHistory.create({
          product:         product._id,
          seller:          product.seller,
          productName:     product.name,
          productCode:     product.productCode,
          previousPrice:   prevPrice,
          updatedPrice:    highestUpdated?.finalPrice || 0,
          basePrice:       Number(highestBasePrice),
          variantDiffPct:  gradeKey
            ? (product.grades.find(g => g.gradeKey === gradeKey)?.variantDiffPercent || 2)
            : product.variantDiffPercent,
          updatedBy:       req.user._id,
          updatedByName:   req.user.name || req.user.email,
          updatedByRole:   isAdmin ? 'superAdmin' : 'sellerAdmin',
          source:          'manual',
          note,
          ...(gradeKey ? { gradeKey } : {}),
        });
        await KoyambeduSettings.touchPriceUpdate(req.user._id, req.user.name || req.user.email);
      } catch (_) {}
    });

    res.json({
      success: true,
      updatedVariants,
      highestVariant:  highestUpdated,
      lowestUnitPrice: getLowestUnitPrice(updatedVariants),
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const bulkUpdateDailyPrice = async (req, res) => {
  try {
    // updates: [{ productId, highestBasePrice, variantDiffPercent }]
    const { updates } = req.body;
    if (!Array.isArray(updates) || !updates.length) {
      return res.status(400).json({ success: false, message: 'updates array is required' });
    }

    const isAdmin = req.user.role === 'superAdmin' || req.user.role === 'admin';
    let saDoc = null;
    if (!isAdmin) {
      saDoc = await KoyambeduSellerAdmin.findOne({ user: req.user._id }).select('_id').lean();
    }

    const results = [];
    for (const u of updates) {
      try {
        if (!u.productId || !u.highestBasePrice || Number(u.highestBasePrice) <= 0) {
          results.push({ productId: u.productId, error: 'highestBasePrice is required and must be positive' });
          continue;
        }

        const product = await KoyambeduProduct.findById(u.productId);
        if (!product) { results.push({ productId: u.productId, error: 'not found' }); continue; }

        // SA ownership check
        if (!isAdmin && saDoc) {
          const seller = await KoyambeduSeller.findById(product.seller).select('createdBySellerAdmin').lean();
          if (!seller || String(seller.createdBySellerAdmin) !== String(saDoc._id)) {
            results.push({ productId: u.productId, error: 'access denied' });
            continue;
          }
        }

        let updatedVariants, highestUpdated, prevPrice;

        if (product.gradesEnabled && u.gradeKey) {
          const gradeIdx = product.grades.findIndex(g => g.gradeKey === u.gradeKey);
          if (gradeIdx === -1) { results.push({ productId: u.productId, error: 'grade not found' }); continue; }
          const grade = product.grades[gradeIdx];
          const prevHighest = getHighestVariant(grade.variants || []);
          prevPrice = prevHighest?.finalPrice || 0;
          if (u.variantDiffPercent !== undefined) grade.variantDiffPercent = Number(u.variantDiffPercent);
          updatedVariants = computeGradeVariants(product, grade, {
            highestBasePrice:   Number(u.highestBasePrice),
            variantDiffPercent: grade.variantDiffPercent,
          });
          for (const upd of updatedVariants) {
            const v = grade.variants.find(x => String(x.fromQty) === String(upd.fromQty));
            if (v) { v.basePrice = upd.basePrice; v.finalPrice = upd.finalPrice; }
          }
          highestUpdated = getHighestVariant(updatedVariants);
          grade.lowestUnitPrice = getLowestUnitPrice(updatedVariants);
          product.currentPrice   = getLowestUnitPriceAcrossGrades(product.grades) || 0;
          product.priceUpdatedAt = new Date();
          // Price applied to this grade → re-enable it (clears yesterday's "not available" deactivation)
          grade.isActive = true;
        } else {
          const prevHighestVariant = getHighestVariant(product.variants || []);
          prevPrice = prevHighestVariant?.finalPrice || product.currentPrice;
          if (u.variantDiffPercent !== undefined) product.variantDiffPercent = Number(u.variantDiffPercent);
          updatedVariants = calculateVariantPricing(product, {
            highestBasePrice:   Number(u.highestBasePrice),
            variantDiffPercent: product.variantDiffPercent,
          });
          for (const upd of updatedVariants) {
            const vByIdx = product.variants.find(x => String(x.fromQty) === String(upd.fromQty));
            if (vByIdx) { vByIdx.basePrice = upd.basePrice; vByIdx.finalPrice = upd.finalPrice; }
          }
          highestUpdated = getHighestVariant(updatedVariants);
          product.basePrice      = Number(u.highestBasePrice);
          product.finalPrice     = highestUpdated?.finalPrice || 0;
          product.currentPrice   = getLowestUnitPrice(updatedVariants) || highestUpdated?.finalPrice || 0;
          product.priceUpdatedAt = new Date();
          // Price applied to whole product → re-enable all grades too
          if (product.gradesEnabled && product.grades?.length) {
            product.grades.forEach(g => { if (g.gradeKey !== 'base') g.isActive = true; });
          }
        }

        // Applying a price means the product is available today — auto-reactivate
        product.isAvailable = true;
        await product.save();

        setImmediate(async () => {
          try {
            await KoyambeduPriceHistory.create({
              product: product._id, seller: product.seller,
              productName: product.name, productCode: product.productCode,
              previousPrice: prevPrice, updatedPrice: highestUpdated?.finalPrice || 0,
              basePrice: Number(u.highestBasePrice),
              variantDiffPct: u.gradeKey
                ? (product.grades.find(g => g.gradeKey === u.gradeKey)?.variantDiffPercent || 2)
                : product.variantDiffPercent,
              updatedBy: req.user._id, updatedByName: req.user.name || req.user.email,
              updatedByRole: isAdmin ? 'superAdmin' : 'sellerAdmin',
              source: 'bulk_update',
              ...(u.gradeKey ? { gradeKey: u.gradeKey } : {}),
            });
            await KoyambeduSettings.touchPriceUpdate(req.user._id, req.user.name || req.user.email);
          } catch (_) {}
        });

        results.push({
          productId:       u.productId,
          updatedVariants,
          highestVariant:  highestUpdated,
          lowestUnitPrice: getLowestUnitPrice(updatedVariants),
        });
      } catch (e) {
        results.push({ productId: u.productId, error: e.message });
      }
    }

    res.json({ success: true, results });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ══════════════════════════════════════════════
// FEATURE 5 — Price History
// GET /seller-admin/price-history?productId=&days=7&from=&to=
// ══════════════════════════════════════════════
/** GET /api/koyambedu/products/:productId/price-history — public, last 30 days */
const getProductPriceHistory = async (req, res) => {
  try {
    const since = new Date();
    since.setDate(since.getDate() - 30);
    const history = await KoyambeduPriceHistory.find({
      product: req.params.productId,
      createdAt: { $gte: since },
    }).sort({ createdAt: -1 }).limit(30).select('price date createdAt note').lean();
    res.json({ success: true, history });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getPriceHistory = async (req, res) => {
  try {
    const { productId, days, from, to } = req.query;
    const filter = {};
    if (productId) filter.product = productId;

    const dateFilter = {};
    if (from) dateFilter.$gte = new Date(from);
    if (to)   dateFilter.$lte = new Date(new Date(to).setHours(23,59,59,999));
    if (!from && !to && days) {
      const d = new Date();
      d.setDate(d.getDate() - parseInt(days));
      dateFilter.$gte = d;
    }
    if (Object.keys(dateFilter).length) filter.createdAt = dateFilter;

    const history = await KoyambeduPriceHistory.find(filter)
      .sort({ createdAt: -1 })
      .limit(500)
      .populate('product', 'name productCode')
      .lean();

    res.json({ success: true, history });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ══════════════════════════════════════════════
// FEATURE 6 — Forecast Price
// GET  /seller-admin/forecast — list products with forecastPrice
// PATCH /seller-admin/forecast/:productId — set forecast
// POST  /seller-admin/forecast/:productId/approve — approve (sets currentPrice)
// ══════════════════════════════════════════════
const getForecasts = async (req, res) => {
  try {
    const sellers = await require('../models/KoyambeduSeller').find({}).select('_id').lean();
    const products = await KoyambeduProduct.find({ seller: { $in: sellers.map(s => s._id) }, isActive: true })
      .populate('seller', 'name')
      .select('name productCode currentPrice forecastPrice forecastApproved forecastApprovedAt priceUpdatedAt')
      .lean();
    res.json({ success: true, products });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const setForecastPrice = async (req, res) => {
  try {
    const { productId } = req.params;
    const { forecastPrice } = req.body;
    const product = await KoyambeduProduct.findByIdAndUpdate(
      productId,
      { forecastPrice, forecastApproved: false },
      { new: true }
    );
    if (!product) return res.status(404).json({ success: false, message: 'Product not found' });
    res.json({ success: true, product });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const approveForecast = async (req, res) => {
  try {
    const { productId } = req.params;
    const product = await KoyambeduProduct.findById(productId);
    if (!product) return res.status(404).json({ success: false, message: 'Product not found' });
    if (!product.forecastPrice) return res.status(400).json({ success: false, message: 'No forecast price set' });

    const prevPrice = product.currentPrice;
    product.currentPrice     = product.forecastPrice;
    product.finalPrice       = product.forecastPrice;
    product.priceUpdatedAt   = new Date();
    product.forecastApproved  = true;
    product.forecastApprovedAt = new Date();
    product.forecastApprovedBy = req.user._id;
    await product.save();

    await KoyambeduPriceHistory.create({
      product: product._id, seller: product.seller,
      productName: product.name, productCode: product.productCode,
      previousPrice: prevPrice, updatedPrice: product.forecastPrice,
      updatedBy: req.user._id, updatedByName: req.user.name || req.user.email,
      updatedByRole: req.user.role === 'superAdmin' ? 'superAdmin' : 'sellerAdmin',
      source: 'forecast_approved',
    });

    res.json({ success: true, product, message: `Forecast ₹${product.forecastPrice} is now today's price` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ══════════════════════════════════════════════
// FEATURE 7 — Procurement Summary Report
// GET /admin/reports/procurement?date=2026-06-22
// ══════════════════════════════════════════════
const procurementReport = async (req, res) => {
  try {
    const { date, gradeKey } = req.query;
    const cycle = date || getProcurementCycle();

    const orders = await KoyambeduOrder.find({
      cutoffCycle: cycle,
      paymentStatus: 'paid',
      orderStatus: { $nin: ['cancelled'] },
    }).populate('items.product', 'name unit').lean();

    // Aggregate by product + grade composite key
    const summary = {};
    for (const order of orders) {
      for (const item of order.items) {
        // Apply grade filter if requested
        if (gradeKey && gradeKey !== 'all' && item.gradeKey !== gradeKey) continue;

        const compositeKey = item.gradeKey
          ? `${item.product?._id?.toString() || item.name}__${item.gradeKey}`
          : (item.product?._id?.toString() || item.name);

        if (!summary[compositeKey]) {
          summary[compositeKey] = {
            productId:   item.product?._id?.toString() || item.name,
            productName: item.name,
            gradeKey:    item.gradeKey || null,
            gradeName:   item.gradeName || null,
            unit:        item.unit || 'kg',
            totalQty:    0,
            totalValue:  0,
            orderCount:  0,
          };
        }
        summary[compositeKey].totalQty   += item.quantity || 0;
        summary[compositeKey].totalValue += (item.orderedPrice || item.finalPrice || 0) * (item.quantity || 0);
        summary[compositeKey].orderCount += 1;
      }
    }

    const summaryRows = Object.values(summary).sort((a, b) => {
      const nameComp = a.productName.localeCompare(b.productName);
      if (nameComp !== 0) return nameComp;
      return (a.gradeKey || '').localeCompare(b.gradeKey || '');
    });

    // Grade-wise summary (aggregate across all products, grouped by grade)
    const gradeMap = {};
    for (const row of summaryRows) {
      const gKey = row.gradeKey || '__none__';
      if (!gradeMap[gKey]) {
        gradeMap[gKey] = { gradeKey: row.gradeKey, gradeName: row.gradeName, totalQty: 0, totalValue: 0, orderCount: 0 };
      }
      gradeMap[gKey].totalQty   += row.totalQty;
      gradeMap[gKey].totalValue += row.totalValue;
      gradeMap[gKey].orderCount += row.orderCount;
    }
    const gradeWiseSummary = Object.values(gradeMap).filter(g => g.gradeKey);

    res.json({
      success: true,
      cycle,
      totalOrders: orders.length,
      summary: summaryRows,
      gradeWiseSummary,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ══════════════════════════════════════════════
// FEATURE 8 — Slot-wise Order Report
// GET /admin/reports/slot-wise?date=2026-06-22&slot=slot1
// ══════════════════════════════════════════════
const slotWiseReport = async (req, res) => {
  try {
    const { date, slot } = req.query;
    const cycle = date || getProcurementCycle();

    const filter = {
      cutoffCycle:   cycle,
      paymentStatus: 'paid',
      orderStatus:   { $nin: ['cancelled'] },
    };
    if (slot) filter.deliverySlotKey = slot;

    const orders = await KoyambeduOrder.find(filter)
      .populate('buyer', 'name email phone')
      .populate('items.product', 'name')
      .sort({ deliverySlotKey: 1, createdAt: 1 })
      .lean();

    // Group by slot
    const grouped = { slot1: [], slot2: [], slot3: [] };
    for (const order of orders) {
      const key = order.deliverySlotKey || 'slot1';
      grouped[key].push({
        orderId:    order.orderId,
        buyerName:  order.buyer?.name || order.shippingAddress?.fullName,
        items:      order.items.map(i => {
          // grade is already embedded in i.name for new orders; fall back to gradeKey for old
          const gl = i.gradeName || i.gradeKey;
          const nm = gl && !i.name.includes(gl) ? `${i.name} (${gl})` : i.name;
          return `${nm} x${i.quantity}${i.unit}`;
        }).join(', '),
        amount:     order.pricing?.total,
        slot:       order.deliverySlot,
      });
    }

    res.json({ success: true, cycle, grouped, slotLabels: DELIVERY_SLOTS });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ══════════════════════════════════════════════
// FEATURE 9 — Destination-wise Report
// GET /admin/reports/destination?date=2026-06-22
// ══════════════════════════════════════════════
const destinationReport = async (req, res) => {
  try {
    const { date } = req.query;
    const cycle = date || getProcurementCycle();

    const orders = await KoyambeduOrder.find({
      cutoffCycle:   cycle,
      paymentStatus: 'paid',
      orderStatus:   { $in: CONFIRMED_REPORT_STATUSES },
    })
      .populate('buyer', 'name phone')
      .populate('items.product', 'name')
      .lean();

    // Group by pincode/area
    const grouped = {};
    for (const order of orders) {
      const pincode = order.shippingAddress?.pincode || order.buyerLocation?.pincode || 'Unknown';
      const area    = order.buyerLocation?.areaName  || order.shippingAddress?.city  || 'Chennai';
      const key     = `${area} — ${pincode}`;
      if (!grouped[key]) grouped[key] = { area, pincode, orders: [] };
      grouped[key].orders.push({
        orderId:      order.orderId,
        buyerName:    order.shippingAddress?.fullName || order.buyer?.name,
        phone:        order.shippingAddress?.phone,
        address:      `${order.shippingAddress?.addressLine1 || ''} ${order.shippingAddress?.addressLine2 || ''}`.trim(),
        deliverySlot: order.deliverySlot,
        amount:       order.pricing?.total,
        items:        order.items.map(i => `${i.name} x${i.quantity}${i.unit}`).join(', '),
      });
    }

    res.json({ success: true, cycle, grouped: Object.values(grouped).sort((a, b) => a.pincode.localeCompare(b.pincode)) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ══════════════════════════════════════════════
// FEATURE 10 — Enhanced Dashboard Stats
// GET /admin/reports/dashboard?date=2026-06-22
// ══════════════════════════════════════════════
const dashboardStats = async (req, res) => {
  try {
    const { date } = req.query;
    const cycle = date || getProcurementCycle();

    const [orders, totalSellers, totalProducts] = await Promise.all([
      KoyambeduOrder.find({ cutoffCycle: cycle, paymentStatus: 'paid', orderStatus: { $nin: ['cancelled'] } }).lean(),
      require('../models/KoyambeduSeller').countDocuments({ isApproved: true }),
      KoyambeduProduct.countDocuments({ isActive: true }),
    ]);

    const revenue = orders.reduce((s, o) => s + (o.pricing?.total || 0), 0);
    const pending = orders.filter(o => ['placed','pending_confirmation','confirmed','packing'].includes(o.orderStatus)).length;
    const delivered = orders.filter(o => o.orderStatus === 'delivered').length;

    // Slot breakdown
    const slotBreakdown = { slot1: 0, slot2: 0, slot3: 0 };
    orders.forEach(o => { if (o.deliverySlotKey) slotBreakdown[o.deliverySlotKey]++; });

    res.json({
      success: true,
      cycle,
      ordersToday:   orders.length,
      revenueToday:  Math.round(revenue * 100) / 100,
      pendingOrders: pending,
      deliveredOrders: delivered,
      totalSellers,
      totalProducts,
      slotBreakdown,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ══════════════════════════════════════════════
// FEATURE 12 — Special Occasion Requests
// ══════════════════════════════════════════════
const KoyambeduSpecialRequest = require('../models/KoyambeduSpecialRequest');
const nodemailer = require('nodemailer');

const sendSpecialRequestEmail = async (req) => {
  try {
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) return;
    const transporter = nodemailer.createTransporter({
      service: 'gmail',
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
    });
    const itemsList = (req.requestedItems || []).map(i => `• ${i.itemName} — ${i.quantity} ${i.unit}`).join('\n');
    await transporter.sendMail({
      from:    `"Eptomart Koyambedu" <${process.env.EMAIL_USER}>`,
      to:      process.env.ADMIN_EMAIL || process.env.EMAIL_USER,
      subject: `🎉 Special Occasion Request — ${req.occasionType} — ${req.buyerName}`,
      text:    `New special request received!\n\nName: ${req.buyerName}\nPhone: ${req.phone}\nEmail: ${req.email || '—'}\nOccasion: ${req.occasionType}\nRequired Date: ${req.requiredDate?.toDateString()}\n\nItems:\n${itemsList}\n\nNotes: ${req.additionalNotes || '—'}`,
    });
  } catch (e) {
    console.error('[KBD SpecialRequest Email]', e.message);
  }
};

const submitSpecialRequest = async (req, res) => {
  try {
    const { buyerName, phone, email, occasionType, occasionTypeOther, requestedItems, requiredDate, additionalNotes } = req.body;
    if (!buyerName || !phone || !requiredDate) {
      return res.status(400).json({ success: false, message: 'buyerName, phone, requiredDate required' });
    }
    const sr = await KoyambeduSpecialRequest.create({
      buyerName, phone, email, occasionType, occasionTypeOther,
      requestedItems, requiredDate, additionalNotes,
      user: req.user?._id,
    });
    // Fire-and-forget email
    sendSpecialRequestEmail(sr).then(async () => {
      sr.emailSent = true; sr.emailSentAt = new Date(); await sr.save();
    });
    res.json({ success: true, message: 'Request submitted! We will contact you within 24 hours.', request: sr });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getSpecialRequests = async (req, res) => {
  try {
    const { status } = req.query;
    const filter = status ? { status } : {};
    const requests = await KoyambeduSpecialRequest.find(filter).sort({ createdAt: -1 }).lean();
    res.json({ success: true, requests });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const updateSpecialRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, adminNotes } = req.body;
    const update = { status, adminNotes, handledBy: req.user._id };
    if (status === 'contacted') update.contactedAt = new Date();
    if (status === 'completed') update.completedAt = new Date();
    const sr = await KoyambeduSpecialRequest.findByIdAndUpdate(id, update, { new: true });
    if (!sr) return res.status(404).json({ success: false, message: 'Request not found' });
    res.json({ success: true, request: sr });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ══════════════════════════════════════════════
// FEATURE — LAST PRODUCT UPDATE TIME
// ══════════════════════════════════════════════

/** GET /api/koyambedu/settings/last-update — public, returns last price update time */
const getLastProductUpdateTime = async (req, res) => {
  try {
    // Use the max priceUpdatedAt across all active products as ground truth
    const latest = await KoyambeduProduct.findOne({ isActive: true })
      .sort({ priceUpdatedAt: -1 })
      .select('priceUpdatedAt')
      .lean();
    // Also check the settings doc
    const settings = await KoyambeduSettings.findOne({ key: 'global' }).lean();
    const fromProducts = latest?.priceUpdatedAt;
    const fromSettings = settings?.lastProductUpdateTime;
    let lastUpdate = null;
    if (fromProducts && fromSettings) lastUpdate = fromProducts > fromSettings ? fromProducts : fromSettings;
    else lastUpdate = fromProducts || fromSettings || null;
    res.json({ success: true, lastUpdate });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ══════════════════════════════════════════════
// FEATURE — PROCUREMENT INVOICE GENERATION
// POST /api/koyambedu/admin/orders/:id/procurement-invoice
// ══════════════════════════════════════════════

/**
 * Admin enters actual procurement prices per item.
 * System computes diff vs estimated price:
 *   diff > 0  → price decreased → credit wallet
 *   diff < 0  → price increased → debit wallet (may go negative)
 * Idempotent: if walletAdjustmentApplied === true, returns 409.
 */
const generateProcurementInvoice = async (req, res) => {
  try {
    const { id } = req.params;
    // actualItems: [{ productId, actualUnitPrice }]
    const { actualItems } = req.body;

    if (!actualItems?.length) {
      return res.status(400).json({ success: false, message: 'actualItems array is required' });
    }

    const order = await KoyambeduOrder.findById(id)
      .populate('buyer', 'name email phone');
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    // Idempotency guard
    if (order.procurementPricing?.walletAdjustmentApplied) {
      return res.status(409).json({
        success: false,
        message: 'Procurement invoice already generated for this order',
        procurementPricing: order.procurementPricing,
      });
    }

    // Only work on confirmed items
    const confirmedItems = order.items.filter(
      it => it.itemStatus !== 'declined' && it.confirmedQty > 0
    );

    if (!confirmedItems.length) {
      return res.status(400).json({ success: false, message: 'No confirmed items in this order' });
    }

    // Build per-item procurement pricing
    const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
    let totalEstimated   = 0;
    let totalActual      = 0;
    let totalWalletCredit = 0;
    let totalWalletDue   = 0;

    const procItems = confirmedItems.map(item => {
      const actualEntry = actualItems.find(a => String(a.productId) === String(item.product));
      const actualUnitPrice = actualEntry ? r2(Number(actualEntry.actualUnitPrice)) : r2(item.orderedPrice);
      // Use finalPrice (post-revision price) as the estimate so that daily price
      // revisions don't create double-adjustments in the procurement invoice.
      const estimatedUnitPrice = r2(item.finalPrice || item.orderedPrice || 0);
      const qty = r2(item.confirmedQty);

      const lineEstimated = r2(estimatedUnitPrice * qty);
      const lineActual    = r2(actualUnitPrice * qty);
      const lineDiff      = r2(lineEstimated - lineActual); // +ve = cheaper, -ve = costlier

      let walletAction = 'none';
      let walletAmount = 0;
      if (lineDiff > 0) {
        walletAction = 'credit';
        walletAmount = lineDiff;
        totalWalletCredit += lineDiff;
      } else if (lineDiff < 0) {
        walletAction = 'due';
        walletAmount = Math.abs(lineDiff);
        totalWalletDue += Math.abs(lineDiff);
      }

      totalEstimated += lineEstimated;
      totalActual    += lineActual;

      return {
        productId:          item.product,
        name:               item.name,
        unit:               item.unit,
        confirmedQty:       qty,
        estimatedUnitPrice,
        actualUnitPrice,
        lineEstimated,
        lineActual,
        lineDiff,
        walletAction,
        walletAmount: r2(walletAmount),
      };
    });

    totalEstimated    = r2(totalEstimated);
    totalActual       = r2(totalActual);
    totalWalletCredit = r2(totalWalletCredit);
    totalWalletDue    = r2(totalWalletDue);
    const netWalletAdjustment = r2(totalWalletCredit - totalWalletDue);

    // ── Apply wallet adjustments atomically ───────────────────────────────
    const buyerId = order.buyer?._id || order.buyer;
    let wallet = await KoyambeduWallet.findOne({ user: buyerId });
    if (!wallet) wallet = new KoyambeduWallet({ user: buyerId, balance: 0 });

    for (const pi of procItems) {
      if (pi.walletAction === 'credit') {
        await wallet.credit(pi.walletAmount, 'price_adjustment_credit', {
          orderId:      order.orderId,
          orderRef:     order._id,
          productId:    pi.productId,
          productName:  pi.name,
          adminBy:      req.user._id,
          adminName:    req.user.name || req.user.email,
          reason:       `Market price decreased for ${pi.name} (Est ₹${pi.estimatedUnitPrice} → Actual ₹${pi.actualUnitPrice})`,
        });
      } else if (pi.walletAction === 'due') {
        await wallet.debit(pi.walletAmount, 'price_adjustment_due', {
          orderId:      order.orderId,
          orderRef:     order._id,
          productId:    pi.productId,
          productName:  pi.name,
          adminBy:      req.user._id,
          adminName:    req.user.name || req.user.email,
          reason:       `Market price increased for ${pi.name} (Est ₹${pi.estimatedUnitPrice} → Actual ₹${pi.actualUnitPrice})`,
        });
      }
    }

    // ── Save procurement pricing to order ─────────────────────────────────
    order.procurementPricing = {
      status:              'confirmed',
      generatedAt:         new Date(),
      generatedBy:         req.user._id,
      confirmedAt:         new Date(),
      confirmedBy:         req.user._id,
      items:               procItems,
      totalEstimated,
      totalActual,
      totalWalletCredit,
      totalWalletDue,
      netWalletAdjustment,
      walletAdjustmentApplied:   true,
      walletAdjustmentAppliedAt: new Date(),
    };

    // Add timeline event
    order.timeline.push({
      event:       'procurement_invoice_generated',
      description: `Procurement invoice generated. Net wallet adjustment: ₹${netWalletAdjustment >= 0 ? '+' : ''}${netWalletAdjustment}`,
      actor:       { role: 'super_admin', userId: req.user._id, name: req.user.name || req.user.email },
      meta:        { totalWalletCredit, totalWalletDue, netWalletAdjustment },
    });

    // Mark tax invoice available
    if (!order.invoices) order.invoices = {};
    order.invoices.tax = {
      number:      `TAX-${order.orderId}`,
      generatedAt: new Date(),
      isAvailable: true,
    };

    // Lock prices — no further daily price revisions can occur once the
    // procurement/tax invoice is generated.
    lockOrderPrices(order);

    await order.save();

    // ── Fire-and-forget: WhatsApp notification ────────────────────────────
    setImmediate(async () => {
      try {
        const buyer = order.buyer;
        const phone = buyer?.phone || '';
        if (!phone) return;
        let msg = `Hi ${buyer.name || 'Customer'}, your Koyambedu Daily order #${order.orderId} invoice is ready.\n`;
        if (netWalletAdjustment > 0) {
          msg += `✅ ₹${totalWalletCredit.toFixed(2)} has been credited to your Eptomart Wallet because today's procurement price was lower than estimated.`;
        } else if (netWalletAdjustment < 0) {
          msg += `ℹ️ ₹${totalWalletDue.toFixed(2)} has been added as a pending wallet adjustment because today's procurement price increased. It will automatically be recovered in your next order.`;
        } else {
          msg += `Prices matched estimated rates — no wallet adjustment needed.`;
        }
        await sendTemplateWhatsApp(phone, msg);
      } catch (_) {}
    });

    res.json({
      success: true,
      message: 'Procurement invoice generated and wallet adjusted.',
      procurementPricing: order.procurementPricing,
      walletBalance: wallet.balance,
    });
  } catch (err) {
    console.error('[KBD] generateProcurementInvoice error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ══════════════════════════════════════════════
// WALLET — customer-facing
// ══════════════════════════════════════════════

/** GET /api/koyambedu/wallet — get or create wallet for logged-in buyer */
const getWallet = async (req, res) => {
  let wallet = await KoyambeduWallet.findOne({ user: req.user._id }).lean();
  if (!wallet) {
    const created = await KoyambeduWallet.create({ user: req.user._id });
    wallet = created.toObject();
  }
  res.json({ success: true, wallet });
};

/** POST /api/koyambedu/wallet/refund-request — customer requests refund of wallet balance */
const requestWalletRefund = async (req, res) => {
  const { amount, bankAccountName, bankAccountNumber, confirmAccountNumber, bankIfsc, bankName } = req.body;
  if (!amount || !bankAccountName || !bankAccountNumber || !bankIfsc) {
    return res.status(400).json({ success: false, message: 'amount, bankAccountName, bankAccountNumber, bankIfsc are required' });
  }
  if (bankAccountNumber !== confirmAccountNumber) {
    return res.status(400).json({ success: false, message: 'Account numbers do not match' });
  }
  let wallet = await KoyambeduWallet.findOne({ user: req.user._id });
  if (!wallet) return res.status(404).json({ success: false, message: 'Wallet not found' });

  // Use available balance (total − already reserved)
  const reserved  = wallet.reservedBalance || 0;
  const available = wallet.balance - reserved;
  if (amount > available) {
    return res.status(400).json({ success: false, message: `Insufficient available balance. Available: ₹${available.toFixed(2)}` });
  }

  // Block if a pending or confirmed request already exists (funds already reserved)
  const active = wallet.refundRequests.find(r => r.status === 'pending' || r.status === 'confirmed');
  if (active) return res.status(400).json({ success: false, message: 'You already have an active refund request' });

  // Reserve the requested amount
  wallet.reservedBalance = reserved + amount;
  wallet.transactions.push({
    type:        'debit',
    category:    'refund_requested',
    amount,
    balanceAfter: wallet.balance, // balance itself unchanged; only reservation increases
    reason:      `Refund request submitted — ₹${amount} reserved`,
  });
  wallet.refundRequests.push({ amount, bankAccountName, bankAccountNumber, bankIfsc, bankName: bankName || '' });
  await wallet.save();
  res.json({ success: true, message: 'Refund request submitted' });
};

// ══════════════════════════════════════════════
// WALLET — admin-facing
// ══════════════════════════════════════════════

/** GET /api/koyambedu/admin/refund-requests — list pending refund requests */
const adminGetRefundRequests = async (req, res) => {
  const { status = 'pending' } = req.query;
  const wallets = await KoyambeduWallet.find({ 'refundRequests.status': status })
    .populate('user', 'name email phone')
    .lean();
  const requests = [];
  wallets.forEach(w => {
    const reserved  = w.reservedBalance || 0;
    const available = w.balance - reserved;
    w.refundRequests.filter(r => r.status === status).forEach(r => {
      requests.push({
        ...r,
        walletId:        w._id,
        userId:          w.user,
        walletBalance:   w.balance,
        reservedBalance: reserved,
        availableBalance: Math.max(0, available),
      });
    });
  });
  requests.sort((a, b) => new Date(b.requestedAt) - new Date(a.requestedAt));
  res.json({ success: true, requests });
};

/** PATCH /api/koyambedu/admin/refund-requests/:walletId/:requestId — confirm/cancel/mark-refunded */
const adminUpdateRefundRequest = async (req, res) => {
  const { walletId, requestId } = req.params;
  const { action, adminNote } = req.body; // 'confirm', 'cancel', 'mark_refunded'
  const wallet = await KoyambeduWallet.findById(walletId);
  if (!wallet) return res.status(404).json({ success: false, message: 'Wallet not found' });
  const rr = wallet.refundRequests.id(requestId);
  if (!rr) return res.status(404).json({ success: false, message: 'Refund request not found' });

  const r2 = n => Math.round((Number(n) || 0) * 100) / 100;

  if (action === 'confirm') {
    if (rr.status !== 'pending') return res.status(400).json({ success: false, message: 'Request is not pending' });
    rr.status = 'confirmed';

  } else if (action === 'cancel') {
    if (!['pending', 'confirmed'].includes(rr.status)) {
      return res.status(400).json({ success: false, message: 'Cannot cancel a completed or already cancelled request' });
    }
    // Release reservation → restore available balance
    wallet.reservedBalance = r2(Math.max(0, (wallet.reservedBalance || 0) - rr.amount));
    wallet.transactions.push({
      type:        'credit',
      category:    'refund_released',
      amount:       rr.amount,
      balanceAfter: wallet.balance,
      reason:       `Refund request cancelled — ₹${rr.amount} reservation released`,
      adminBy:      req.user._id,
      adminName:    req.user.name,
    });
    rr.status = 'cancelled';
    rr.processedAt = new Date();

  } else if (action === 'mark_refunded') {
    if (rr.status !== 'confirmed') return res.status(400).json({ success: false, message: 'Confirm the request first' });
    if (wallet.balance < rr.amount) return res.status(400).json({ success: false, message: 'Wallet balance insufficient for refund' });
    // Permanently deduct balance + clear reservation
    wallet.balance = r2(wallet.balance - rr.amount);
    wallet.reservedBalance = r2(Math.max(0, (wallet.reservedBalance || 0) - rr.amount));
    wallet.transactions.push({
      type:        'debit',
      category:    'refund_paid',
      amount:       rr.amount,
      balanceAfter: wallet.balance,
      reason:      'Bank refund disbursed',
      note:         adminNote || 'Admin initiated bank transfer',
      adminBy:      req.user._id,
      adminName:    req.user.name,
    });
    rr.status = 'refunded';
    rr.processedAt = new Date();

  } else {
    return res.status(400).json({ success: false, message: 'Invalid action' });
  }
  if (adminNote) rr.adminNote = adminNote;
  await wallet.save();
  res.json({ success: true, message: 'Updated', status: rr.status });
};

// ══════════════════════════════════════════════
// WALLET — Super Admin all-customers view
// ══════════════════════════════════════════════

/**
 * GET /admin/wallets
 * List all customer wallets with balance summary.
 * Query: search, balanceFilter (all/positive/negative/zero), sort (balance_desc/balance_asc/name), page, limit
 */
const adminGetAllWallets = async (req, res) => {
  try {
    const { search = '', balanceFilter = 'all', sort = 'balance_desc', page = 1, limit = 50 } = req.query;
    let wallets = await KoyambeduWallet.find().populate('user', 'name email phone').lean();

    if (search.trim()) {
      const s = search.trim().toLowerCase();
      wallets = wallets.filter(w =>
        w.user?.name?.toLowerCase().includes(s) ||
        w.user?.phone?.includes(s) ||
        w.user?.email?.toLowerCase().includes(s)
      );
    }
    if (balanceFilter === 'positive')  wallets = wallets.filter(w => w.balance > 0);
    else if (balanceFilter === 'negative') wallets = wallets.filter(w => w.balance < 0);
    else if (balanceFilter === 'zero') wallets = wallets.filter(w => w.balance === 0);

    if (sort === 'balance_desc') wallets.sort((a, b) => b.balance - a.balance);
    else if (sort === 'balance_asc') wallets.sort((a, b) => a.balance - b.balance);
    else if (sort === 'name') wallets.sort((a, b) => (a.user?.name || '').localeCompare(b.user?.name || ''));

    const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
    const totalLiability     = wallets.filter(w => w.balance > 0).reduce((s, w) => s + w.balance, 0);
    const negativeCount      = wallets.filter(w => w.balance < 0).length;
    const pendingRefundCount = wallets.reduce((s, w) => s + (w.refundRequests || []).filter(r => r.status === 'pending').length, 0);
    const totalPendingRefund = wallets.reduce((s, w) => s + (w.refundRequests || []).filter(r => r.status === 'pending').reduce((x, r) => x + r.amount, 0), 0);

    const skip = (Number(page) - 1) * Number(limit);
    const paginated = wallets.slice(skip, skip + Number(limit));

    const result = paginated.map(w => ({
      _id:              w._id,
      user:             w.user,
      balance:          r2(w.balance),
      reservedBalance:  r2(w.reservedBalance || 0),
      availableBalance: r2(Math.max(0, (w.balance || 0) - (w.reservedBalance || 0))),
      txnCount:         (w.transactions || []).length,
      pendingRefunds:   (w.refundRequests || []).filter(r => r.status === 'pending'),
      allRefundRequests: (w.refundRequests || []).slice().reverse().slice(0, 10),
      recentTxns:       (w.transactions || []).slice().reverse().slice(0, 5),
      updatedAt:        w.updatedAt,
    }));

    res.json({
      success: true,
      wallets: result,
      total: wallets.length,
      page: Number(page),
      pages: Math.ceil(wallets.length / Number(limit)),
      summary: { totalLiability: r2(totalLiability), negativeCount, pendingRefundCount, totalPendingRefund: r2(totalPendingRefund) },
    });
  } catch (err) {
    console.error('adminGetAllWallets:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * GET /admin/wallets/:walletId/transactions — full history for one wallet
 */
const adminGetWalletTransactions = async (req, res) => {
  try {
    const wallet = await KoyambeduWallet.findById(req.params.walletId).populate('user', 'name email phone').lean();
    if (!wallet) return res.status(404).json({ success: false, message: 'Wallet not found' });
    const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
    res.json({
      success: true,
      user:             wallet.user,
      balance:          r2(wallet.balance),
      reservedBalance:  r2(wallet.reservedBalance || 0),
      availableBalance: r2(Math.max(0, (wallet.balance || 0) - (wallet.reservedBalance || 0))),
      transactions:     (wallet.transactions || []).slice().reverse(),
      refundRequests:   (wallet.refundRequests || []).slice().reverse(),
    });
  } catch (err) {
    console.error('adminGetWalletTransactions:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * POST /admin/wallets/:walletId/manual-credit — Body: { amount, reason }
 */
const adminWalletManualCredit = async (req, res) => {
  try {
    const { amount, reason } = req.body;
    const amt = Number(amount);
    if (!amt || amt <= 0) return res.status(400).json({ success: false, message: 'Invalid amount' });
    if (!reason?.trim()) return res.status(400).json({ success: false, message: 'Reason is required' });
    const wallet = await KoyambeduWallet.findById(req.params.walletId);
    if (!wallet) return res.status(404).json({ success: false, message: 'Wallet not found' });
    await wallet.credit(amt, 'manual_credit', { adminBy: req.user._id, adminName: req.user.name, reason: reason.trim() });
    res.json({ success: true, message: `₹${amt} credited`, balance: wallet.balance });
  } catch (err) {
    console.error('adminWalletManualCredit:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * POST /admin/wallets/:walletId/manual-debit — Body: { amount, reason }
 */
const adminWalletManualDebit = async (req, res) => {
  try {
    const { amount, reason } = req.body;
    const amt = Number(amount);
    if (!amt || amt <= 0) return res.status(400).json({ success: false, message: 'Invalid amount' });
    if (!reason?.trim()) return res.status(400).json({ success: false, message: 'Reason is required' });
    const wallet = await KoyambeduWallet.findById(req.params.walletId);
    if (!wallet) return res.status(404).json({ success: false, message: 'Wallet not found' });
    await wallet.debit(amt, 'manual_debit', { adminBy: req.user._id, adminName: req.user.name, reason: reason.trim() });
    res.json({ success: true, message: `₹${amt} debited`, balance: wallet.balance });
  } catch (err) {
    console.error('adminWalletManualDebit:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * PATCH /admin/orders/:orderId/partial-refund
 * Initiate a partial refund via Razorpay to source (card/UPI/net-banking).
 * Body: { amount: Number (₹), reason: String }
 */
const adminPartialRefund = async (req, res) => {
  try {
    const { amount, reason } = req.body;
    const refundAmount = Number(amount);
    if (!refundAmount || refundAmount <= 0) {
      return res.status(400).json({ success: false, message: 'Enter a valid refund amount' });
    }
    if (!reason?.trim()) {
      return res.status(400).json({ success: false, message: 'Reason is required before initiating a refund' });
    }

    const order = await KoyambeduOrder.findById(req.params.orderId);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    // Only Razorpay payments can be refunded to source
    if (order.paymentMethod !== 'razorpay') {
      return res.status(400).json({ success: false, message: 'Partial refund to source is only available for Razorpay payments. For COD, credit the wallet manually.' });
    }
    if (order.paymentStatus !== 'paid') {
      return res.status(400).json({ success: false, message: 'Payment has not been captured yet or order is already fully refunded.' });
    }

    const paymentId = order.paymentDetails?.razorpayPaymentId;
    if (!paymentId) {
      return res.status(400).json({ success: false, message: 'Razorpay payment ID not found on this order.' });
    }

    // Check requested amount doesn't exceed order total minus already-refunded amounts
    const alreadyRefunded = (order.partialRefunds || [])
      .filter(r => r.status === 'initiated')
      .reduce((s, r) => s + r.amount, 0);
    const maxRefundable = (order.pricing?.total || 0) - alreadyRefunded;
    if (refundAmount > maxRefundable) {
      return res.status(400).json({ success: false, message: `Maximum refundable amount is ₹${maxRefundable.toFixed(2)} (already refunded: ₹${alreadyRefunded.toFixed(2)})` });
    }

    // Call Razorpay refund API
    const rzpKeyId     = process.env.RAZORPAY_KEY_ID;
    const rzpKeySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!rzpKeyId || !rzpKeySecret) {
      return res.status(503).json({ success: false, message: 'Razorpay credentials not configured' });
    }

    const https = require('https');
    const amountPaise = Math.round(refundAmount * 100);
    const body = JSON.stringify({ amount: amountPaise, speed: 'normal', notes: { reason: reason || 'Partial refund by admin', orderId: order.orderId } });
    const auth = Buffer.from(`${rzpKeyId}:${rzpKeySecret}`).toString('base64');

    const rzpResponse = await new Promise((resolve, reject) => {
      const hreq = https.request({
        hostname: 'api.razorpay.com',
        path:     `/v1/payments/${paymentId}/refund`,
        method:   'POST',
        headers:  {
          'Content-Type':   'application/json',
          'Authorization':  `Basic ${auth}`,
          'Content-Length': Buffer.byteLength(body),
        },
      }, (hres) => {
        let d = '';
        hres.on('data', c => d += c);
        hres.on('end', () => {
          try { resolve({ status: hres.statusCode, body: JSON.parse(d || '{}') }); }
          catch { resolve({ status: hres.statusCode, body: { error: d } }); }
        });
      });
      hreq.on('error', reject);
      hreq.write(body);
      hreq.end();
    });

    if (rzpResponse.status >= 400) {
      const errMsg = rzpResponse.body?.error?.description || rzpResponse.body?.error || 'Razorpay refund failed';
      return res.status(502).json({ success: false, message: `Razorpay error: ${errMsg}` });
    }

    // Record the refund
    const refundRecord = {
      amount,
      reason: reason || '',
      razorpayRefundId: rzpResponse.body?.id || '',
      status:      'initiated',
      initiatedAt: new Date(),
      initiatedBy: req.user._id,
    };
    order.partialRefunds.push(refundRecord);
    // Update order-level refund note
    order.adminNotes = [order.adminNotes, `Partial refund ₹${amount} initiated (${new Date().toLocaleDateString('en-IN')})`].filter(Boolean).join(' | ');
    await order.save();

    res.json({
      success: true,
      message: `₹${amount} refund initiated to source via Razorpay`,
      refundId: rzpResponse.body?.id,
      partialRefunds: order.partialRefunds,
    });
  } catch (err) {
    console.error('adminPartialRefund:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

/** PATCH /seller-admin/orders/:orderId/status — SA can move order through fulfilment statuses */
const sellerAdminUpdateOrderStatus = async (req, res) => {
  try {
    const sa = req.kbdSellerAdmin;
    const { status, deliveryPartner, adminNotes } = req.body;

    const ALLOWED = ['confirmed', 'packing', 'dispatched', 'delivered'];
    if (!ALLOWED.includes(status)) {
      return res.status(400).json({ success: false, message: `Status must be one of: ${ALLOWED.join(', ')}` });
    }

    // Verify order has at least one item from this SA's sellers
    const sellerIds = (await KoyambeduSeller.find({ createdBySellerAdmin: sa._id }).select('_id').lean()).map(s => s._id);
    const order = await KoyambeduOrder.findOne({ _id: req.params.orderId, 'items.seller': { $in: sellerIds } });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found or not yours' });

    // Delivered / closed / cancelled orders are FINAL for Seller Admin —
    // only Super Admin can modify them from that point.
    if (['delivered', 'reported', 'closed', 'cancelled'].includes(order.orderStatus)) {
      return res.status(403).json({ success: false, message: 'This order is finalised. Only Super Admin can make changes now.' });
    }
    // Cannot self-confirm while declines/reductions await Super Admin approval
    const hasPendingChanges = (order.items || []).some(it => ['declined', 'partial'].includes(it.itemStatus));
    if (status === 'confirmed' && hasPendingChanges && order.adminApproval?.status !== 'approved') {
      return res.status(400).json({ success: false, message: 'Order has declined/reduced items — submit for Super Admin approval instead.' });
    }

    // ── Auto-refresh item prices to current market prices on confirm ──
    // Koyambedu prices are updated daily after market procurement.
    // When SA confirms the order, fetch the latest finalPrice for each
    // product variant and update the order — no super admin needed.
    if (status === 'confirmed') {
      const productIds = [...new Set(
        (order.items || []).map(it => it.product?.toString()).filter(Boolean)
      )];
      const currentProducts = await KoyambeduProduct.find({ _id: { $in: productIds } })
        .select('_id currentPrice variants')
        .lean();
      const productMap = {};
      for (const p of currentProducts) productMap[p._id.toString()] = p;

      for (const item of order.items) {
        if (item.itemStatus === 'declined') continue;
        const product = productMap[item.product?.toString()];
        if (!product) continue;

        let currentPrice = product.currentPrice || 0;
        // For variant products, find the tier matching ordered quantity
        if (product.variants?.length) {
          const qty = Number(item.orderedQty || item.quantity || 0);
          const match = product.variants
            .filter(v => qty >= Number(v.fromQty) && (v.toQty == null || qty <= Number(v.toQty)))
            .sort((a, b) => Number(b.fromQty) - Number(a.fromQty))[0];
          if (match?.finalPrice) currentPrice = match.finalPrice;
        }

        if (currentPrice && currentPrice !== item.finalPrice) {
          item.finalPrice   = currentPrice;
          item.priceRevised = true;
          item.markModified?.('finalPrice');
        }
      }
      // Recalculate totals with updated prices
      applyCalculation(order);
      order.confirmedAt = new Date();
    }

    order.orderStatus = status;
    if (deliveryPartner) order.deliveryPartner = deliveryPartner;
    if (adminNotes)      order.adminNotes      = adminNotes;
    if (status === 'dispatched')  order.dispatchedAt = new Date();
    if (status === 'delivered')   order.deliveredAt  = new Date();

    await order.save();
    res.json({ success: true, order: { _id: order._id, orderStatus: order.orderStatus } });
  } catch (err) {
    console.error('sellerAdminUpdateOrderStatus:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

/** GET /api/koyambedu/orders/:orderId/invoice — generate PDF invoice for buyer */
const getOrderInvoice = async (req, res) => {
  const PDFDocument = require('pdfkit');
  // Super Admin (via /admin/orders/:orderId/invoice) may view/download any customer's
  // invoice from the Order Summary page — the customer-facing route below still only
  // ever queries by buyer, so normal customer access is completely unchanged.
  const isAdminAccess = req.koyambeduAdminInvoiceAccess === true;
  const findQuery = isAdminAccess ? { _id: req.params.orderId } : { _id: req.params.orderId, buyer: req.user._id };
  const order = await KoyambeduOrder.findOne(findQuery)
    .populate('buyer', 'name email phone')
    .lean();
  if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

  // Declines shown only after Super Admin approval
  const declinesApproved = order.adminApproval?.status === 'approved' ||
    ['confirmed', 'packing', 'dispatched', 'delivered', 'closed', 'cancelled'].includes(order.orderStatus);
  if (!declinesApproved && order.items) {
    order.items = order.items.map(it => ({ ...it, itemStatus: 'pending', declinedQty: 0, confirmedQty: it.orderedQty ?? it.quantity }));
    if (order.calculatedPricing) order.calculatedPricing = { ...order.calculatedPricing, declinedRefundAmount: 0, finalPayableAmount: 0, lastCalculatedAt: null };
  }

  const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
  const fmtAmt = n => `INR ${r2(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtDate = d => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

  const doc = new PDFDocument({ size: 'A4', margin: 45, info: { Title: `Invoice ${order.orderId}`, Author: 'Eptomart' } });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="Invoice-${order.orderId}.pdf"`);
  doc.pipe(res);

  const L = 45;   // left margin
  const R = 550;  // right edge
  const W = R - L; // content width = 505

  // ── Column positions (ISO 6-column layout) ──────────────
  // S.No | Description | Qty | Unit | Rate | Amount
  const C = { sno: L, desc: L+28, qty: L+248, unit: L+300, rate: L+338, amt: L+418 };
  const CW = { sno: 26, desc: 218, qty: 50, unit: 36, rate: 78, amt: 87 };

  // ── HEADER ───────────────────────────────────────────────
  // Brand block (left)
  doc.fontSize(22).font('Helvetica-Bold').fillColor('#065f46').text('EPTOMART', L, 45, { width: 200 });
  doc.fontSize(10).font('Helvetica').fillColor('#374151').text('Koyambedu Daily — Fresh from the Market', L, 72);
  doc.fontSize(9).fillColor('#6b7280')
    .text('GSTIN: Exempt (Fresh Produce)', L, 85)
    .text('Email: support@eptomart.com', L, 97);

  // Invoice details block (right)
  const invoiceTitle = declinesApproved ? 'TAX INVOICE' : 'PROFORMA INVOICE';
  doc.fontSize(18).font('Helvetica-Bold').fillColor('#065f46')
    .text(invoiceTitle, L+200, 45, { width: 305, align: 'right' });
  const invoiceNo = declinesApproved
    ? (order.invoices?.tax?.number    || `TAX-${order.orderId}`)
    : (order.invoices?.proforma?.number || `PRO-${order.orderId}`);
  doc.fontSize(9).font('Helvetica').fillColor('#374151')
    .text(`Invoice No.:`, L+200, 72, { width: 305, align: 'right', continued: false })
    .text(`${invoiceNo}`, L+200, 83, { width: 305, align: 'right' })
    .text(`Order Ref.:  ${order.orderId}`, L+200, 94, { width: 305, align: 'right' })
    .text(`Date:  ${fmtDate(order.placedAt || order.createdAt)}`, L+200, 105, { width: 305, align: 'right' });

  // Divider
  doc.moveTo(L, 120).lineTo(R, 120).strokeColor('#065f46').lineWidth(1.5).stroke();

  // ── PARTY BLOCKS ─────────────────────────────────────────
  const addr = order.shippingAddress || {};
  const bTop = 128;
  doc.fontSize(8).font('Helvetica-Bold').fillColor('#065f46').text('BILLED TO', L, bTop);
  doc.fontSize(9).font('Helvetica-Bold').fillColor('#111827').text(addr.fullName || order.buyer?.name || '—', L, bTop+12);
  doc.fontSize(8.5).font('Helvetica').fillColor('#374151');
  const addrParts = [addr.addressLine1 || addr.address, addr.addressLine2, addr.city, addr.state, addr.pincode].filter(Boolean);
  doc.text(addrParts.join(', '), L, bTop+24, { width: 220 });
  doc.text(`Phone: ${addr.phone || order.buyer?.phone || '—'}`, L, doc.y + 2);
  if (order.buyer?.email) doc.text(`Email: ${order.buyer.email}`, L, doc.y + 2);

  // Right block — delivery & payment
  doc.fontSize(8).font('Helvetica-Bold').fillColor('#065f46').text('DELIVERY DETAILS', L+265, bTop, { width: 240 });
  const delivFields = [
    order.deliveryDate ? ['Delivery Date', fmtDate(order.deliveryDate)] : null,
    order.deliverySlot ? ['Slot', order.deliverySlot] : null,
    ['Payment', (order.paymentMethod || 'Online').toUpperCase()],
    ['Status', (order.orderStatus || '').replace(/_/g, ' ').toUpperCase()],
  ].filter(Boolean);
  let dY = bTop + 12;
  delivFields.forEach(([label, val]) => {
    doc.fontSize(8.5).font('Helvetica-Bold').fillColor('#374151').text(`${label}:`, L+265, dY, { width: 80, continued: true });
    doc.font('Helvetica').text(`  ${val}`, { width: 160 });
    dY += 13;
  });

  // Thin separator
  const secTop = Math.max(doc.y, dY) + 14;
  doc.moveTo(L, secTop).lineTo(R, secTop).strokeColor('#e5e7eb').lineWidth(0.5).stroke();

  // ── ITEMS TABLE HEADER ────────────────────────────────────
  const tHdr = secTop + 8;
  const ROW_H = 18;
  doc.rect(L, tHdr, W, ROW_H).fill('#065f46');
  doc.fontSize(8).font('Helvetica-Bold').fillColor('#ffffff');
  doc.text('S.No', C.sno, tHdr+5, { width: CW.sno, align: 'center' });
  doc.text('Description / Grade', C.desc, tHdr+5, { width: CW.desc });
  doc.text('Qty', C.qty, tHdr+5, { width: CW.qty, align: 'right' });
  doc.text('Unit', C.unit, tHdr+5, { width: CW.unit, align: 'center' });
  doc.text('Rate', C.rate, tHdr+5, { width: CW.rate, align: 'right' });
  doc.text('Amount', C.amt, tHdr+5, { width: CW.amt, align: 'right' });

  // ── ITEMS ROWS ────────────────────────────────────────────
  let rowY = tHdr + ROW_H;
  let subtotal = 0;
  const billedItems   = [];
  const declinedItems = [];

  (order.items || []).forEach(item => {
    const isDeclined = item.itemStatus === 'declined';
    const price = r2(item.finalPrice || item.orderedPrice || 0);
    const billQty = isDeclined ? 0
      : r2(item.confirmedQty != null && item.itemStatus !== 'pending'
          ? item.confirmedQty : (item.quantity || 0));
    if (isDeclined) declinedItems.push({ ...item, price });
    else { billedItems.push({ ...item, price, billQty }); subtotal += r2(price * billQty); }
  });

  billedItems.forEach((item, idx) => {
    const lineAmt = r2(item.price * item.billQty);
    const rH = item.gradeKey ? 26 : ROW_H;
    const fill = idx % 2 === 0 ? '#f9fafb' : '#ffffff';
    doc.rect(L, rowY, W, rH).fill(fill);
    const yMid = rowY + (item.gradeKey ? 5 : 5);

    doc.fontSize(8).font('Helvetica').fillColor('#6b7280')
      .text(String(idx + 1), C.sno, yMid, { width: CW.sno, align: 'center' });
    doc.fontSize(8.5).font('Helvetica-Bold').fillColor('#111827')
      .text(item.name, C.desc, yMid, { width: CW.desc });
    if (item.gradeKey) {
      const gradeLabel = item.gradeName || item.gradeKey;
      doc.fontSize(7.5).font('Helvetica-Oblique').fillColor('#6b7280')
        .text(`Grade: ${gradeLabel}`, C.desc, yMid + 12, { width: CW.desc });
    }
    doc.fontSize(8.5).font('Helvetica').fillColor('#111827')
      .text(String(item.billQty), C.qty, yMid, { width: CW.qty, align: 'right' })
      .text(item.unit || '', C.unit, yMid, { width: CW.unit, align: 'center' })
      .text(fmtAmt(item.price), C.rate, yMid, { width: CW.rate, align: 'right' })
      .text(fmtAmt(lineAmt), C.amt, yMid, { width: CW.amt, align: 'right' });
    rowY += rH;
  });

  // Bottom border of items table
  doc.rect(L, tHdr, W, rowY - tHdr).stroke('#e5e7eb').lineWidth(0.5);

  // ── DECLINED ITEMS (if any, after approval) ───────────────
  if (declinedItems.length > 0) {
    rowY += 10;
    doc.fontSize(8).font('Helvetica-Bold').fillColor('#dc2626')
      .text('ITEMS DECLINED / NOT DELIVERED', L, rowY);
    rowY += 12;
    doc.rect(L, rowY, W, ROW_H).fill('#fef2f2');
    doc.fontSize(7.5).font('Helvetica-Bold').fillColor('#dc2626');
    doc.text('S.No', C.sno, rowY+5, { width: CW.sno, align: 'center' });
    doc.text('Product / Grade', C.desc, rowY+5, { width: CW.desc });
    doc.text('Ordered Qty', C.qty, rowY+5, { width: CW.qty, align: 'right' });
    doc.text('Unit', C.unit, rowY+5, { width: CW.unit, align: 'center' });
    doc.text('Rate', C.rate, rowY+5, { width: CW.rate, align: 'right' });
    doc.text('Refund', C.amt, rowY+5, { width: CW.amt, align: 'right' });
    rowY += ROW_H;
    declinedItems.forEach((item, idx) => {
      const decQty = r2(item.declinedQty || item.orderedQty || item.quantity || 0);
      doc.rect(L, rowY, W, ROW_H).fill(idx % 2 === 0 ? '#fff5f5' : '#ffffff');
      doc.fontSize(8).font('Helvetica').fillColor('#374151')
        .text(String(idx + 1), C.sno, rowY+5, { width: CW.sno, align: 'center' });
      doc.font('Helvetica-Bold').fillColor('#dc2626')
        .text((() => { const gl = item.gradeName || item.gradeKey; return (gl && !item.name.includes(gl)) ? `${item.name} (${gl})` : item.name; })(), C.desc, rowY+5, { width: CW.desc });
      doc.font('Helvetica').fillColor('#374151')
        .text(String(decQty), C.qty, rowY+5, { width: CW.qty, align: 'right' })
        .text(item.unit || '', C.unit, rowY+5, { width: CW.unit, align: 'center' })
        .text(fmtAmt(item.price), C.rate, rowY+5, { width: CW.rate, align: 'right' })
        .text(fmtAmt(r2(item.price * decQty)), C.amt, rowY+5, { width: CW.amt, align: 'right' });
      rowY += ROW_H;
    });
    doc.rect(L, rowY - declinedItems.length * ROW_H - ROW_H, W, declinedItems.length * ROW_H + ROW_H).stroke('#fca5a5').lineWidth(0.5);
  }

  // ── TOTALS SECTION ────────────────────────────────────────
  rowY += 16;
  const pricing = order.pricing || {};
  const calc    = order.calculatedPricing || {};
  const hasCalc = !!(calc.lastCalculatedAt || calc.finalPayableAmount);
  const declinedRefund   = r2(calc.declinedRefundAmount || 0);
  const walletAdj        = r2(calc.walletAdjustment || pricing.walletAdjustment || 0);
  // Price revision wallet credits/debits (from daily price changes post-order)
  const priceRevCredit   = r2(order.dailyPriceRevision?.totalCreditToWallet || 0);
  const priceRevDebit    = r2(order.dailyPriceRevision?.totalDebitFromWallet || 0);
  // Procurement price revision (from admin-generated procurement invoice)
  const procCredit       = r2(order.procurementPricing?.totalWalletCredit || 0);
  const procDebit        = r2(order.procurementPricing?.totalWalletDue || 0);

  // Right-side totals box
  const boxX  = L + 220;
  const boxW  = W - 220;
  const lblW  = 170;
  const valW  = boxW - lblW - 12;
  const valX  = boxX + lblW;

  const drawTotalRow = (label, value, opts = {}) => {
    const rh = opts.rh || 15;
    if (opts.bg) doc.rect(boxX, rowY, boxW, rh).fill(opts.bg);
    doc.fontSize(opts.bold ? 9.5 : 8.5)
      .font(opts.bold ? 'Helvetica-Bold' : 'Helvetica')
      .fillColor(opts.color || '#374151')
      .text(label, boxX + 6, rowY + (rh - (opts.bold ? 9.5 : 8.5)) / 2, { width: lblW });
    doc.fontSize(opts.bold ? 9.5 : 8.5)
      .font(opts.bold ? 'Helvetica-Bold' : 'Helvetica')
      .fillColor(opts.valColor || opts.color || '#374151')
      .text(value, valX, rowY + (rh - (opts.bold ? 9.5 : 8.5)) / 2, { width: valW, align: 'right' });
    rowY += rh;
  };

  // Section label
  doc.fontSize(8).font('Helvetica-Bold').fillColor('#6b7280').text('PRICE SUMMARY', L, rowY);
  rowY += 12;

  drawTotalRow('Items Subtotal', fmtAmt(subtotal));
  const delivFee = r2(calc.deliveryCharge || pricing.deliveryCharge || pricing.deliveryFee || 0);
  if (delivFee > 0) drawTotalRow('Delivery Charge', fmtAmt(delivFee));
  const platFee = r2(calc.platformFee || pricing.platformFee || 0);
  if (platFee > 0) drawTotalRow('Platform Fee', fmtAmt(platFee));
  const packFee = r2(calc.packingLogisticsFee || pricing.packingLogisticsFee || 0);
  if (packFee > 0) drawTotalRow('Packing & Logistics', fmtAmt(packFee));
  const coupon = r2(calc.couponDiscount || pricing.discount || 0);
  if (coupon > 0) drawTotalRow('Coupon Discount (−)', `− ${fmtAmt(coupon)}`, { color: '#16a34a' });

  // Wallet adjustment (applied at checkout)
  if (walletAdj > 0) {
    drawTotalRow('Wallet Credit Applied (−)', `− ${fmtAmt(walletAdj)}`, { color: '#16a34a', bg: '#f0fdf4' });
  } else if (walletAdj < 0) {
    drawTotalRow('Wallet Debt Recovered (+)', `+ ${fmtAmt(Math.abs(walletAdj))}`, { color: '#dc2626', bg: '#fff7ed' });
  }

  // Daily price revision adjustments
  if (priceRevCredit > 0) {
    drawTotalRow('Price Revision Credit (−)', `− ${fmtAmt(priceRevCredit)}`, { color: '#16a34a', bg: '#f0fdf4' });
  }
  if (priceRevDebit > 0) {
    drawTotalRow('Price Revision Debit (+)', `+ ${fmtAmt(priceRevDebit)}`, { color: '#dc2626', bg: '#fff7ed' });
  }

  // Procurement price adjustments (shown after procurement invoice is generated)
  if (procCredit > 0) {
    drawTotalRow('Procurement Credit (−)', `− ${fmtAmt(procCredit)}`, { color: '#16a34a', bg: '#f0fdf4' });
  }
  if (procDebit > 0) {
    drawTotalRow('Procurement Debit (+)', `+ ${fmtAmt(procDebit)}`, { color: '#dc2626', bg: '#fff7ed' });
  }

  // GST line
  drawTotalRow('GST / Tax', 'NIL (Exempt)', { color: '#6b7280' });

  // Grand total
  rowY += 2;
  const grandTotal = hasCalc && calc.finalPayableAmount > 0 ? calc.finalPayableAmount : (pricing.total || subtotal);
  drawTotalRow('TOTAL AMOUNT PAYABLE', fmtAmt(r2(grandTotal)),
    { bold: true, color: '#ffffff', valColor: '#ffffff', bg: '#065f46', rh: 22 });

  // Declined refund note
  if (declinedRefund > 0) {
    rowY += 6;
    doc.rect(L, rowY, W, 24).fill('#fff7ed');
    doc.fontSize(8).font('Helvetica').fillColor('#92400e')
      .text(`Note: ${fmtAmt(declinedRefund)} for declined/reduced items has been credited to your Eptomart Wallet and is not charged above.`,
        L + 8, rowY + 7, { width: W - 16 });
    rowY += 24;
  }

  // ── PAYMENT CONFIRMATION ──────────────────────────────────
  rowY += 10;
  doc.fontSize(8).font('Helvetica-Bold').fillColor('#374151')
    .text('PAYMENT STATUS:', L, rowY);
  doc.fontSize(8).font('Helvetica').fillColor('#16a34a')
    .text(`  PAID via ${(order.paymentMethod || 'Online').toUpperCase()}`, L + 85, rowY);

  // ── FOOTER ───────────────────────────────────────────────
  const footerY = 795;
  doc.moveTo(L, footerY - 8).lineTo(R, footerY - 8).strokeColor('#e5e7eb').lineWidth(0.5).stroke();
  doc.fontSize(7.5).font('Helvetica').fillColor('#9ca3af')
    .text('Fresh vegetables and fruits are exempt from GST under Indian GST law (Chapter 7 & 8, Notification 2/2017-CT(Rate)).',
      L, footerY, { width: W, align: 'center' })
    .text('This is a computer-generated document and does not require a signature. | eptomart.com',
      L, footerY + 11, { width: W, align: 'center' });

  doc.end();
};

// ══════════════════════════════════════════════
// NOTIFICATION HELPERS — WhatsApp via Twilio WABA
// ══════════════════════════════════════════════

/** Send WhatsApp notification to buyer (fire-and-forget) */
const _kbdNotify = (phone, event, params = []) => {
  if (!phone) return;
  const tpl = process.env.META_WHATSAPP_STATUS_TEMPLATE;
  if (!tpl) return;
  sendTemplateWhatsApp(phone, tpl, [
    { type: 'body', parameters: params.map(t => ({ type: 'text', text: String(t) })) },
  ]).catch(() => {});
};

const _getBuyerPhone = (order) => {
  return order.buyer?.phone || order.shippingAddress?.phone || null;
};

const _notifyBuyerItemDeclined = (order, item, refundAmount) => {
  _kbdNotify(_getBuyerPhone(order), 'item_declined', [
    order.orderId, item.name, `₹${refundAmount.toFixed(2)}`,
  ]);
};

const _notifyBuyerRefundProcessed = (order, amount, method) => {
  _kbdNotify(_getBuyerPhone(order), 'refund_processed', [
    order.orderId, `₹${amount.toFixed(2)}`, method,
  ]);
};

const _notifyBuyerOrderApproved = (order) => {
  _kbdNotify(_getBuyerPhone(order), 'order_confirmed', [order.orderId]);
};

const _notifyBuyerQtyReduced = (order, item, oldQty, newQty) => {
  _kbdNotify(_getBuyerPhone(order), 'qty_reduced', [
    order.orderId, item.name, `${oldQty}`, `${newQty}`, item.unit,
  ]);
};

// ══════════════════════════════════════════════
// SELLER ADMIN — Item-level review actions
// ══════════════════════════════════════════════

/**
 * PATCH /seller-admin/orders/:orderId/items/:itemId/confirm
 * SA confirms an item (marks it as confirmed at full orderedQty)
 */
/**
 * If every item is confirmed at its ORIGINAL quantity (no declines, no
 * reductions), the order confirms immediately — Super Admin approval is
 * only needed when something changed.
 */
const _maybeAutoConfirm = (order) => {
  const items = order.items || [];
  const allClean = items.length > 0 && items.every(it =>
    it.itemStatus === 'confirmed' &&
    (it.declinedQty || 0) === 0 &&
    Number(it.confirmedQty) === Number(it.orderedQty || it.quantity || 0));
  if (!allClean) return false;
  if (!['placed', 'pending_confirmation'].includes(order.orderStatus)) return false;

  order.orderStatus = 'confirmed';
  order.confirmedAt = new Date();
  if (order.saReview) {
    order.saReview.status = 'approved';
    order.saReview.pendingRefundAmount = 0;
    order.saReview.refundMethod = 'none';
  }
  order.adminApproval = {
    status: 'approved', approvedAt: new Date(),
    notes: 'Auto-confirmed — order confirmed in full by Seller Admin, no changes to original order',
  };
  order.invoices = order.invoices || {};
  order.invoices.confirmation = { number: `CONF-${order.orderId}`, generatedAt: new Date(), isAvailable: true };
  order.timeline.push({
    event: 'admin_approved',
    description: 'Order confirmed in full — all items available at ordered quantities',
    actor: { role: 'system' },
    timestamp: new Date(),
  });
  return true;
};

const sellerAdminConfirmItem = async (req, res) => {
  try {
    const sa = req.kbdSellerAdmin;
    const sellerIds = (await KoyambeduSeller.find({ createdBySellerAdmin: sa._id }).select('_id').lean()).map(s => s._id);

    const order = await KoyambeduOrder.findOne({ _id: req.params.orderId, 'items.seller': { $in: sellerIds } });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found or not yours' });

    const item = order.items.id(req.params.itemId);
    if (!item) return res.status(404).json({ success: false, message: 'Item not found' });
    if (!sellerIds.some(id => String(id) === String(item.seller))) {
      return res.status(403).json({ success: false, message: 'This item does not belong to your sellers' });
    }

    item.itemStatus   = 'confirmed';
    item.confirmedQty = item.orderedQty || item.quantity || 0;
    item.declinedQty  = 0;
    item.actionedBy   = sa._id;
    item.actionedAt   = new Date();

    await applyPriceRevision(order, { triggeredBy: 'confirm_item', actorId: req.user._id });
    applyCalculation(order);
    order.timeline.push({ event: 'item_confirmed', description: `${item.name} confirmed by Seller Admin`, actor: { role: 'seller_admin', userId: req.user._id }, timestamp: new Date() });

    const autoConfirmed = _maybeAutoConfirm(order);
    await order.save();
    if (autoConfirmed) _notifyBuyerOrderApproved(order);
    res.json({ success: true, order, autoConfirmed });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * PATCH /seller-admin/orders/:orderId/items/:itemId/decline
 * SA fully declines an item (marks unavailable)
 * Refund amount is shown but NOT yet processed — waits for Super Admin approval
 */
const sellerAdminDeclineItem = async (req, res) => {
  try {
    const sa = req.kbdSellerAdmin;
    const { reason = 'unavailable' } = req.body;
    const sellerIds = (await KoyambeduSeller.find({ createdBySellerAdmin: sa._id }).select('_id').lean()).map(s => s._id);

    const order = await KoyambeduOrder.findOne({ _id: req.params.orderId, 'items.seller': { $in: sellerIds } });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found or not yours' });

    const item = order.items.id(req.params.itemId);
    if (!item) return res.status(404).json({ success: false, message: 'Item not found' });
    if (!sellerIds.some(id => String(id) === String(item.seller))) {
      return res.status(403).json({ success: false, message: 'This item does not belong to your sellers' });
    }
    if (item.itemStatus === 'declined') {
      return res.status(400).json({ success: false, message: 'Item is already declined' });
    }

    await applyPriceRevision(order, { triggeredBy: 'decline_item', actorId: req.user._id });

    // Use finalPrice (revised price) so declined refund nets out with any prior
    // price-revision wallet credits/debits.
    const price        = item.finalPrice || item.orderedPrice || 0;
    const orderedQty   = item.orderedQty || item.quantity || 0;
    const refundAmount = price * orderedQty;

    item.itemStatus     = 'declined';
    item.confirmedQty   = 0;
    item.declinedQty    = orderedQty;
    item.declinedReason = reason;
    item.actionedBy     = sa._id;
    item.actionedAt     = new Date();

    applyCalculation(order);
    order.timeline.push({ event: 'item_declined', description: `${item.name} declined by Seller Admin — pending Super Admin approval`, actor: { role: 'seller_admin', userId: req.user._id }, timestamp: new Date(), meta: { reason, refundAmount, pendingApproval: true } });

    await order.save();

    res.json({
      success:        true,
      message:        `${item.name} declined. Refund of ₹${refundAmount.toFixed(2)} will be processed after Super Admin approval.`,
      refundAmount,
      calculatedPricing: order.calculatedPricing,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * PATCH /seller-admin/orders/:orderId/items/:itemId/reduce-qty
 * SA partially confirms an item (e.g., ordered 5kg, only 3kg available)
 */
const sellerAdminReduceItemQty = async (req, res) => {
  try {
    const sa = req.kbdSellerAdmin;
    const { confirmedQty, reason = 'partial stock available' } = req.body;
    const newQty = Number(confirmedQty);
    if (isNaN(newQty) || newQty < 0) {
      return res.status(400).json({ success: false, message: 'confirmedQty must be a non-negative number' });
    }

    const sellerIds = (await KoyambeduSeller.find({ createdBySellerAdmin: sa._id }).select('_id').lean()).map(s => s._id);
    const order = await KoyambeduOrder.findOne({ _id: req.params.orderId, 'items.seller': { $in: sellerIds } });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found or not yours' });

    const item = order.items.id(req.params.itemId);
    if (!item) return res.status(404).json({ success: false, message: 'Item not found' });
    if (!sellerIds.some(id => String(id) === String(item.seller))) {
      return res.status(403).json({ success: false, message: 'This item does not belong to your sellers' });
    }

    const orderedQty = item.orderedQty || item.quantity || 0;
    if (newQty > orderedQty) {
      return res.status(400).json({ success: false, message: `Confirmed quantity (${newQty}) cannot exceed ordered quantity (${orderedQty})` });
    }

    const oldQty = item.confirmedQty || orderedQty;

    if (newQty === 0) {
      // Full decline
      item.itemStatus   = 'declined';
      item.confirmedQty = 0;
      item.declinedQty  = orderedQty;
    } else if (newQty === orderedQty) {
      item.itemStatus   = 'confirmed';
      item.confirmedQty = newQty;
      item.declinedQty  = 0;
    } else {
      item.itemStatus   = 'partial';
      item.confirmedQty = newQty;
      item.declinedQty  = orderedQty - newQty;
    }

    item.declinedReason = reason;
    item.actionedBy     = sa._id;
    item.actionedAt     = new Date();

    await applyPriceRevision(order, { triggeredBy: 'reduce_qty', actorId: req.user._id });

    const price        = item.finalPrice || item.orderedPrice || 0;
    const refundAmount = price * item.declinedQty;

    applyCalculation(order);
    order.timeline.push({ event: 'qty_reduced', description: `${item.name}: qty reduced from ${oldQty} to ${newQty} ${item.unit} by Seller Admin`, actor: { role: 'seller_admin', userId: req.user._id }, timestamp: new Date(), meta: { oldQty, newQty, refundAmount, pendingApproval: true } });
    order.auditLog.push({ action: 'qty_reduced', actorRole: 'seller_admin', actorId: req.user._id, timestamp: new Date(), previousValue: { confirmedQty: oldQty }, newValue: { confirmedQty: newQty }, amount: refundAmount });

    // Notify buyer
    if (oldQty !== newQty) _notifyBuyerQtyReduced(order, item, oldQty, newQty);

    await order.save();

    res.json({
      success:        true,
      message:        `Qty updated: ${item.name} → ${newQty} ${item.unit} confirmed, ${item.declinedQty} ${item.unit} declined`,
      refundAmount,
      calculatedPricing: order.calculatedPricing,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * POST /seller-admin/orders/:orderId/submit-review
 * SA submits all item changes for Super Admin approval.
 * After this, SA cannot make further changes.
 */
/**
 * POST /seller-admin/orders/:orderId/confirm-all
 * Confirms every pending item of this SA's sellers at the ordered
 * quantity. If the whole order ends up clean, it auto-confirms.
 */
const sellerAdminConfirmAllItems = async (req, res) => {
  try {
    const sa = req.kbdSellerAdmin;
    const sellerIds = (await KoyambeduSeller.find({ createdBySellerAdmin: sa._id }).select('_id').lean()).map(s => s._id);

    const order = await KoyambeduOrder.findOne({ _id: req.params.orderId, 'items.seller': { $in: sellerIds } });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found or not yours' });
    if (!['placed', 'pending_confirmation'].includes(order.orderStatus)) {
      return res.status(400).json({ success: false, message: 'Order is past the review stage' });
    }

    let confirmed = 0;
    for (const item of order.items) {
      if (!sellerIds.some(id => String(id) === String(item.seller))) continue;
      if (item.itemStatus !== 'pending') continue;
      item.itemStatus   = 'confirmed';
      item.confirmedQty = item.orderedQty || item.quantity || 0;
      item.declinedQty  = 0;
      item.actionedBy   = sa._id;
      item.actionedAt   = new Date();
      confirmed++;
    }
    if (!confirmed) return res.status(400).json({ success: false, message: 'No pending items to confirm' });

    await applyPriceRevision(order, { triggeredBy: 'confirm_all', actorId: req.user._id });
    applyCalculation(order);
    order.timeline.push({
      event: 'item_confirmed',
      description: `${confirmed} item(s) confirmed by Seller Admin (Confirm All)`,
      actor: { role: 'seller_admin', userId: req.user._id }, timestamp: new Date(),
    });

    const autoConfirmed = _maybeAutoConfirm(order);
    await order.save();
    if (autoConfirmed) _notifyBuyerOrderApproved(order);
    res.json({
      success: true, confirmed, autoConfirmed,
      message: autoConfirmed
        ? `All items confirmed — order ${order.orderId} is CONFIRMED (no approval needed).`
        : `${confirmed} item(s) confirmed.`,
      order: { _id: order._id, orderStatus: order.orderStatus },
    });
  } catch (err) {
    console.error('sellerAdminConfirmAllItems:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

const sellerAdminSubmitForApproval = async (req, res) => {
  try {
    const sa = req.kbdSellerAdmin;
    const { notes } = req.body;
    const sellerIds = (await KoyambeduSeller.find({ createdBySellerAdmin: sa._id }).select('_id').lean()).map(s => s._id);

    const order = await KoyambeduOrder.findOne({ _id: req.params.orderId, 'items.seller': { $in: sellerIds } });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found or not yours' });

    if (order.saReview?.status === 'submitted') {
      return res.status(400).json({ success: false, message: 'Review already submitted and awaiting Super Admin approval' });
    }

    // Finalize: any items still 'pending' are auto-confirmed at full qty
    for (const item of order.items) {
      if (item.itemStatus === 'pending') {
        item.itemStatus   = 'confirmed';
        item.confirmedQty = item.orderedQty || item.quantity || 0;
        item.declinedQty  = 0;
        item.actionedBy   = sa._id;
        item.actionedAt   = new Date();
      }
    }

    await applyPriceRevision(order, { triggeredBy: 'submit_for_approval', actorId: req.user._id });
    applyCalculation(order);

    const pendingRefund = order.calculatedPricing?.declinedRefundAmount || 0;
    const refundMethod  = pendingRefund > 0
      ? (order.paymentMethod === 'cod' ? 'cod_deduction' : 'wallet')
      : 'none';

    order.orderStatus = 'sa_review_submitted';
    order.saReview = {
      status:              'submitted',
      reviewedBy:          sa._id,
      reviewedAt:          new Date(),
      submittedAt:         new Date(),
      notes:               notes || '',
      pendingRefundAmount: pendingRefund,
      refundMethod,
    };

    order.timeline.push({
      event:       'sa_review_submitted',
      description: `Seller Admin submitted review. Pending refund: ₹${pendingRefund.toFixed(2)}. Awaiting Super Admin approval.`,
      actor:       { role: 'seller_admin', userId: req.user._id, name: sa.name || '' },
      timestamp:   new Date(),
      meta:        { pendingRefundAmount: pendingRefund, refundMethod },
    });

    await order.save();

    res.json({
      success:           true,
      message:           `Review submitted. Super Admin will approve and process refund of ₹${pendingRefund.toFixed(2)}.`,
      pendingRefundAmount: pendingRefund,
      refundMethod,
      calculatedPricing:   order.calculatedPricing,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ══════════════════════════════════════════════
// SUPER ADMIN — Order approval & refund flow
// ══════════════════════════════════════════════

/**
 * GET /admin/orders/pending-approval
 * List orders in sa_review_submitted status awaiting Super Admin action
 */
const adminGetPendingApprovalOrders = async (req, res) => {
  try {
    const { page = 1, limit = 30 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);
    const [orders, total] = await Promise.all([
      KoyambeduOrder.find({ orderStatus: 'sa_review_submitted' })
        .populate('buyer', 'name phone email')
        .populate('items.seller', 'businessName stallNumber')
        .sort({ 'saReview.submittedAt': 1 })
        .skip(skip).limit(Number(limit)).lean(),
      KoyambeduOrder.countDocuments({ orderStatus: 'sa_review_submitted' }),
    ]);
    const shaped = orders.map(o => {
      const declined = (o.items || []).filter(it => ['declined', 'partial'].includes(it.itemStatus));
      return {
        ...o,
        reviewSummary: {
          pendingRefundAmount: o.saReview?.pendingRefundAmount || o.calculatedPricing?.declinedRefundAmount || 0,
          declinedItems: declined.map(it => ({
            name: it.name, unit: it.unit,
            orderedQty: it.orderedQty || it.quantity,
            declinedQty: it.itemStatus === 'declined' ? (it.orderedQty || it.quantity) : it.declinedQty,
            refundAmount: (it.itemStatus === 'declined' ? (it.orderedQty || it.quantity || 0) : (it.declinedQty || 0)) * (it.orderedPrice || it.finalPrice || 0),
            reason: it.declinedReason || 'unavailable',
          })),
        },
      };
    });
    res.json({ success: true, orders: shaped, total });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * PATCH /admin/orders/:orderId/approve-review
 * Super Admin approves or rejects the SA's review.
 * On approval: recalculate, generate confirmation document, process refund, set confirmed.
 * Body: { action: 'approve'|'reject', notes: String }
 */
const adminApproveOrderReview = async (req, res) => {
  try {
    const { action, notes } = req.body;
    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ success: false, message: "action must be 'approve' or 'reject'" });
    }

    const order = await KoyambeduOrder.findById(req.params.orderId)
      .populate('buyer', 'name phone email');
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    if (order.orderStatus !== 'sa_review_submitted') {
      return res.status(400).json({ success: false, message: 'Order is not pending review approval' });
    }

    if (action === 'reject') {
      // Send back to SA for revision
      order.orderStatus = 'pending_confirmation';
      order.saReview.status = 'rejected';
      order.adminApproval = { status: 'rejected', approvedBy: req.user._id, approvedAt: new Date(), notes };
      order.timeline.push({ event: 'review_rejected', description: `Super Admin rejected SA review — sent back for revision. Notes: ${notes || 'none'}`, actor: { role: 'super_admin', userId: req.user._id }, timestamp: new Date() });
      await order.save();
      return res.json({ success: true, message: 'Review rejected and sent back to Seller Admin for revision' });
    }

    // ── APPROVE ──────────────────────────────────
    // Run price revision first — ensure final prices are current before
    // calculating declined refund and confirmed items total.
    await applyPriceRevision(order, { triggeredBy: 'approve_review', actorId: req.user._id });
    applyCalculation(order);
    const calc            = order.calculatedPricing;
    const refundAmount    = calc.declinedRefundAmount || 0;
    const refundMethod    = order.saReview?.refundMethod || (refundAmount > 0 ? (order.paymentMethod === 'cod' ? 'cod_deduction' : 'wallet') : 'none');

    // Update order status
    order.orderStatus = 'confirmed';
    order.confirmedAt = new Date();
    order.adminApproval = { status: 'approved', approvedBy: req.user._id, approvedAt: new Date(), notes };
    order.saReview.status = 'approved';

    // Generate confirmation document metadata
    order.invoices.confirmation = {
      number:      `CONF-${order.orderId}`,
      generatedAt: new Date(),
      isAvailable: true,
    };

    order.timeline.push({
      event:       'admin_approved',
      description: `Super Admin approved order review. Confirmed items total: ₹${calc.confirmedItemsTotal.toFixed(2)}. Declined refund: ₹${refundAmount.toFixed(2)} via ${refundMethod}.`,
      actor:       { role: 'super_admin', userId: req.user._id },
      timestamp:   new Date(),
      meta:        { refundAmount, refundMethod, confirmedItemsTotal: calc.confirmedItemsTotal },
    });
    order.auditLog.push({
      action:       'order_approved',
      actorRole:    'super_admin',
      actorId:      req.user._id,
      timestamp:    new Date(),
      amount:       refundAmount,
      refundMethod,
    });

    await order.save();

    // ── Process refund ────────────────────────────
    // COD is NOT refunded — the declined amount is simply deducted from
    // the payable on delivery. Only online payments get a wallet credit.
    if (refundAmount > 0) {
      if (refundMethod === 'wallet' && order.paymentMethod !== 'cod') {
        setImmediate(async () => {
          try {
            let wallet = await KoyambeduWallet.findOne({ user: order.buyer?._id || order.buyer });
            if (!wallet) wallet = await KoyambeduWallet.create({ user: order.buyer?._id || order.buyer });
            await wallet.credit(refundAmount, 'item_declined', {
              orderId:  order.orderId,
              orderRef: order._id,
              reason:   `Refund for declined items on order ${order.orderId}`,
            });
            // Update audit log
            order.auditLog.push({ action: 'refund_credited_wallet', actorRole: 'system', timestamp: new Date(), amount: refundAmount });
            await order.save();
          } catch(e) { console.error('Wallet refund failed', e); }
        });
        _notifyBuyerRefundProcessed(order, refundAmount, 'wallet');
      } else if (refundMethod === 'cod_deduction' || order.paymentMethod === 'cod') {
        order.auditLog.push({ action: 'cod_deduction_applied', actorRole: 'system', timestamp: new Date(), amount: refundAmount, notes: 'COD — declined amount deducted from payable, no refund issued' });
        setImmediate(() => order.save().catch(() => {}));
      }
    }

    _notifyBuyerOrderApproved(order);

    res.json({
      success: true,
      message: `Order confirmed. ${refundAmount > 0 ? `₹${refundAmount.toFixed(2)} refund initiated via ${refundMethod}.` : ''}`,
      calculatedPricing: calc,
      order: { _id: order._id, orderId: order.orderId, orderStatus: order.orderStatus },
    });
  } catch (err) {
    console.error('adminApproveOrderReview:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * PATCH /admin/orders/:orderId/cancel
 * ONLY Super Admin can cancel. Processes full or partial refund.
 * Body: { reason: String, refundMethod: 'wallet'|'razorpay' }
 */
const adminCancelOrder = async (req, res) => {
  try {
    const { reason, refundMethod = 'wallet' } = req.body;
    if (!reason?.trim()) {
      return res.status(400).json({ success: false, message: 'Cancellation reason is required' });
    }

    const order = await KoyambeduOrder.findById(req.params.orderId)
      .populate('buyer', 'name phone email');
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    if (['delivered', 'cancelled'].includes(order.orderStatus)) {
      return res.status(400).json({ success: false, message: 'Order cannot be cancelled at this stage' });
    }

    // Refund = subtotal + delivery charge − coupon discount (platform fee NON-refundable).
    // This single credit covers both cash paid and wallet adjustment applied at checkout —
    // no separate wallet-adj reversal needed.
    const refundAmt = parseFloat((
      (order.pricing?.subtotal       || 0) +
      (order.pricing?.deliveryCharge || 0) -
      (order.pricing?.discount       || 0)
    ).toFixed(2));
    const isPaid    = order.paymentStatus === 'paid';

    order.orderStatus  = 'cancelled';
    order.cancelReason = reason;

    // Record refund on the order so the customer's My Orders reflects it
    order.refund = isPaid && refundAmt > 0
      ? { status: 'initiated', amount: refundAmt, reason, initiatedAt: new Date() }
      : { status: 'not_applicable', amount: 0, reason };

    order.timeline.push({
      event:       'order_cancelled',
      description: `Order cancelled by Super Admin. Reason: ${reason}` +
        (isPaid && refundAmt > 0 ? ` Refund of ₹${refundAmt.toFixed(2)} (excl. platform fee) credited to wallet.` : ''),
      actor:       { role: 'super_admin', userId: req.user._id },
      timestamp:   new Date(),
      meta:        { refundAmount: refundAmt, refundMethod: 'wallet' },
    });
    order.auditLog.push({ action: 'order_cancelled', actorRole: 'super_admin', actorId: req.user._id, timestamp: new Date(), amount: refundAmt, refundMethod: 'wallet', notes: reason });

    await order.save();

    // ── Always wallet refund (platform fee excluded) ──────────────────────────
    // Covers both cash paid (Razorpay/COD) and wallet adjustment from checkout.
    const buyerRef = order.buyer?._id || order.buyer;
    if (isPaid && refundAmt > 0) {
      setImmediate(async () => {
        try {
          let wallet = await KoyambeduWallet.findOne({ user: buyerRef });
          if (!wallet) wallet = await KoyambeduWallet.create({ user: buyerRef });
          await wallet.credit(refundAmt, 'order_cancelled', {
            orderId:  order.orderId,
            orderRef: order._id,
            reason:   `Order ${order.orderId} cancelled — refund (platform fee excluded)`,
          });
          order.refund.status = 'completed';
          order.paymentStatus = 'refunded';
          order.auditLog.push({ action: 'refund_credited_wallet', actorRole: 'system', timestamp: new Date(), amount: refundAmt, refundMethod: 'wallet' });
          await order.save();
        } catch(e) { console.error('[KBD] SA cancel wallet refund failed:', e.message); }
      });
    }

    _kbdNotify(_getBuyerPhone(order), 'order_cancelled', [order.orderId, reason]);

    res.json({ success: true, message: `Order ${order.orderId} cancelled. Refund of ₹${refundAmt.toFixed(2)} (excl. platform fee) credited to wallet.` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * PATCH /seller-admin/orders/:orderId/items/:itemId/available
 * After Super Admin sends a review back, the Seller Admin (having
 * arranged the item) can mark it AVAILABLE again: the decline is
 * withdrawn, the original quantity is restored, and the pending
 * refund for that item is cancelled.
 */
const sellerAdminMarkItemAvailable = async (req, res) => {
  try {
    const sa = req.kbdSellerAdmin;
    const sellerIds = (await KoyambeduSeller.find({ createdBySellerAdmin: sa._id }).select('_id').lean()).map(s => s._id);

    const order = await KoyambeduOrder.findOne({ _id: req.params.orderId, 'items.seller': { $in: sellerIds } });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found or not yours' });

    if (!['placed', 'pending_confirmation', 'sa_review_submitted'].includes(order.orderStatus)) {
      return res.status(400).json({ success: false, message: 'Order is past the review stage' });
    }

    const item = order.items.id(req.params.itemId);
    if (!item) return res.status(404).json({ success: false, message: 'Item not found' });
    if (!sellerIds.some(id => String(id) === String(item.seller))) {
      return res.status(403).json({ success: false, message: 'This item does not belong to your sellers' });
    }
    if (!['declined', 'partial'].includes(item.itemStatus)) {
      return res.status(400).json({ success: false, message: 'Item is not declined or reduced' });
    }

    const orderedQty  = item.orderedQty || item.quantity || 0;
    const price       = item.orderedPrice || item.finalPrice || 0;
    const withdrawn   = (item.declinedQty || 0) * price;
    const prevStatus  = item.itemStatus;

    // Restore the ORIGINAL order for this item — refund is withdrawn
    item.itemStatus     = 'confirmed';
    item.confirmedQty   = orderedQty;
    item.quantity       = orderedQty;
    item.declinedQty    = 0;
    item.declinedReason = undefined;
    item.actionedBy     = sa._id;
    item.actionedAt     = new Date();

    applyCalculation(order);
    // If review was previously submitted/rejected, it needs re-submission
    if (order.saReview) {
      order.saReview.pendingRefundAmount = order.calculatedPricing?.declinedRefundAmount || 0;
    }

    order.timeline.push({
      event:       'item_restored',
      description: `${item.name} arranged and available — original quantity (${orderedQty} ${item.unit || ''}) confirmed, refund withdrawn`,
      actor:       { role: 'seller_admin', userId: req.user._id },
      timestamp:   new Date(),
      meta:        { withdrawnRefund: withdrawn, previousItemStatus: prevStatus },
    });
    order.auditLog.push({
      action: 'item_restored', actorRole: 'seller_admin', actorId: req.user._id,
      timestamp: new Date(), previousValue: prevStatus, newValue: 'confirmed', amount: withdrawn,
      notes: 'Item arranged — decline withdrawn, original order confirmed',
    });

    await order.save();
    res.json({
      success: true,
      message: `${item.name} marked available — refund of ₹${withdrawn.toFixed(2)} withdrawn.`,
      calculatedPricing: order.calculatedPricing,
    });
  } catch (err) {
    console.error('sellerAdminMarkItemAvailable:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * POST /orders/:orderId/delivery-ack  (customer)
 * Body: { status: 'all_received' }
 *     | { status: 'partial_issue', issues: [{ name, missingQty, note }] }
 *     | { status: 'not_received' }
 * all_received  → order closes everywhere.
 * partial_issue → items + missing quantities recorded, alert raised.
 * not_received  → immediate alert to Seller Admin + Super Admin.
 */
const submitDeliveryAck = async (req, res) => {
  try {
    const { status, issues = [] } = req.body;
    if (!['all_received', 'partial_issue', 'not_received'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid acknowledgement status' });
    }

    const order = await KoyambeduOrder.findOne({ _id: req.params.orderId, buyer: req.user._id });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    if (order.orderStatus !== 'delivered') {
      return res.status(400).json({ success: false, message: 'Order is not delivered yet' });
    }
    if (order.deliveryAck?.status && order.deliveryAck.status !== 'none') {
      return res.status(400).json({ success: false, message: 'Delivery already acknowledged' });
    }

    order.deliveryAck = { status, submittedAt: new Date(), issues: [], alert: { active: false } };

    if (status === 'all_received') {
      order.orderStatus   = 'closed';
      order.closeComments = 'Customer confirmed all items received';
      order.timeline.push({
        event: 'delivery_acknowledged',
        description: 'Customer confirmed all items received — order closed',
        actor: { role: 'customer', userId: req.user._id },
        timestamp: new Date(),
      });
      order.auditLog.push({ action: 'delivery_ack_all_received', actorRole: 'customer', actorId: req.user._id, timestamp: new Date(), newValue: 'closed' });
    }

    if (status === 'partial_issue') {
      order.orderStatus = 'reported';
      const clean = (issues || [])
        .filter(i => i && i.name && Number(i.missingQty) > 0)
        .map(i => ({ name: String(i.name), unit: i.unit || '', missingQty: Number(i.missingQty), note: i.note || '' }));
      if (!clean.length) {
        return res.status(400).json({ success: false, message: 'Enter the missing quantity for at least one item' });
      }
      order.deliveryAck.issues = clean;
      order.deliveryAck.alert  = { active: true, type: 'partial_issue', raisedAt: new Date() };
      order.timeline.push({
        event: 'delivery_issue_reported',
        description: `Customer reported missing/damaged items: ${clean.map(i => `${i.name} (${i.missingQty}${i.unit ? ' ' + i.unit : ''})`).join(', ')}`,
        actor: { role: 'customer', userId: req.user._id },
        timestamp: new Date(),
      });
      order.auditLog.push({ action: 'delivery_ack_partial_issue', actorRole: 'customer', actorId: req.user._id, timestamp: new Date(), newValue: clean });
    }

    if (status === 'not_received') {
      order.orderStatus = 'reported';
      order.deliveryAck.alert = { active: true, type: 'not_received', raisedAt: new Date() };
      order.timeline.push({
        event: 'delivery_issue_reported',
        description: 'Customer reported: order NOT received',
        actor: { role: 'customer', userId: req.user._id },
        timestamp: new Date(),
      });
      order.auditLog.push({ action: 'delivery_ack_not_received', actorRole: 'customer', actorId: req.user._id, timestamp: new Date() });
    }

    await order.save();

    // ── Immediate alerts: WhatsApp + in-app push to the order's
    //    Seller Admins and EVERY Super Admin ──
    if (status !== 'all_received') {
      setImmediate(async () => {
        try {
          const { sendMetaWhatsApp } = require('../utils/sendWhatsApp');
          const { notifyUser } = require('../utils/pushNotification');
          const label = status === 'not_received' ? 'ORDER NOT RECEIVED' : 'PARTIAL/DAMAGED DELIVERY';
          const detail = status === 'partial_issue'
            ? order.deliveryAck.issues.map(i => `${i.name}: ${i.missingQty}${i.unit ? ' ' + i.unit : ''} missing`).join(', ')
            : 'Customer says the order was not delivered.';
          const msg = `🚨 ${label}\nOrder: ${order.orderId}\n${detail}\nPlease check the Alerts section.`;
          const push = {
            title: `🚨 ${label} — ${order.orderId}`,
            body:  detail,
            tag:   `kbd-alert-${order.orderId}`,
          };

          // Every Super Admin: WhatsApp (registered phone) + in-app push
          const superAdmins = await User.find({ role: 'superAdmin' }).select('phone').lean();
          for (const sa of superAdmins) {
            if (sa.phone) sendMetaWhatsApp(sa.phone, msg).catch(() => {});
            notifyUser(sa._id, { ...push, url: '/admin/koyambedu' }).catch(() => {});
          }
          // Fallback / additional configured alert phone
          if (process.env.ADMIN_WHATSAPP_PHONE) {
            sendMetaWhatsApp(process.env.ADMIN_WHATSAPP_PHONE, msg).catch(() => {});
          }

          // Seller Admins whose sellers are on this order: WhatsApp + push
          const sellerIds = [...new Set((order.items || []).map(it => String(it.seller)).filter(Boolean))];
          const sellers   = await KoyambeduSeller.find({ _id: { $in: sellerIds } }).select('createdBySellerAdmin').lean();
          const saIds     = [...new Set(sellers.map(x => String(x.createdBySellerAdmin)).filter(Boolean))];
          const sas       = await KoyambeduSellerAdmin.find({ _id: { $in: saIds } }).select('contactPhone user').lean();
          for (const sa of sas) {
            if (sa.contactPhone) sendMetaWhatsApp(sa.contactPhone, msg).catch(() => {});
            if (sa.user) notifyUser(sa.user, { ...push, url: '/koyambedu/seller-admin/orders' }).catch(() => {});
          }
        } catch (e) { console.error('delivery-ack alert failed', e); }
      });
    }

    res.json({
      success: true,
      message: status === 'all_received'
        ? 'Thank you! Order closed.'
        : 'Reported — our team has been alerted and will contact you shortly.',
      orderStatus: order.orderStatus,
      deliveryAck: order.deliveryAck,
    });
  } catch (err) {
    console.error('submitDeliveryAck:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * POST /orders/:orderId/delivery-ack/close  (customer)
 * After the Super Admin resolves a reported delivery issue, the customer
 * acknowledges the resolution and the order is closed.
 */
const confirmResolutionAndClose = async (req, res) => {
  try {
    const order = await KoyambeduOrder.findOne({ _id: req.params.orderId, buyer: req.user._id });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    if (order.orderStatus === 'closed') {
      return res.status(400).json({ success: false, message: 'Order is already closed' });
    }
    const ack = order.deliveryAck;
    if (!ack || !['partial_issue', 'not_received'].includes(ack.status)) {
      return res.status(400).json({ success: false, message: 'No delivery issue on this order' });
    }
    if (ack.alert?.active || !ack.alert?.resolvedAt) {
      return res.status(400).json({ success: false, message: 'The issue is still being worked on — you can close once it is resolved' });
    }

    order.orderStatus   = 'closed';
    order.closeComments = `Customer accepted the resolution and closed the order. Resolution: ${ack.alert.resolution || '-'}`;
    order.deliveryAck.resolutionAccepted   = true;
    order.deliveryAck.resolutionAcceptedAt = new Date();
    order.timeline.push({
      event: 'delivery_acknowledged',
      description: 'Customer accepted the resolution — order closed',
      actor: { role: 'customer', userId: req.user._id },
      timestamp: new Date(),
    });
    order.auditLog.push({ action: 'resolution_accepted_closed', actorRole: 'customer', actorId: req.user._id, timestamp: new Date(), newValue: 'closed' });
    await order.save();
    res.json({ success: true, message: 'Thank you! Order closed.', orderStatus: 'closed' });
  } catch (err) {
    console.error('confirmResolutionAndClose:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * GET /seller-admin/alerts — active delivery alerts for this SA's sellers
 */
const sellerAdminGetAlerts = async (req, res) => {
  try {
    const sa = req.kbdSellerAdmin;
    const sellerIds = (await KoyambeduSeller.find({ createdBySellerAdmin: sa._id }).select('_id').lean()).map(x => x._id);
    const orders = await KoyambeduOrder.find({
      'deliveryAck.alert.active': true,
      'items.seller': { $in: sellerIds },
    })
      .select('orderId orderStatus deliveryAck deliveryDate deliverySlot pricing.total createdAt')
      .sort({ 'deliveryAck.alert.raisedAt': -1 })
      .limit(100)
      .lean();
    res.json({ success: true, alerts: orders });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * GET /admin/alerts — all active delivery alerts (admin/super admin)
 */
const adminGetAlerts = async (req, res) => {
  try {
    const orders = await KoyambeduOrder.find({ 'deliveryAck.alert.active': true })
      .populate('buyer', 'name phone')
      .select('orderId orderStatus deliveryAck deliveryDate deliverySlot pricing.total buyer createdAt')
      .sort({ 'deliveryAck.alert.raisedAt': -1 })
      .limit(200)
      .lean();
    res.json({ success: true, alerts: orders });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * PATCH /admin/orders/:orderId/alerts/resolve — Super Admin resolves an alert
 */
const adminResolveAlert = async (req, res) => {
  try {
    const { resolution } = req.body;
    if (!resolution?.trim()) return res.status(400).json({ success: false, message: 'Resolution note is required' });
    const order = await KoyambeduOrder.findById(req.params.orderId);
    if (!order || !order.deliveryAck?.alert?.active) {
      return res.status(404).json({ success: false, message: 'Active alert not found' });
    }
    order.deliveryAck.alert.active     = false;
    order.deliveryAck.alert.resolvedAt = new Date();
    order.deliveryAck.alert.resolvedBy = req.user._id;
    order.deliveryAck.alert.resolution = resolution.trim();
    order.timeline.push({
      event: 'delivery_issue_resolved',
      description: `Your delivery issue has been resolved: ${resolution.trim()}`,
      actor: { role: 'super_admin', userId: req.user._id },
      timestamp: new Date(),
    });
    order.auditLog.push({ action: 'delivery_alert_resolved', actorRole: 'super_admin', actorId: req.user._id, timestamp: new Date(), notes: resolution.trim() });
    await order.save();

    // Tell the customer and ask them to confirm & close the order
    setImmediate(() => {
      try {
        const { sendMetaWhatsApp } = require('../utils/sendWhatsApp');
        const phone = _getBuyerPhone(order);
        if (phone) {
          sendMetaWhatsApp(phone,
            `✅ Your delivery issue for order ${order.orderId} has been resolved:\n${resolution.trim()}\n\nPlease open the order in My Orders to confirm and close it.`).catch(() => {});
        }
      } catch (e) { /* non-critical */ }
    });

    res.json({ success: true, message: 'Alert resolved — customer notified and asked to confirm & close' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * PATCH /admin/orders/:orderId/close
 * Super Admin manually closes an order (e.g. after compensating the
 * customer for missing items with an offer). Comments are REQUIRED.
 */
const adminCloseOrder = async (req, res) => {
  try {
    const { comments } = req.body;
    if (!comments?.trim() || comments.trim().length < 5) {
      return res.status(400).json({ success: false, message: 'Closing comments are required (min 5 characters)' });
    }
    const order = await KoyambeduOrder.findById(req.params.orderId);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    if (['cancelled', 'closed'].includes(order.orderStatus)) {
      return res.status(400).json({ success: false, message: `Order is already ${order.orderStatus}` });
    }

    const prevStatus = order.orderStatus;
    order.orderStatus   = 'closed';
    order.closeComments = comments.trim();
    order.timeline.push({
      event: 'order_closed',
      description: `Order closed by Super Admin. ${comments.trim()}`,
      actor: { role: 'super_admin', userId: req.user._id },
      timestamp: new Date(),
    });
    order.auditLog.push({
      action: 'order_closed', actorRole: 'super_admin', actorId: req.user._id,
      timestamp: new Date(), previousValue: prevStatus, newValue: 'closed', notes: comments.trim(),
    });
    await order.save();
    res.json({ success: true, message: `Order ${order.orderId} closed.` });
  } catch (err) {
    console.error('adminCloseOrder:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * GET /orders/:orderId/timeline — buyer can see their own order timeline
 */
const getOrderTimeline = async (req, res) => {
  try {
    const query = req.user.role === 'user'
      ? { _id: req.params.orderId, buyer: req.user._id }
      : { _id: req.params.orderId };
    const order = await KoyambeduOrder.findOne(query).select('orderId timeline calculatedPricing orderStatus').lean();
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    res.json({ success: true, timeline: order.timeline || [], orderStatus: order.orderStatus, calculatedPricing: order.calculatedPricing });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * GET /orders/:orderId/calculation — unified pricing for all roles
 */
const getOrderCalculation = async (req, res) => {
  try {
    const query = req.user.role === 'user'
      ? { _id: req.params.orderId, buyer: req.user._id }
      : { _id: req.params.orderId };
    const order = await KoyambeduOrder.findOne(query)
      .populate('buyer', 'name')
      .lean();
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    // Always recompute live (don't rely on stale cached value)
    const calc = calculateOrderTotals(order);

    // Mask admin costs from customer
    const isSuperAdmin = ['admin', 'superAdmin'].includes(req.user.role);
    const adminCosts   = isSuperAdmin ? order.adminCosts : undefined;

    res.json({ success: true, calculatedPricing: calc, adminCosts });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * PATCH /admin/orders/:orderId/delivered — mark delivered + generate tax invoice
 */
const adminMarkDelivered = async (req, res) => {
  try {
    const { deliveryPartner, adminNotes } = req.body;
    const order = await KoyambeduOrder.findById(req.params.orderId)
      .populate('buyer', 'name phone email');
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    if (!['confirmed', 'packing', 'dispatched'].includes(order.orderStatus)) {
      return res.status(400).json({ success: false, message: 'Order must be confirmed/packing/dispatched to mark delivered' });
    }

    order.orderStatus = 'delivered';
    order.deliveredAt = new Date();
    if (deliveryPartner) order.deliveryPartner = deliveryPartner;
    if (adminNotes)      order.adminNotes = adminNotes;

    applyCalculation(order);

    // Generate tax invoice
    order.invoices.tax = {
      number:      `TAX-${order.orderId}`,
      generatedAt: new Date(),
      isAvailable: true,
    };

    order.timeline.push({
      event:       'delivered',
      description: 'Order delivered successfully. Final Tax Invoice generated.',
      actor:       { role: 'super_admin', userId: req.user._id },
      timestamp:   new Date(),
    });

    await order.save();

    _kbdNotify(_getBuyerPhone(order), 'order_delivered', [order.orderId]);

    res.json({ success: true, message: 'Order marked delivered. Tax invoice generated.', order: { _id: order._id, orderId: order.orderId, orderStatus: order.orderStatus } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// expose helpers for routes
exports._calcFinalPrice       = calcFinalPrice;
exports._getProcurementCycle  = getProcurementCycle;
exports._generateProductCode  = generateProductCode;
exports._DELIVERY_SLOTS       = DELIVERY_SLOTS;

// ══════════════════════════════════════════════
// ── Manual price revision trigger (Super Admin) ───────────────────────────────
// POST /api/koyambedu/admin/orders/:orderId/apply-price-revision
// Lets a Super Admin manually trigger a price revision for a single order.
// Useful when prices changed mid-day and the admin wants to apply the adjustment
// immediately rather than waiting for the next automated trigger.
const adminApplyPriceRevision = async (req, res) => {
  try {
    const order = await KoyambeduOrder.findById(req.params.orderId)
      .populate('buyer', 'name phone email');
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    const result = await applyPriceRevision(order, {
      triggeredBy: 'manual',
      actorId:     req.user._id,
    });

    if (result.revised) {
      await order.save();
      return res.json({
        success:         true,
        revised:         true,
        message:         `Price revision applied. ${result.changes.length} item(s) updated.`,
        changes:         result.changes,
        totalCredit:     result.totalCredit,
        totalDebit:      result.totalDebit,
        netWalletChange: result.netWalletChange,
        calculatedPricing: order.calculatedPricing,
      });
    }

    res.json({ success: true, revised: false, reason: result.reason });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * GET /api/koyambedu/products/by-category?limit=8
 * Returns active products grouped by category — for the home page market layout.
 */
const getProductsByCategory = async (req, res) => {
  try {
    const perCat = Math.min(Number(req.query.limit) || 8, 20);
    const base = {
      isActive: true, isAvailable: true,
      $or: [{ approvalStatus: 'approved' }, { approvalStatus: { $exists: false } }],
    };

    const products = await KoyambeduProduct.find(base)
      .populate('category', 'name nameTamil icon slug sortOrder')
      .populate('seller', 'businessName')
      .sort({ totalOrders: -1, priceUpdatedAt: -1, createdAt: -1 })
      .lean();

    const enriched = products.map(p => ({
      ...p,
      lowestUnitPrice: p.gradesEnabled && p.grades?.length > 0
        ? getLowestUnitPriceAcrossGrades(p.grades)
        : getLowestUnitPrice(p.variants || []),
    }));

    // Group by category, cap at perCat each
    const map = new Map();
    for (const p of enriched) {
      if (!p.category) continue;
      const id = String(p.category._id);
      if (!map.has(id)) map.set(id, { category: p.category, products: [] });
      if (map.get(id).products.length < perCat) map.get(id).products.push(p);
    }

    const sections = [...map.values()]
      .filter(s => s.products.length > 0)
      .sort((a, b) => (a.category.sortOrder ?? 99) - (b.category.sortOrder ?? 99));

    res.json({ success: true, sections });
  } catch (err) {
    res.json({ success: true, sections: [] });
  }
};

// ══════════════════════════════════════════════
// SUPER ADMIN — "Users Cart" tab
// GET /koyambedu/admin/carts
// Lists every customer's IN-PROGRESS cart (items added, order not yet
// placed) so the superadmin can see what's sitting in carts and follow up.
// Read-only — does not touch cart/order data or business logic.
// ══════════════════════════════════════════════
const adminGetUserCarts = async (req, res) => {
  try {
    const { search } = req.query;

    const carts = await KoyambeduCart.find({ 'items.0': { $exists: true } })
      .populate('user', 'name email phone')
      .populate('items.product', 'name unit')
      .sort({ updatedAt: -1 })
      .lean();

    let result = carts
      .filter(c => c.user) // skip carts whose user was deleted
      .map(c => {
        const items = (c.items || []).filter(it => (it.quantity || 0) > 0);
        const cartValue = items.reduce((s, it) => s + (it.unitPrice || 0) * (it.quantity || 0), 0);
        return {
          _id:          c._id,
          customerName: c.user?.name || 'Unknown',
          phone:        c.user?.phone || '—',
          email:        c.user?.email || '—',
          itemCount:    items.length,
          cartValue:    Math.round(cartValue * 100) / 100,
          updatedAt:    c.updatedAt,
          items: items.map(it => ({
            name:         it.product?.name || it.name,
            gradeName:    it.gradeName || null,
            quantity:     it.quantity,
            unit:         it.product?.unit || it.unit,
            unitPrice:    it.unitPrice,
            deliveryType: it.deliveryType,
          })),
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
    console.error('[adminGetUserCarts] error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to fetch user carts' });
  }
};

// ══════════════════════════════════════════════
// SUPER ADMIN — Procurement Report (confirmed orders only)
// GET /koyambedu/admin/reports/procurement-confirmed?date=2026-06-22&gradeKey=
// Aggregates products/quantities needed from CONFIRMED_REPORT_STATUSES orders
// for the given cutoffCycle date, merged with any saved purchase-checklist
// state (purchased flag + comment) for that same date/product.
// ══════════════════════════════════════════════
const adminProcurementReport = async (req, res) => {
  try {
    const { date, gradeKey } = req.query;
    const cycle = date || getProcurementCycle();

    const orders = await KoyambeduOrder.find({
      cutoffCycle: cycle,
      orderStatus: { $in: CONFIRMED_REPORT_STATUSES },
    }).populate({
      path: 'items.product',
      select: 'name unit category',
      populate: { path: 'category', select: 'name icon' },
    }).lean();

    const summary = {};
    for (const order of orders) {
      for (const item of order.items || []) {
        if (item.itemStatus === 'declined') continue;
        if (gradeKey && gradeKey !== 'all' && item.gradeKey !== gradeKey) continue;

        const productKey = item.gradeKey
          ? `${item.product?._id?.toString() || item.name}__${item.gradeKey}`
          : (item.product?._id?.toString() || item.name);

        if (!summary[productKey]) {
          summary[productKey] = {
            productKey,
            productName:  item.name,
            gradeKey:     item.gradeKey || null,
            gradeName:    item.gradeName || null,
            unit:         item.unit || item.unitLabel || 'kg',
            category:     item.product?.category?.name || 'Other',
            categoryIcon: item.product?.category?.icon || '🌿',
            totalQty:     0,
            totalValue:   0,
            orderCount:   0,
            orderMap:     {}, // orderId (human-readable) -> quantity — per-order breakdown
          };
        }
        summary[productKey].totalQty   += item.quantity || 0;
        summary[productKey].totalValue += (item.finalPrice || item.orderedPrice || 0) * (item.quantity || 0);
        summary[productKey].orderCount += 1;
        summary[productKey].orderMap[order.orderId] = (summary[productKey].orderMap[order.orderId] || 0) + (item.quantity || 0);
      }
    }

    const rows = Object.values(summary)
      .map(r => {
        const { orderMap, ...rest } = r;
        return {
          ...rest,
          // Per-order breakdown, e.g. Radish 10kg = Order A 3kg + Order B 4kg + Order C 3kg
          orders: Object.entries(orderMap)
            .map(([orderId, quantity]) => ({ orderId, quantity }))
            .sort((a, b) => a.orderId.localeCompare(b.orderId)),
        };
      })
      .sort((a, b) => a.productName.localeCompare(b.productName));

    // Merge in saved checklist state for this cycle
    const keys = rows.map(r => r.productKey);
    const checklist = keys.length
      ? await KoyambeduProcurementChecklist.find({ cycle, productKey: { $in: keys } }).lean()
      : [];
    const checklistMap = Object.fromEntries(checklist.map(c => [c.productKey, c]));

    const products = rows.map(r => {
      const c = checklistMap[r.productKey];
      return {
        ...r,
        purchased:       c?.purchased || false,
        purchasedByName: c?.purchasedByName || null,
        purchasedAt:     c?.purchasedAt || null,
        comment:         c?.comment || '',
        commentByName:   c?.commentByName || null,
        commentAt:       c?.commentAt || null,
        packingNote:       c?.packingNote || '',
        packingNoteByName: c?.packingNoteByName || null,
        packingNoteAt:     c?.packingNoteAt || null,
      };
    });

    const shareLog = await KoyambeduProcurementShare.findOne({ cycle }).lean();

    res.json({
      success: true,
      cycle,
      orderCount: orders.length,
      purchasedCount: products.filter(p => p.purchased).length,
      totalCount: products.length,
      products,
      shareStatus: shareLog ? {
        shared:        true,
        shareCount:    shareLog.shareCount,
        lastSharedAt:  shareLog.lastSharedAt,
        lastSharedByName: shareLog.lastSharedByName,
        lastSharedVia: shareLog.lastSharedVia,
      } : { shared: false },
    });
  } catch (err) {
    console.error('[adminProcurementReport] error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to fetch procurement report' });
  }
};

// PATCH /koyambedu/admin/reports/procurement-confirmed/item
// Body: { cycle, productKey, productName?, gradeKey?, gradeName?, purchased?, comment?, packingNote? }
// Upserts the checklist entry for one product line. `purchased`, `comment`,
// and `packingNote` are independent — sending only one leaves the others untouched.
const adminUpdateProcurementItem = async (req, res) => {
  try {
    const { cycle, productKey, productName, gradeKey, gradeName, purchased, comment, packingNote } = req.body;
    if (!cycle || !productKey) {
      return res.status(400).json({ success: false, message: 'cycle and productKey are required' });
    }

    const update = { cycle, productKey };
    if (productName !== undefined) update.productName = productName;
    if (gradeKey !== undefined)    update.gradeKey    = gradeKey || null;
    if (gradeName !== undefined)   update.gradeName   = gradeName || null;

    if (purchased !== undefined) {
      update.purchased       = !!purchased;
      update.purchasedBy     = req.user._id;
      update.purchasedByName = req.user.name || req.user.email;
      update.purchasedAt     = new Date();
    }
    if (comment !== undefined) {
      update.comment       = String(comment).slice(0, 1000);
      update.commentBy     = req.user._id;
      update.commentByName = req.user.name || req.user.email;
      update.commentAt     = new Date();
    }
    if (packingNote !== undefined) {
      update.packingNote       = String(packingNote).slice(0, 500);
      update.packingNoteBy     = req.user._id;
      update.packingNoteByName = req.user.name || req.user.email;
      update.packingNoteAt     = new Date();
    }

    const doc = await KoyambeduProcurementChecklist.findOneAndUpdate(
      { cycle, productKey },
      update,
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.json({ success: true, item: doc });
  } catch (err) {
    console.error('[adminUpdateProcurementItem] error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to update procurement item' });
  }
};

// POST /koyambedu/admin/reports/procurement-confirmed/share
// Body: { cycle, via? } — marks the supplier-facing list for this cycle as
// shared (increments a counter, records who/when/how). Does not block or
// gate anything — purely so the admin sees "already shared" if they come
// back to this date later. Does not touch order/pricing/customer data.
const adminShareProcurement = async (req, res) => {
  try {
    const { cycle, via } = req.body;
    if (!cycle) return res.status(400).json({ success: false, message: 'cycle is required' });

    const doc = await KoyambeduProcurementShare.findOneAndUpdate(
      { cycle },
      {
        $inc: { shareCount: 1 },
        lastSharedAt:     new Date(),
        lastSharedBy:     req.user._id,
        lastSharedByName: req.user.name || req.user.email,
        lastSharedVia:    via || 'copy',
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.json({ success: true, shareStatus: {
      shared: true,
      shareCount: doc.shareCount,
      lastSharedAt: doc.lastSharedAt,
      lastSharedByName: doc.lastSharedByName,
      lastSharedVia: doc.lastSharedVia,
    }});
  } catch (err) {
    console.error('[adminShareProcurement] error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to record share' });
  }
};

// ══════════════════════════════════════════════
// SUPER ADMIN — Koyambedu Daily Offer Push Notifications
// Lets Super Admin compose a promo/offer and push it as a mobile web-push
// notification (Android + iOS PWA installs) to a targeted audience —
// mirroring the segmented-offer pattern used by Zomato/Swiggy — instead of
// only the existing site-wide "broadcast to everyone" admin tool.
// Purely additive: reuses the existing PushSubscription/web-push pipeline
// (utils/pushNotification.js) — does not touch it beyond adding
// `notifyAudience`, and does not change the existing /admin/notifications
// site-wide broadcast route at all.
// ══════════════════════════════════════════════

/**
 * Resolve the list of buyer user IDs matching a segment + optional area filter.
 * Returns `null` for 'all_subscribers', which signals "use notifyAll (every
 * push subscriber site-wide)" rather than a Koyambedu-order-derived list.
 */
const resolveKoyambeduAudienceIds = async (segment, areaFilter) => {
  if (segment === 'all_subscribers') return null;

  const match = {};
  const area = (areaFilter || '').trim();
  if (area) {
    match.$or = [
      { 'buyerLocation.areaName': { $regex: area, $options: 'i' } },
      { 'buyerLocation.city':     { $regex: area, $options: 'i' } },
      { 'buyerLocation.pincode':  area },
      { 'shippingAddress.pincode': area },
    ];
  }

  if (segment === 'active') {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    return KoyambeduOrder.distinct('buyer', { ...match, orderTimestamp: { $gte: cutoff } });
  }

  if (segment === 'lapsed') {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [allBuyers, recentBuyers] = await Promise.all([
      KoyambeduOrder.distinct('buyer', match),
      KoyambeduOrder.distinct('buyer', { ...match, orderTimestamp: { $gte: cutoff } }),
    ]);
    const recentSet = new Set(recentBuyers.map(String));
    return allBuyers.filter(id => !recentSet.has(String(id)));
  }

  // default: 'all_koyambedu' — anyone who has ever ordered (matching area filter, if given)
  return KoyambeduOrder.distinct('buyer', match);
};

const SEGMENT_LABELS = {
  all_koyambedu:   'All Koyambedu Daily customers',
  active:          'Active customers (ordered in last 30 days)',
  lapsed:          'Lapsed customers (no order in 30+ days)',
  all_subscribers: 'All app users (every push subscriber)',
};

/** GET /api/koyambedu/admin/notifications/audience-count?segment=&area= */
const adminPreviewOfferAudience = async (req, res) => {
  try {
    const { segment = 'all_koyambedu', area = '' } = req.query;
    if (segment === 'all_subscribers') {
      const PushSubscription = require('../models/PushSubscription');
      const count = await PushSubscription.countDocuments({ isActive: true });
      return res.json({ success: true, segment, label: SEGMENT_LABELS[segment], audienceCount: count, subscriberCount: count });
    }
    const userIds = await resolveKoyambeduAudienceIds(segment, area);
    const PushSubscription = require('../models/PushSubscription');
    const subscriberCount = userIds.length
      ? await PushSubscription.countDocuments({ user: { $in: userIds }, isActive: true })
      : 0;
    res.json({
      success: true,
      segment,
      label: SEGMENT_LABELS[segment] || segment,
      audienceCount: userIds.length,   // matching customers
      subscriberCount,                 // of those, how many have push enabled — the actual reach
    });
  } catch (err) {
    console.error('[adminPreviewOfferAudience] error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to compute audience' });
  }
};

/** POST /api/koyambedu/admin/notifications/broadcast */
const adminBroadcastOffer = async (req, res) => {
  try {
    const { title, body, url, segment = 'all_koyambedu', areaFilter = '' } = req.body;
    if (!title?.trim() || !body?.trim()) {
      return res.status(400).json({ success: false, message: 'Title and body are required' });
    }
    if (!SEGMENT_LABELS[segment]) {
      return res.status(400).json({ success: false, message: 'Invalid audience segment' });
    }

    const payload = {
      title: title.trim(),
      body:  body.trim(),
      icon:  '/icons/icon-192x192.png',
      badge: '/icons/icon-72x72.png',
      url:   url?.trim() || '/koyambedu',
      tag:   'koyambedu-offer',
    };

    let audienceCount, result;
    if (segment === 'all_subscribers') {
      result = await notifyAll(payload);
      audienceCount = result.total;
    } else {
      const userIds = await resolveKoyambeduAudienceIds(segment, areaFilter);
      audienceCount = userIds.length;
      result = await notifyAudience(userIds, payload);
    }

    const log = await KoyambeduOfferBroadcast.create({
      title: payload.title,
      body:  payload.body,
      url:   payload.url,
      segment,
      areaFilter: (areaFilter || '').trim(),
      audienceCount,
      sentCount:   result.sent,
      failedCount: Math.max(0, (result.total || 0) - result.sent),
      sentBy:     req.user._id,
      sentByName: req.user.name || req.user.email,
    });

    res.json({
      success: true,
      message: `Offer pushed to ${result.sent} of ${result.total} subscribed device${result.total === 1 ? '' : 's'}.`,
      audienceCount,
      sentCount:   result.sent,
      totalTargeted: result.total,
      broadcastId: log._id,
    });
  } catch (err) {
    console.error('[adminBroadcastOffer] error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to send offer notification' });
  }
};

/** GET /api/koyambedu/admin/notifications/history */
const adminGetOfferBroadcasts = async (req, res) => {
  try {
    const items = await KoyambeduOfferBroadcast.find({}).sort({ createdAt: -1 }).limit(50).lean();
    res.json({ success: true, items });
  } catch (err) {
    console.error('[adminGetOfferBroadcasts] error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to load broadcast history' });
  }
};

module.exports = {
  // Public
  getCategories, getProducts, getFeaturedProducts, getHomepageProducts, getProductsByCategory, getProductDetail, getDeliverySlots,
  checkDeliveryAvailability,
  // Cart
  getCart, updateCart, clearCart,
  // Super Admin — Users Cart tab
  adminGetUserCarts,
  // Super Admin — Procurement Report (confirmed orders)
  adminProcurementReport, adminUpdateProcurementItem, adminShareProcurement,
  // Super Admin — Offer push notifications
  adminPreviewOfferAudience, adminBroadcastOffer, adminGetOfferBroadcasts,
  // Buyer orders
  placeOrder, createRazorpayOrder, verifyPayment, testPayment,
  getMyOrders, getMyOrder, cancelPendingOrder, approveRevision, cancelOrder, getOrderInvoice,
  // Seller
  sellerRegister, getSellerProfile, updateSellerProfile,
  getSellerProducts, createSellerProduct, updateSellerProduct,
  toggleProductAvailability, deleteSellerProduct,
  getSellerOrders, confirmStock, requestPriceRevision, createSellerCategory,
  // Admin — sellers
  adminDashboard, adminGetOrders, getOrdersForPrinting, markItemsPrinted, resetPackingProgress, adminGetOrderWalletHistory, adminUpdateOrderStatus, adminEditOrderItemQty, adminDeclineOrderItem,
  // Settings / last update time
  getLastProductUpdateTime,
  // Procurement invoice
  generateProcurementInvoice,
  // Wallet
  getWallet, requestWalletRefund, adminGetRefundRequests, adminUpdateRefundRequest,
  adminGetAllWallets, adminGetWalletTransactions, adminWalletManualCredit, adminWalletManualDebit,
  adminGetSellers, adminCreateSeller, adminApproveSeller, adminToggleSeller, adminEditSellerContact,
  adminGetCategories, adminCreateCategory, adminEditCategory, adminApproveCategory, adminAnalytics,
  // Admin — seller admins (SuperAdmin only)
  adminUserSearch, adminCreateSellerAdmin, adminGetSellerAdmins, adminApproveSellerAdmin,
  // SellerAdmin portal
  sellerAdminGetProfile, sellerAdminGetSellers, sellerAdminCreateSeller, sellerAdminGetOrders, sellerAdminUpdateOrderStatus,
  sellerAdminGetProducts, sellerAdminUpdateProduct, sellerAdminCreateProduct, sellerAdminToggleProduct,
  sellerAdminCreateCategory, sellerAdminGetCategories,
  sellerAdminRequestEdit,
  // SA item review
  sellerAdminConfirmItem, sellerAdminDeclineItem, sellerAdminReduceItemQty, sellerAdminSubmitForApproval,
  sellerAdminMarkItemAvailable, sellerAdminConfirmAllItems,
  // Super Admin order lifecycle
  adminGetPendingApprovalOrders, adminApproveOrderReview, adminCancelOrder, adminMarkDelivered, adminCloseOrder,
  submitDeliveryAck, confirmResolutionAndClose, sellerAdminGetAlerts, adminGetAlerts, adminResolveAlert,
  // Shared order data
  getOrderTimeline, getOrderCalculation,
  // Admin product management
  adminGetAllProducts, adminUpdateProduct, adminToggleProduct, adminBulkSetAvailability, adminCreateProduct, adminDeleteProduct,
  // Product approval workflow
  adminGetPendingProducts, adminApproveProduct, adminRejectProduct,
  adminApproveProductEdit, adminRejectProductEdit,
  // Admin seller-edit review (SuperAdmin only)
  adminReviewSellerEdit,
  // AI
  aiTranslate, aiDescribe,
  // Image upload
  uploadImage,
  // SuperAdmin wipe
  adminWipeAll,
  // F4: Daily Price Panel
  getDailyPricePanel, updateDailyPrice, bulkUpdateDailyPrice,
  // F5: Price History
  getPriceHistory, getProductPriceHistory,
  // F6: Forecast
  getForecasts, setForecastPrice, approveForecast,
  // F7-F9: Reports
  procurementReport, slotWiseReport, destinationReport,
  // F10: Dashboard stats
  dashboardStats,
  // F12: Special Requests
  submitSpecialRequest, getSpecialRequests, updateSpecialRequest,
  // Admin costs
  adminUpdateOrderCosts,
  // Partial refund
  adminPartialRefund,
  // Reports
  adminOrderReport, adminProductConsolidationReport, adminCashflowReport,
  // Manual price revision trigger
  adminApplyPriceRevision,
};

// ══════════════════════════════════════════════════════════════════
// ADMIN COST UPDATE — internal only, never shown to customer
// PATCH /admin/orders/:orderId/costs
// ══════════════════════════════════════════════════════════════════
async function adminUpdateOrderCosts(req, res) {
  try {
    const { actualDeliveryCost, miscExpenses, transportCharge, packingCharge, costNote } = req.body;
    const order = await KoyambeduOrder.findById(req.params.orderId);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    order.adminCosts = {
      actualDeliveryCost: Number(actualDeliveryCost) || 0,
      miscExpenses:       Number(miscExpenses)       || 0,
      transportCharge:    Number(transportCharge)    || 0,
      packingCharge:      Number(packingCharge)      || 0,
      costNote:           costNote || '',
      updatedAt:          new Date(),
      updatedBy:          req.user._id,
    };
    await order.save();
    res.json({ success: true, adminCosts: order.adminCosts });
  } catch (err) {
    console.error('adminUpdateOrderCosts:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ══════════════════════════════════════════════════════════════════
// ADMIN ORDER REPORT
// GET /admin/reports/order-report
// Query: deliveryDate (required), slot (optional), sellerAdmin (optional SA id)
// Returns orders grouped by seller admin
// ══════════════════════════════════════════════════════════════════
async function adminOrderReport(req, res) {
  try {
    const { deliveryDate, slot, sellerAdmin } = req.query;
    if (!deliveryDate) return res.status(400).json({ success: false, message: 'deliveryDate required' });

    // Date range for the delivery date
    const start = new Date(deliveryDate); start.setHours(0, 0, 0, 0);
    const end   = new Date(deliveryDate); end.setHours(23, 59, 59, 999);
    const filter = {
      deliveryDate: { $gte: start, $lte: end },
      orderStatus:  { $in: CONFIRMED_REPORT_STATUSES },
    };
    if (slot) filter.deliverySlot = slot;

    // Filter by seller admin if specified
    let saSellerIds = null;
    if (sellerAdmin) {
      const sellers = await KoyambeduSeller.find({ createdBySellerAdmin: sellerAdmin }).select('_id').lean();
      saSellerIds = sellers.map(s => s._id.toString());
      filter['items.seller'] = { $in: sellers.map(s => s._id) };
    }

    const orders = await KoyambeduOrder.find(filter)
      .populate('buyer', 'name email')
      .populate('items.seller', 'businessName name createdBySellerAdmin')
      .lean();

    // Get all SA info
    const allSAs = await KoyambeduSellerAdmin.find({}).select('_id name businessName').lean();
    const saMap  = Object.fromEntries(allSAs.map(sa => [sa._id.toString(), sa]));

    // Group orders by SA
    const grouped = {}; // saId → { sa, orders: [] }
    for (const order of orders) {
      // Determine which SAs are involved in this order
      const sas = new Set();
      for (const item of order.items || []) {
        const sellerId = item.seller?._id?.toString() || item.seller?.toString();
        const saId     = item.seller?.createdBySellerAdmin?.toString();
        if (saId) sas.add(saId);
      }
      // If SA filter: only include orders that have items from this SA
      const saIds = [...sas];
      const targetSAs = sellerAdmin ? saIds.filter(id => id === sellerAdmin) : saIds;

      for (const saId of targetSAs) {
        if (!grouped[saId]) grouped[saId] = { sa: saMap[saId] || { _id: saId, name: 'Unknown SA' }, orders: [] };
        // Filter items to only this SA's sellers
        const saItems = order.items.filter(it => it.seller?.createdBySellerAdmin?.toString() === saId);
        grouped[saId].orders.push({
          orderId:         order.orderId,
          orderStatus:     order.orderStatus,
          deliveryDate:    order.deliveryDate,
          deliverySlot:    order.deliverySlot,
          shippingAddress: order.shippingAddress,
          pricing:         order.pricing,
          adminCosts:      order.adminCosts,
          items: saItems.map(it => ({
            name:         it.name,
            unit:         it.unit || it.unitLabel,
            quantity:     it.quantity,
            orderedPrice: it.finalPrice || it.orderedPrice,
            lineTotal:    ((it.finalPrice || it.orderedPrice) * it.quantity),
            sellerPayout: it.sellerPayout,
          })),
          saSubtotal: saItems.reduce((s, it) => s + (it.finalPrice || it.orderedPrice) * it.quantity, 0),
        });
      }
    }

    res.json({ success: true, report: Object.values(grouped), deliveryDate, slot: slot || 'All slots' });
  } catch (err) {
    console.error('adminOrderReport:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ══════════════════════════════════════════════════════════════════
// PRODUCT CONSOLIDATION REPORT
// GET /admin/reports/product-consolidation
// Query: deliveryDate (required), slot (required), sellerAdmin (optional — null = all SAs)
// Returns: list of products with total quantity needed
// ══════════════════════════════════════════════════════════════════
async function adminProductConsolidationReport(req, res) {
  try {
    const { deliveryDate, slot, sellerAdmin } = req.query;
    if (!deliveryDate) return res.status(400).json({ success: false, message: 'deliveryDate required' });

    const start = new Date(deliveryDate); start.setHours(0, 0, 0, 0);
    const end   = new Date(deliveryDate); end.setHours(23, 59, 59, 999);
    const filter = {
      deliveryDate: { $gte: start, $lte: end },
      orderStatus:  { $in: CONFIRMED_REPORT_STATUSES },
    };
    // slot is optional — omitting it (the "All slots" option) aggregates
    // across every slot for the selected date, same as the other reports.
    if (slot) filter.deliverySlot = slot;

    let saSellerIds = null;
    let saInfo = null;
    if (sellerAdmin) {
      const sellers = await KoyambeduSeller.find({ createdBySellerAdmin: sellerAdmin }).select('_id').lean();
      saSellerIds = sellers.map(s => s._id.toString());
      filter['items.seller'] = { $in: sellers.map(s => s._id) };
      saInfo = await KoyambeduSellerAdmin.findById(sellerAdmin).select('name businessName').lean();
    }

    const orders = await KoyambeduOrder.find(filter)
      .populate('items.seller', 'createdBySellerAdmin businessName')
      .lean();

    // Aggregate products
    const productMap = {}; // productName+unit → { name, unit, totalQty, totalValue, sellerPayout }
    for (const order of orders) {
      for (const item of order.items || []) {
        if (item.itemStatus === 'declined') continue;
        // If SA filter, skip items not belonging to this SA
        if (saSellerIds) {
          const sid = item.seller?._id?.toString() || item.seller?.toString();
          if (!saSellerIds.includes(sid)) continue;
        }
        const key = `${item.name}__${item.unit || 'unit'}`;
        if (!productMap[key]) productMap[key] = { name: item.name, unit: item.unit || item.unitLabel || 'unit', totalQty: 0, totalValue: 0, totalPayout: 0, orderCount: 0 };
        productMap[key].totalQty   += item.quantity;
        productMap[key].totalValue += (item.finalPrice || item.orderedPrice) * item.quantity;
        productMap[key].totalPayout += item.sellerPayout || 0;
        productMap[key].orderCount++;
      }
    }

    const products = Object.values(productMap).sort((a, b) => b.totalQty - a.totalQty);
    res.json({
      success: true,
      sellerAdmin:  saInfo || 'All Seller Admins',
      deliveryDate,
      slot: slot || 'All slots',
      orderCount:   orders.length,
      products,
    });
  } catch (err) {
    console.error('adminProductConsolidationReport:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ══════════════════════════════════════════════════════════════════
// CASHFLOW REPORT
// GET /admin/reports/cashflow
// Query: type (date|date-slot), deliveryDate (required), slot (required if type=date-slot)
//        reportFor (received | procurement | commission | delivery-expense)
// ══════════════════════════════════════════════════════════════════
async function adminCashflowReport(req, res) {
  try {
    const { deliveryDate, slot, reportType } = req.query;
    // reportType: received | procurement | commission | delivery-expense
    if (!deliveryDate) return res.status(400).json({ success: false, message: 'deliveryDate required' });
    if (slot === undefined && ['slot'].includes(reportType)) return res.status(400).json({ success: false, message: 'slot required' });

    const start = new Date(deliveryDate); start.setHours(0, 0, 0, 0);
    const end   = new Date(deliveryDate); end.setHours(23, 59, 59, 999);
    const filter = {
      deliveryDate: { $gte: start, $lte: end },
      orderStatus:  { $in: CONFIRMED_REPORT_STATUSES },
    };
    if (slot) filter.deliverySlot = slot;

    const orders = await KoyambeduOrder.find(filter)
      .populate('items.seller', 'businessName name createdBySellerAdmin')
      .lean();

    const allSAs = await KoyambeduSellerAdmin.find({}).select('_id name businessName').lean();
    const saMap  = Object.fromEntries(allSAs.map(sa => [sa._id.toString(), sa]));

    // Build per-SA buckets
    const saBuckets = {}; // saId → { sa, procurementCost, saCommission, eptomartCommission, orderCount }
    let totalReceived = 0, totalProcurement = 0, totalSaCommission = 0, totalEptomartCommission = 0, totalDeliveryCollected = 0, totalActualDelivery = 0, totalMisc = 0, totalPlatformFee = 0;

    for (const order of orders) {
      const recv = order.pricing?.total || 0;
      totalReceived += recv;
      totalDeliveryCollected += order.pricing?.deliveryCharge || 0;
      totalPlatformFee += order.pricing?.platformFee || 0;
      totalActualDelivery += order.adminCosts?.actualDeliveryCost || 0;
      totalMisc += order.adminCosts?.miscExpenses || 0;

      for (const item of order.items || []) {
        if (item.itemStatus === 'declined') continue;
        const saId = item.seller?.createdBySellerAdmin?.toString();
        if (!saId) continue;
        if (!saBuckets[saId]) saBuckets[saId] = { sa: saMap[saId] || { _id: saId, name: 'Unknown SA' }, procurementCost: 0, saCommission: 0, eptomartCommission: 0, orderCount: new Set() };
        const lineTotal    = (item.finalPrice || item.orderedPrice) * item.quantity;
        const sellerPayout = item.sellerPayout || 0;
        const grossMargin  = lineTotal - sellerPayout;
        // SA commission = procurement margin (procurementChargePercent portion of margin)
        // Approximate: 15/(15+10+10) = 15/35 ≈ 43% of gross margin goes to SA
        // Eptomart gets: 20/35 ≈ 57%  (platform 10% + logistics 10% split of 35% margin)
        const SA_RATIO = 15 / 35;
        const saComm   = grossMargin * SA_RATIO;
        const epComm   = grossMargin * (1 - SA_RATIO);
        saBuckets[saId].procurementCost    += sellerPayout;
        saBuckets[saId].saCommission       += saComm;
        saBuckets[saId].eptomartCommission += epComm;
        saBuckets[saId].orderCount.add(order._id.toString());
        totalProcurement    += sellerPayout;
        totalSaCommission   += saComm;
        totalEptomartCommission += epComm;
      }
    }

    const saSummary = Object.values(saBuckets).map(b => ({
      sa:                    b.sa,
      orderCount:            b.orderCount.size,
      procurementCost:       Math.round(b.procurementCost * 100) / 100,
      saCommission:          Math.round(b.saCommission * 100) / 100,
      totalToSA:             Math.round((b.procurementCost + b.saCommission) * 100) / 100,
      eptomartCommission:    Math.round(b.eptomartCommission * 100) / 100,
    }));

    // Per-order delivery expense
    const deliveryExpenses = orders.map(o => ({
      orderId:            o.orderId,
      deliverySlot:       o.deliverySlot,
      deliveryCharge:     o.pricing?.deliveryCharge || 0,
      actualDeliveryCost: o.adminCosts?.actualDeliveryCost || 0,
      miscExpenses:       o.adminCosts?.miscExpenses || 0,
      netDeliveryProfit:  (o.pricing?.deliveryCharge || 0) - (o.adminCosts?.actualDeliveryCost || 0) - (o.adminCosts?.miscExpenses || 0),
      shippingAddress:    `${o.shippingAddress?.city || ''}, ${o.shippingAddress?.pincode || ''}`,
    }));

    res.json({
      success: true,
      deliveryDate,
      slot:              slot || 'All slots',
      summary: {
        orderCount:              orders.length,
        totalReceived:           Math.round(totalReceived * 100) / 100,
        totalProcurement:        Math.round(totalProcurement * 100) / 100,
        totalSaCommission:       Math.round(totalSaCommission * 100) / 100,
        totalEptomartCommission: Math.round(totalEptomartCommission * 100) / 100,
        totalDeliveryCollected:  Math.round(totalDeliveryCollected * 100) / 100,
        totalActualDelivery:     Math.round(totalActualDelivery * 100) / 100,
        totalMiscExpenses:       Math.round(totalMisc * 100) / 100,
        totalPlatformFee:        Math.round(totalPlatformFee * 100) / 100,
        netDeliveryProfit:       Math.round((totalDeliveryCollected - totalActualDelivery - totalMisc) * 100) / 100,
        eptomartNetProfit:       Math.round((totalEptomartCommission + totalPlatformFee + totalDeliveryCollected - totalActualDelivery - totalMisc) * 100) / 100,
      },
      saSummary,
      deliveryExpenses,
      orders: orders.map(o => ({
        orderId:        o.orderId,
        total:          o.pricing?.total,
        deliveryCharge: o.pricing?.deliveryCharge,
        platformFee:    o.pricing?.platformFee,
        deliverySlot:   o.deliverySlot,
        adminCosts:     o.adminCosts,
        paymentMethod:  o.paymentMethod,
        paymentStatus:  o.paymentStatus,
      })),
    });
  } catch (err) {
    console.error('adminCashflowReport:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}
