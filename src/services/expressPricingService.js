// ============================================
// EPTOMART EXPRESS — Pricing / Margin Engine
// Implements spec sections 2 & 3:
//   1. Distribute total shipment/logistics cost across total procurement
//      weight to get a ₹/kg logistics cost, applied to every product
//      (including bunch-based products converted to their weight
//      equivalent).
//   2. Apply the default 20/20/20 margin stack (platform, salesman,
//      packing/retail-logistics) on top of procurement + logistics cost,
//      with per-product override support for low-cost produce.
// Pure functions — no DB calls — so they're easy to unit-test and reuse
// from the controller.
// ============================================

/**
 * Compute logistics cost per kg from a list of per-store shipment costs and
 * the total procurement weight (kg) across all stores for that shipment.
 * Example from spec: (1800 + 600 + 400) / 800 = 3.5 ₹/kg
 */
function computeLogisticsCostPerKg(storeCosts = [], totalProcurementKg = 0) {
  if (!totalProcurementKg || totalProcurementKg <= 0) return 0;
  const totalCost = storeCosts.reduce((sum, s) => sum + (Number(s.cost) || 0), 0);
  return round2(totalCost / totalProcurementKg);
}

/**
 * Convert a product's sale unit + quantity into a kg-equivalent, so the
 * per-kg logistics cost can be applied uniformly even to bunch/piece-based
 * produce (spec section 2's coriander example: 10 bunches = 1kg).
 */
function toKgEquivalent(product, quantity = 1) {
  if (product.unit === 'kg') return quantity;
  if (product.unit === 'gram') return quantity / 1000;
  // bunch / piece / litre / dozen — needs an explicit conversion ratio
  if (product.unitsPerKg && product.unitsPerKg > 0) {
    return quantity / product.unitsPerKg;
  }
  // No conversion ratio configured — logistics cost can't be meaningfully
  // distributed per-kg for this product; treat as 0 additional kg-cost
  // rather than guessing.
  return 0;
}

/**
 * Full selling-price breakdown for one unit of a product at a given store.
 * Returns each stage so the admin UI (and later, the customer-facing price
 * display) can show a transparent breakdown if needed.
 */
function computeSellingPrice(product, marginConfig, quantity = 1) {
  const procurementCost = Number(product.procurementBaseCost) || 0;
  const kgEquivalent = toKgEquivalent(product, quantity);
  const logisticsCostPerUnit = quantity > 0
    ? round2((marginConfig.logisticsCostPerKg || 0) * (kgEquivalent / quantity))
    : 0;

  const baseCostPerUnit = round2(procurementCost + logisticsCostPerUnit);

  // A product-specific custom margin REPLACES the entire default charge
  // stack (platform + salesman + packing) with just this one percentage —
  // it is not layered on top of or alongside the defaults. This is for
  // low-cost produce where the full 20/20/20 stack would price the item
  // out of the market (spec section 3). When no override is set, the
  // normal platform/salesman/packing stack applies as usual.
  const hasCustomMargin = product.customMarginPct != null;
  const platformPct = hasCustomMargin ? Number(product.customMarginPct) : Number(marginConfig.platformChargePct ?? 20);
  const salesmanPct = hasCustomMargin ? 0 : Number(marginConfig.salesmanChargePct ?? 20);
  const packingPct  = hasCustomMargin ? 0 : Number(marginConfig.packingChargePct ?? 20);

  const platformCharge = round2(baseCostPerUnit * (platformPct / 100));
  const salesmanCharge = round2(baseCostPerUnit * (salesmanPct / 100));
  const packingCharge  = round2(baseCostPerUnit * (packingPct / 100));

  // The customer-facing item price is always a whole rupee amount — no
  // paise — per admin preference. Only the final price is rounded this way;
  // the cost/charge breakdown above stays at 2dp so the admin's "Preview
  // Price" panel still shows an accurate accounting trail.
  const sellingPricePerUnit = roundRupee(baseCostPerUnit + platformCharge + salesmanCharge + packingCharge);

  return {
    procurementCost,
    logisticsCostPerUnit,
    baseCostPerUnit,
    platformPct, salesmanPct, packingPct,
    platformCharge, salesmanCharge, packingCharge,
    sellingPricePerUnit,
    totalForQuantity: roundRupee(sellingPricePerUnit * quantity),
  };
}

/** Haversine distance in km between two {lat, lng} points */
function distanceKm(a, b) {
  if (!a || !b) return Infinity;
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return round2(2 * R * Math.asin(Math.sqrt(h)));
}

function toRad(deg) { return (deg * Math.PI) / 180; }
function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
// Item/order prices are always whole rupees — no paise — per admin
// preference. Used for every customer- or admin-facing price figure;
// round2 is kept separate for non-price figures like distanceKm.
function roundRupee(n) { return Math.round(Number(n) || 0); }

/**
 * Delivery fee for an order, given the customer's distance from the store
 * and their order subtotal:
 *   - within freeDeliveryRadiusKm of the store → always free.
 *   - beyond that, but subtotal >= minOrderForFreeDelivery → free.
 *   - otherwise → the flat deliveryFeeBelowMinimum fee.
 * Distance beyond maxDeliveryDistanceKm is handled separately by the caller
 * (that's a hard stop — "call us for a custom order" — not a fee tier).
 */
function computeDeliveryFee(distanceKmValue, subtotal, marginConfig) {
  const freeRadius = Number(marginConfig.freeDeliveryRadiusKm ?? 0);
  if (distanceKmValue <= freeRadius) return 0;
  const minOrder = Number(marginConfig.minOrderForFreeDelivery ?? 0);
  if (subtotal >= minOrder) return 0;
  return roundRupee(marginConfig.deliveryFeeBelowMinimum ?? 0);
}

/**
 * Estimated delivery time (minutes) for a given distance from the store,
 * using the admin-configured deliveryTimeTiers (see ExpressMarginConfig).
 * Tiers are evaluated in ascending maxDistanceKm order; the first tier the
 * distance fits within wins. A distance beyond every tier's maxDistanceKm
 * (shouldn't normally happen — that's what maxDeliveryDistanceKm is for)
 * falls back to the largest tier's etaMinutes rather than returning null.
 * Returns null only if no tiers are configured at all.
 */
function computeDeliveryEta(distanceKmValue, marginConfig) {
  const tiers = Array.isArray(marginConfig?.deliveryTimeTiers) ? marginConfig.deliveryTimeTiers : [];
  if (!tiers.length) return null;
  const sorted = [...tiers].sort((a, b) => a.maxDistanceKm - b.maxDistanceKm);
  const match = sorted.find(t => distanceKmValue <= t.maxDistanceKm);
  return (match || sorted[sorted.length - 1]).etaMinutes;
}

module.exports = {
  computeLogisticsCostPerKg,
  toKgEquivalent,
  computeSellingPrice,
  distanceKm,
  computeDeliveryFee,
  computeDeliveryEta,
  roundRupee,
};
