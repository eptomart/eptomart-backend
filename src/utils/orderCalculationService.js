// ============================================
// ORDER CALCULATION SERVICE — Koyambedu Daily
// Single source of truth for all order totals.
// All frontend and backend screens MUST use
// the result of this function — never compute
// totals independently.
// ============================================
'use strict';

/**
 * Calculates all pricing fields for a Koyambedu order.
 * Works with both old orders (no itemsOrdered) and new orders.
 *
 * @param {Object} order - Mongoose document or plain object
 * @param {Object} opts
 * @param {Number} opts.walletAdjustment - wallet credits to apply (default 0)
 * @returns {Object} calculatedPricing
 */
function calculateOrderTotals(order, opts = {}) {
  const items   = order.items || [];
  const pricing = order.pricing || {};
  const walletAdj = Number(opts.walletAdjustment || order.calculatedPricing?.walletAdjustment || 0);

  // ── 1. Original order value ──────────────────
  // Use itemsOrdered if available (new orders), else sum items using orderedQty/orderedPrice
  let originalOrderValue = 0;
  if (order.itemsOrdered && order.itemsOrdered.length > 0) {
    originalOrderValue = order.itemsOrdered.reduce((s, it) => {
      return s + (Number(it.orderedQty || 0) * Number(it.unitPrice || 0));
    }, 0);
  } else {
    // Legacy: use items array with orderedPrice * orderedQty (or quantity if orderedQty absent)
    originalOrderValue = items.reduce((s, it) => {
      const qty   = Number(it.orderedQty || it.quantity || 0);
      const price = Number(it.orderedPrice || it.finalPrice || 0);
      return s + qty * price;
    }, 0);
  }

  // ── 2. Declined refund amount ────────────────
  // Sum of (declinedQty * unitPrice) across all items with itemStatus declined/partial
  let declinedRefundAmount = 0;
  for (const it of items) {
    const status = it.itemStatus || 'pending';
    if (status === 'declined') {
      // Fully declined: refund all of orderedQty
      const qty   = Number(it.orderedQty || it.quantity || 0);
      const price = Number(it.orderedPrice || it.finalPrice || 0);
      declinedRefundAmount += qty * price;
    } else if (status === 'partial') {
      // Partially declined: refund the declined portion
      const decQty = Number(it.declinedQty || 0);
      const price  = Number(it.orderedPrice || it.finalPrice || 0);
      declinedRefundAmount += decQty * price;
    }
  }

  // ── 3. Confirmed items total ──────────────────
  // Sum of (confirmedQty * unitPrice) for non-declined items
  let confirmedItemsTotal = 0;
  for (const it of items) {
    const status = it.itemStatus || 'pending';
    if (status === 'declined') continue; // fully declined — don't charge
    const confirmedQty = Number(it.confirmedQty != null ? it.confirmedQty : (it.orderedQty || it.quantity || 0));
    const price        = Number(it.orderedPrice || it.finalPrice || 0);
    confirmedItemsTotal += confirmedQty * price;
  }
  // If no SA review done yet, confirmedItemsTotal = originalOrderValue (nothing declined yet)
  if (items.every(it => (it.itemStatus || 'pending') === 'pending')) {
    confirmedItemsTotal = originalOrderValue;
    declinedRefundAmount = 0;
  }

  // ── 4. Fixed charges ──────────────────────────
  const platformFee        = Number(pricing.platformFee || 15);
  const packingLogisticsFee = Number(pricing.packingLogisticsFee || 0);
  const deliveryCharge     = Number(pricing.deliveryCharge || 0);
  const gst                = 0; // Fresh produce: 0% GST under Indian GST law
  const couponDiscount     = Number(pricing.discount || 0);

  // ── 5. Final payable ─────────────────────────
  // COD: deduct declined amount from payable directly
  // Online: declined amount goes to wallet/gateway refund, so subtract from payable too
  const finalPayableAmount = Math.max(0,
    confirmedItemsTotal + platformFee + packingLogisticsFee + deliveryCharge + gst
    - couponDiscount - walletAdj
  );

  return {
    originalOrderValue:   round(originalOrderValue),
    declinedRefundAmount: round(declinedRefundAmount),
    confirmedItemsTotal:  round(confirmedItemsTotal),
    platformFee:          round(platformFee),
    packingLogisticsFee:  round(packingLogisticsFee),
    deliveryCharge:       round(deliveryCharge),
    gst:                  0,
    walletAdjustment:     round(walletAdj),
    couponDiscount:       round(couponDiscount),
    finalPayableAmount:   round(finalPayableAmount),
    lastCalculatedAt:     new Date(),
  };
}

/** Round to 2 dp */
function round(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * Persist the calculated totals back to the order document.
 * Call after any item change, then order.save().
 */
function applyCalculation(order, opts = {}) {
  const result = calculateOrderTotals(order, opts);
  order.calculatedPricing = result;
  return result;
}

module.exports = { calculateOrderTotals, applyCalculation };
