// ============================================
// ORDER CALCULATION SERVICE — Eptomart (all verticals)
// Single source of truth for all order totals.
// All frontend and backend screens MUST use
// the result of this service — never compute
// totals independently.
//
// calculateOrderTotals / applyCalculation:
//   original Koyambedu decline/refund engine (unchanged).
// buildPaymentSummary:
//   canonical customer-facing payment summary
//   for ANY vertical (used by the unified v2 Orders API).
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
  // Priority: explicit opts > pricing.walletAdjustment (set in placeOrder, canonical) >
  // calculatedPricing.walletAdjustment (cached — may be 0 due to Mongoose default on new docs).
  // NOTE: Do NOT swap back to reading calculatedPricing first. Mongoose initialises
  // calculatedPricing.walletAdjustment = 0 before applyCalculation runs in placeOrder, so
  // using ?? would stop at 0 and never reach the correct pricing.walletAdjustment value.
  const walletAdj = Number(
    opts.walletAdjustment != null ? opts.walletAdjustment
    : (order.pricing?.walletAdjustment ?? order.calculatedPricing?.walletAdjustment ?? 0)
  );

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
      // Fully declined: refund orderedQty at the last-known finalPrice.
      // Using finalPrice (not orderedPrice) ensures correctness when daily price
      // revision has already credited/debited the wallet for price changes — the
      // math nets out exactly to what the customer originally paid.
      const qty   = Number(it.orderedQty || it.quantity || 0);
      const price = Number(it.finalPrice || it.orderedPrice || 0);
      declinedRefundAmount += qty * price;
    } else if (status === 'partial') {
      // Partially declined: refund the declined portion at last-known finalPrice
      const decQty = Number(it.declinedQty || 0);
      const price  = Number(it.finalPrice || it.orderedPrice || 0);
      declinedRefundAmount += decQty * price;
    }
  }

  // ── 3. Confirmed items total ──────────────────
  // Sum of (confirmedQty * unitPrice) for non-declined items.
  // Uses finalPrice (updated on SA confirm to current market price) over orderedPrice.
  let confirmedItemsTotal = 0;
  for (const it of items) {
    const status = it.itemStatus || 'pending';
    if (status === 'declined') continue; // fully declined — don't charge
    const confirmedQty = Number(it.confirmedQty != null ? it.confirmedQty : (it.orderedQty || it.quantity || 0));
    const price        = Number(it.finalPrice || it.orderedPrice || 0); // finalPrice = current market price
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
  const gst                = 0; // Fresh produce: 0% GST under Indian GST law (Chapter 7 & 8)
  // Platform fee is tax-inclusive at 18% (SAC 9985 — marketplace services).
  // GSTIN: 33IFLPS7086Q1Z6. Extract the GST portion for disclosure on invoices.
  // The total charged does NOT change — GST is already within the platform fee.
  const platformFeeGst     = round(platformFee * 18 / 118); // CGST 9% + SGST 9%
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
    platformFeeGst,       // GST portion within platform fee (tax-inclusive, for invoice disclosure)
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

// ══════════════════════════════════════════════════════════════════
// CANONICAL PAYMENT SUMMARY — per vertical
// Shape (always identical for every vertical):
// { originalOrderValue, refundAmount, platformFee, packingFee,
//   logisticsFee, deliveryCharge, gst, couponDiscount,
//   walletAdjustment, finalPaidAmount, currency, notes[] }
// ══════════════════════════════════════════════════════════════════

const EMPTY_SUMMARY = () => ({
  originalOrderValue: 0,
  refundAmount:       0,
  platformFee:        0,
  packingFee:         0,
  logisticsFee:       0,
  deliveryCharge:     0,
  gst:                0,
  couponDiscount:     0,
  walletAdjustment:   0,
  finalPaidAmount:    0,
  currency:           'INR',
  notes:              [],
});

/**
 * Build the canonical customer-facing payment summary for any vertical.
 * @param {String} verticalKey - eptomart | koyambedu | eptofresh | uzhavar
 * @param {Object} order       - native order document (lean or hydrated)
 */
function buildPaymentSummary(verticalKey, order) {
  const s = EMPTY_SUMMARY();
  if (!order) return s;

  switch (verticalKey) {
    case 'koyambedu': {
      // Recompute via the decline/refund engine (single source of truth)
      const calc = calculateOrderTotals(order);
      s.originalOrderValue = calc.originalOrderValue;
      s.refundAmount       = calc.declinedRefundAmount;
      s.platformFee        = calc.platformFee;
      s.platformFeeGst     = calc.platformFeeGst; // GST portion within platform fee (tax-inclusive)
      s.packingFee         = calc.packingLogisticsFee;
      s.deliveryCharge     = calc.deliveryCharge;
      s.gst                = calc.gst; // produce GST = 0
      s.couponDiscount     = calc.couponDiscount;
      s.walletAdjustment   = calc.walletAdjustment;
      s.finalPaidAmount    = calc.finalPayableAmount;
      if (s.refundAmount > 0) {
        s.notes.push(order.paymentMethod === 'cod'
          ? 'Declined amount deducted from payable (Cash on Delivery).'
          : 'Declined amount refunded to wallet / payment method.');
      }
      break;
    }

    case 'eptomart': {
      const p = order.pricing || {};
      s.originalOrderValue = round(p.subtotal);
      s.refundAmount       = round(order.refund?.amount || 0);
      s.deliveryCharge     = round(p.shipping);
      s.gst                = round(order.gstBreakdown?.gstTotal ?? p.tax);
      s.couponDiscount     = round(p.discount);
      s.finalPaidAmount    = round(p.total);
      break;
    }

    case 'eptofresh': {
      const p = order.pricing || {};
      s.originalOrderValue = round(p.subtotal);
      s.refundAmount       = round(order.refund?.amount || 0);
      s.deliveryCharge     = round(Math.max(0, (p.deliveryCharge || 0) - (p.deliveryDiscount || 0)));
      s.couponDiscount     = round(p.couponDiscount);
      s.walletAdjustment   = round(p.walletApplied);
      s.finalPaidAmount    = round(p.total);
      if ((p.deliveryDiscount || 0) > 0) s.notes.push(`Delivery discount applied: ₹${round(p.deliveryDiscount)}`);
      break;
    }

    case 'uzhavar': {
      const bf = order.bookingFee || {};
      s.originalOrderValue = round(order.subtotal);
      s.platformFee        = round(bf.base);
      s.gst                = round(bf.gst);
      // Customer pays only the booking fee online; produce is paid to the farmer at delivery.
      s.finalPaidAmount    = round(bf.total);
      s.notes.push(`Pay farmer on delivery: ₹${round(order.balancePayableToFarmer ?? order.subtotal)}`);
      if (order.paymentStatus === 'refunded') s.refundAmount = round(bf.total);
      break;
    }

    case 'fruitbasket': {
      const p = order.pricing || {};
      s.originalOrderValue = round(p.subtotal);
      s.deliveryCharge     = round(p.deliveryCharge);
      s.couponDiscount     = round(p.couponDiscount);
      s.finalPaidAmount    = round(p.total);
      if (p.deliveryChargePending) s.notes.push('Delivery charge pending confirmation for this address.');
      if (order.orderStatus === 'cancelled') s.refundAmount = round(p.total);
      break;
    }

    default:
      break;
  }

  return s;
}

module.exports = { calculateOrderTotals, applyCalculation, buildPaymentSummary };
