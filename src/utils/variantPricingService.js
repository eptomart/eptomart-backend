// ============================================================
// VARIANT PRICING SERVICE — Koyambedu Daily
// Single source of truth for automatic variant price calculation.
//
// Business rule:
//   • The user enters ONE base price — the wholesale/procurement
//     cost per unit for the HIGHEST quantity variant (e.g., 30 kg).
//   • Every smaller variant's base price is calculated automatically
//     by reducing the previous variant's price by variantDiffPercent%.
//   • Final selling price per variant = basePrice × (1 + totalCharge%)
//
// Usage:
//   const { calculateVariantPricing, getHighestVariant, getLowestUnitPrice }
//     = require('./variantPricingService');
//
//   const updatedVariants = calculateVariantPricing(product, {
//     highestBasePrice: 20,
//     variantDiffPercent: 2.5,
//   });
// ============================================================
'use strict';

/** Round to 2 decimal places */
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Given a product and the user-entered base price for its highest-qty variant,
 * calculates base prices and final selling prices for ALL variants.
 *
 * Business rule: buying MORE = cheaper per unit (wholesale bulk pricing).
 *   • highestBasePrice is the procurement rate for the LARGEST qty (cheapest tier).
 *   • Each smaller variant is MORE expensive per unit by variantDiffPercent%.
 *
 * Algorithm:
 *   1. Sort variants by fromQty descending (largest = index 0).
 *   2. Assign highestBasePrice to index 0 (cheapest per-unit rate).
 *   3. For each subsequent (smaller) variant:
 *        basePrice[i] = basePrice[i-1] × (1 + variantDiffPercent / 100)
 *   4. finalPrice[i] = Math.round(basePrice[i] × (1 + totalChargePercent / 100))
 *      → always a whole number (no decimals shown to customers)
 *
 * @param {Object} product - Mongoose doc or plain object with:
 *   .variants[]              — array with fromQty, toQty, basePrice, finalPrice
 *   .procurementChargePercent — default 15
 *   .platformChargePercent    — default 10
 *   .logisticsChargePercent   — default 10
 *
 * @param {Object} opts
 *   .highestBasePrice   {Number} — base price per unit for highest-qty (cheapest) variant
 *   .variantDiffPercent {Number} — % increase per step toward smaller (more expensive) variants
 *
 * @returns {Array} Updated variant objects with basePrice and finalPrice set,
 *                  ordered by fromQty ASC (natural storage order).
 */
function calculateVariantPricing(product, { highestBasePrice, variantDiffPercent }) {
  const variants = product.variants || [];
  if (!variants.length) return [];

  const totalChargePercent =
    (product.procurementChargePercent != null ? Number(product.procurementChargePercent) : 0) +
    (product.platformChargePercent    != null ? Number(product.platformChargePercent)    : 10) +
    (product.logisticsChargePercent   != null ? Number(product.logisticsChargePercent)   : 10);

  // Each step toward smaller qty multiplies basePrice UP (smaller qty = more expensive per unit)
  const diffMultiplier = 1 + (Number(variantDiffPercent) || 0) / 100;

  // Sort DESC: index 0 = highest-qty variant (cheapest) = entered price
  const sorted = [...variants]
    .map(v => (v.toObject ? v.toObject() : { ...v }))
    .sort((a, b) => Number(b.fromQty) - Number(a.fromQty));

  let runningBase = Number(highestBasePrice);

  const calculated = sorted.map((variant) => {
    const basePrice  = r2(runningBase);
    // Round to whole number — no paise shown to customers
    const finalPrice = Math.round(runningBase * (1 + totalChargePercent / 100));
    // Next (smaller) variant costs MORE per unit
    runningBase = runningBase * diffMultiplier;
    return { ...variant, basePrice, finalPrice };
  });

  // Return ASC (natural storage order: small qty first)
  return calculated.sort((a, b) => Number(a.fromQty) - Number(b.fromQty));
}

/**
 * Return the variant with the largest fromQty (the one whose base price is entered
 * by the user in the Daily Price Update screen).
 *
 * @param {Array} variants
 * @returns {Object|null}
 */
function getHighestVariant(variants) {
  if (!variants || !variants.length) return null;
  return variants.reduce(
    (best, v) => (!best || Number(v.fromQty) > Number(best.fromQty)) ? v : best,
    null
  );
}

/**
 * Return the lowest per-unit final selling price across all variants.
 * Used for "From ₹X/unit" display on product cards.
 *
 * @param {Array} variants
 * @returns {Number} Minimum finalPrice (0 if no variants or all zero)
 */
function getLowestUnitPrice(variants) {
  if (!variants || !variants.length) return 0;
  let min = Infinity;
  for (const v of variants) {
    const p = Number(v.finalPrice) || 0;
    if (p > 0 && p < min) min = p;
  }
  return min === Infinity ? 0 : min;
}

/**
 * Preview only — compute what the variant prices WOULD be without saving.
 * Returns the same shape as calculateVariantPricing but with per-unit and
 * per-package display values included.
 *
 * @param {Object} product  - same as calculateVariantPricing
 * @param {Object} opts     - same as calculateVariantPricing
 * @returns {Array} Variants with { fromQty, toQty, unit, basePrice, finalPrice, totalForLowestPkg }
 */
function previewVariantPricing(product, opts) {
  const updated = calculateVariantPricing(product, opts);
  return updated.map(v => ({
    ...v,
    // Total price if a customer buys exactly fromQty units (minimum of this tier)
    totalForLowestPkg: r2(Number(v.fromQty) * Number(v.finalPrice)),
  }));
}

// ── Grade-level helpers ───────────────────────────────────────────────────────

/**
 * Calculate variant pricing for a single grade.
 * Works identically to calculateVariantPricing but uses grade.variants
 * and grade.variantDiffPercent instead of product-level equivalents.
 *
 * @param {Object} product      - product doc (for charge percents)
 * @param {Object} grade        - grade object { variants, variantDiffPercent, ... }
 * @param {Object} opts
 *   .highestBasePrice {Number}
 *   .variantDiffPercent {Number} optional override; falls back to grade.variantDiffPercent
 * @returns {Array} Updated variant objects for this grade
 */
function computeGradeVariants(product, grade, { highestBasePrice, variantDiffPercent }) {
  const gradeProxy = {
    variants: grade.variants || [],
    procurementChargePercent: product.procurementChargePercent,
    platformChargePercent:    product.platformChargePercent,
    logisticsChargePercent:   product.logisticsChargePercent,
  };
  const diffPct = variantDiffPercent != null
    ? variantDiffPercent
    : (grade.variantDiffPercent != null ? grade.variantDiffPercent : 2);
  return calculateVariantPricing(gradeProxy, { highestBasePrice, variantDiffPercent: diffPct });
}

/**
 * Return the lowest per-unit final selling price across ALL active grades.
 * Used for "From ₹X" on product listing cards when gradesEnabled=true.
 *
 * @param {Array} grades - product.grades[]
 * @returns {Number}
 */
function getLowestUnitPriceAcrossGrades(grades) {
  if (!grades || !grades.length) return 0;
  let min = Infinity;
  for (const g of grades) {
    if (!g.isActive) continue;
    const lup = getLowestUnitPrice(g.variants || []);
    if (lup > 0 && lup < min) min = lup;
  }
  return min === Infinity ? 0 : min;
}

module.exports = {
  calculateVariantPricing,
  getHighestVariant,
  getLowestUnitPrice,
  previewVariantPricing,
  computeGradeVariants,
  getLowestUnitPriceAcrossGrades,
};
