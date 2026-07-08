'use strict';
// ============================================================
// PRICE REVISION SERVICE — Automatic Daily Market-Price Sync
// ============================================================
// Called before every significant admin action on a KoyambeduOrder.
//
// What it does:
//   1. Fetches the current product prices from KoyambeduProduct (grade + qty aware).
//   2. Builds a SHA-256 hash of the current price snapshot.
//   3. Compares hash with order.dailyPriceRevision.lastRevisionHash.
//      → If identical, prices haven't changed — returns { revised: false }.
//   4. For each non-declined item where currentPrice ≠ item.finalPrice:
//      - Credits wallet if price dropped.
//      - Debits wallet if price rose.
//      - Updates item.finalPrice and item.priceRevised = true.
//   5. Calls applyCalculation(order) to recompute all order totals.
//   6. Records revision history in order.dailyPriceRevision.
//   7. Appends timeline + audit entries.
//
// Idempotency: hash-based — repeated calls with the same prices do nothing.
// Price lock:  once priceLocked = true (after procurement invoice), all
//              calls immediately return { revised: false }.
//
// lockOrderPrices(order):
//   Called when the Procurement/Tax invoice is generated. Sets priceLocked = true.
//   After this, no further price revisions can occur for this order.
// ============================================================

const crypto           = require('crypto');
const KoyambeduProduct = require('../models/KoyambeduProduct');
const KoyambeduWallet  = require('../models/KoyambeduWallet');
const { applyCalculation } = require('./orderCalculationService');

// Statuses where price revision should never run
const TERMINAL_STATUSES = new Set([
  'delivered', 'cancelled', 'refunded', 'closed',
]);

const r2 = n => Math.round((Number(n) || 0) * 100) / 100;

// ────────────────────────────────────────────────────────────
// resolveCurrentPrice
// ────────────────────────────────────────────────────────────
// Reproduces the exact same grade + qty-tier logic used in
// koyambeduController.js updateCart (lines 319-358) so that
// the price revision always resolves prices identically to
// the price the customer would see in the live shop.
//
// @param  product  KoyambeduProduct lean doc
// @param  item     order item (has gradeKey, confirmedQty / orderedQty)
// @returns Number | null
// ────────────────────────────────────────────────────────────
function resolveCurrentPrice(product, item) {
  if (!product) return null;

  // Use confirmedQty for repricing so the tier matches what SA confirmed
  const qty = Number(
    item.confirmedQty != null
      ? item.confirmedQty
      : (item.orderedQty || item.quantity || 0)
  );

  let activeVariants = product.variants || [];

  // Grade-aware price resolution
  if (product.gradesEnabled && product.grades?.length && item.gradeKey) {
    const grade = product.grades.find(
      g => g.gradeKey === item.gradeKey && g.isActive
    );
    if (grade) activeVariants = grade.variants || [];
  }

  if (activeVariants.length) {
    const matchingVariant = activeVariants.find(v => {
      if (!v.toQty) return qty >= v.fromQty;
      return qty >= v.fromQty && qty <= v.toQty;
    });
    if (matchingVariant?.finalPrice) return Number(matchingVariant.finalPrice);
  }

  // Fallback: legacy single price
  return product.currentPrice ? Number(product.currentPrice) : null;
}

// ────────────────────────────────────────────────────────────
// buildRevisionHash
// ────────────────────────────────────────────────────────────
// Produces a deterministic SHA-256 hash over:
//   "itemId:lastKnownPrice→currentPrice" for every non-declined item
// If this hash equals order.dailyPriceRevision.lastRevisionHash,
// the prices are unchanged and no revision is needed.
// ────────────────────────────────────────────────────────────
function buildRevisionHash(order, productMap) {
  const parts = [];
  for (const item of order.items || []) {
    if (item.itemStatus === 'declined') continue;
    const product = productMap.get(String(item.product));
    const currentPrice = resolveCurrentPrice(product, item);
    if (currentPrice == null) continue;
    const lastKnown = r2(Number(item.finalPrice ?? item.orderedPrice ?? 0));
    parts.push(`${item._id}:${lastKnown}→${r2(currentPrice)}`);
  }
  if (!parts.length) return null;
  return crypto.createHash('sha256').update(parts.sort().join('|')).digest('hex');
}

// ────────────────────────────────────────────────────────────
// applyPriceRevision (main export)
// ────────────────────────────────────────────────────────────
// @param  order        Mongoose KoyambeduOrder document (hydrated, NOT lean)
// @param  opts
//   .triggeredBy  String   — who/what called this ('confirm_item' | 'decline_item' |
//                            'reduce_qty' | 'status_update' | 'submit_review' |
//                            'approve_review' | 'manual' etc.)
//   .actorId      ObjectId — optional actor for audit trail
// @returns { revised, reason?, changes?, totalCredit, totalDebit, netWalletChange }
// ────────────────────────────────────────────────────────────
async function applyPriceRevision(order, opts = {}) {
  const { triggeredBy = 'system', actorId } = opts;

  // ── Guards ───────────────────────────────────────────────
  if (TERMINAL_STATUSES.has(order.orderStatus)) {
    return { revised: false, reason: 'terminal_status' };
  }
  if (order.dailyPriceRevision?.priceLocked) {
    return { revised: false, reason: 'price_locked' };
  }
  if (order.invoices?.tax?.isAvailable) {
    return { revised: false, reason: 'tax_invoice_exists' };
  }
  if (order.procurementPricing?.status === 'confirmed') {
    return { revised: false, reason: 'procurement_confirmed' };
  }
  if (order.paymentStatus !== 'paid') {
    // Only revise paid orders — pending payment orders haven't been charged yet
    return { revised: false, reason: 'not_paid' };
  }

  // ── Collect non-declined product IDs ─────────────────────
  const activeItems = (order.items || []).filter(
    it => it.itemStatus !== 'declined'
  );
  if (!activeItems.length) return { revised: false, reason: 'no_active_items' };

  const productIds = [...new Set(activeItems.map(it => String(it.product)))];

  // ── Fetch products in a single query ─────────────────────
  const products = await KoyambeduProduct.find({
    _id: { $in: productIds },
  }).lean();
  const productMap = new Map(products.map(p => [String(p._id), p]));

  // ── Idempotency check ─────────────────────────────────────
  const newHash = buildRevisionHash(order, productMap);
  if (!newHash) return { revised: false, reason: 'no_priceable_items' };

  const lastHash = order.dailyPriceRevision?.lastRevisionHash;
  if (lastHash === newHash) return { revised: false, reason: 'prices_unchanged' };

  // ── Compute per-item diffs ───────────────────────────────
  const changes       = [];
  let   totalCredit   = 0;
  let   totalDebit    = 0;

  for (const item of order.items) {
    if (item.itemStatus === 'declined') continue;

    const product      = productMap.get(String(item.product));
    const currentPrice = resolveCurrentPrice(product, item);
    if (currentPrice == null) continue;

    const lastKnown = r2(Number(item.finalPrice ?? item.orderedPrice ?? 0));
    if (lastKnown === 0) continue;                   // no prior price to compare
    if (r2(currentPrice) === lastKnown) continue;    // price unchanged for this item

    const qty    = Number(
      item.confirmedQty != null
        ? item.confirmedQty
        : (item.orderedQty || item.quantity || 0)
    );
    const diff   = r2(lastKnown - currentPrice); // +ve = price dropped → credit
    const amount = r2(Math.abs(diff) * qty);

    changes.push({
      productId:          item.product,
      name:               item.name,
      gradeKey:           item.gradeKey || null,
      qty,
      previousFinalPrice: lastKnown,
      newFinalPrice:      r2(currentPrice),
      diff,
      walletAction:       diff > 0 ? 'credit' : 'debit',
      walletAmount:       amount,
    });

    // Update item in-place on the Mongoose document
    item.finalPrice   = r2(currentPrice);
    item.priceRevised = true;

    if (diff > 0) totalCredit += amount;
    else          totalDebit  += amount;
  }

  // Update the hash regardless (prevents repeated no-diff checks)
  if (!order.dailyPriceRevision) order.set('dailyPriceRevision', {});
  order.dailyPriceRevision.lastRevisionHash = newHash;

  if (!changes.length) {
    // Prices changed in hash (qty-tier may have shifted) but no actual ₹ diff
    return { revised: false, reason: 'no_price_change' };
  }

  totalCredit = r2(totalCredit);
  totalDebit  = r2(totalDebit);
  const netWalletChange = r2(totalCredit - totalDebit);

  // ── Apply wallet adjustments ──────────────────────────────
  const buyerId = order.buyer?._id || order.buyer;
  let wallet = await KoyambeduWallet.findOne({ user: buyerId });
  if (!wallet) wallet = new KoyambeduWallet({ user: buyerId, balance: 0 });

  for (const chg of changes) {
    const baseOpts = {
      orderId:     order.orderId,
      orderRef:    order._id,
      productId:   chg.productId,
      productName: chg.name,
    };

    if (chg.walletAction === 'credit') {
      await wallet.credit(chg.walletAmount, 'price_revision_credit', {
        ...baseOpts,
        reason: `Daily price revision: ${chg.name}${chg.gradeKey ? ` (${chg.gradeKey})` : ''} ₹${chg.previousFinalPrice} → ₹${chg.newFinalPrice} (order ${order.orderId})`,
      });
    } else {
      await wallet.debit(chg.walletAmount, 'price_revision_debit', {
        ...baseOpts,
        reason: `Daily price revision: ${chg.name}${chg.gradeKey ? ` (${chg.gradeKey})` : ''} ₹${chg.previousFinalPrice} → ₹${chg.newFinalPrice} (order ${order.orderId})`,
      });
    }
  }

  // ── Recalculate order totals with updated finalPrices ────
  applyCalculation(order);

  // ── Store revision history ───────────────────────────────
  const prev = order.dailyPriceRevision;
  order.dailyPriceRevision.lastAppliedAt      = new Date();
  order.dailyPriceRevision.totalCreditApplied = r2((prev.totalCreditApplied || 0) + totalCredit);
  order.dailyPriceRevision.totalDebitApplied  = r2((prev.totalDebitApplied  || 0) + totalDebit);

  order.dailyPriceRevision.revisions = [
    ...(prev.revisions || []),
    {
      appliedAt:      new Date(),
      triggeredBy,
      items:          changes,
      totalCredit,
      totalDebit,
      netWalletChange,
    },
  ];

  // ── Timeline entry ───────────────────────────────────────
  const creditMsg = totalCredit > 0 ? ` ₹${totalCredit} credited to wallet.` : '';
  const debitMsg  = totalDebit  > 0 ? ` ₹${totalDebit} debited from wallet.` : '';
  order.timeline.push({
    event:       'price_revision_applied',
    description: `Daily price revision applied (${triggeredBy}). ${changes.length} item(s) repriced.${creditMsg}${debitMsg}`,
    actor:       { role: 'system', userId: actorId || null, name: 'System (Price Revision)' },
    timestamp:   new Date(),
    meta:        { changes, totalCredit, totalDebit, netWalletChange },
  });

  order.auditLog.push({
    action:    'price_revision_applied',
    actorRole: 'system',
    actorId:   actorId || null,
    timestamp: new Date(),
    amount:    netWalletChange,
    notes:     `${changes.length} item(s) repriced. Net wallet: ${netWalletChange >= 0 ? '+' : ''}₹${netWalletChange}`,
  });

  return { revised: true, changes, totalCredit, totalDebit, netWalletChange };
}

// ────────────────────────────────────────────────────────────
// lockOrderPrices
// ────────────────────────────────────────────────────────────
// Call when the Procurement Invoice (or Tax Invoice) is generated.
// After locking, applyPriceRevision returns { revised: false } immediately.
// ────────────────────────────────────────────────────────────
function lockOrderPrices(order) {
  if (!order.dailyPriceRevision) order.set('dailyPriceRevision', {});
  order.dailyPriceRevision.priceLocked = true;
  order.dailyPriceRevision.lockedAt    = new Date();
}

module.exports = { applyPriceRevision, lockOrderPrices };
