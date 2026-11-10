// ============================================
// Express — decline items & refund
// A store owner/manager can decline order lines (typically: out of stock).
// The customer is refunded to their Eptomart Express WALLET or back to the
// ORIGINAL PAYMENT (Razorpay) — their saved choice on the order.
//   • refund = line total − that line's share of any coupon
//   • if EVERY line is declined the order is cancelled and the delivery +
//     platform fees are refunded too (nothing was supplied)
//   • wallet-paid money always returns to the wallet; if a source refund
//     fails (or exceeds what was paid by card) the remainder goes to the wallet
// ============================================
const ExpressStoreProduct = require('../models/ExpressStoreProduct');
const wallet = require('./expressWalletService');

const r2 = wallet.r2;
const DECLINABLE = ['confirmed', 'preparing'];
const CODES = ['out_of_stock', 'quality', 'other'];

function plan(order, itemIds) {
  const ids = new Set((itemIds || []).map(String));
  const items = order.items || [];
  const chosen = items.filter((it) => ids.has(String(it._id)) && it.status !== 'declined');
  return { chosen, items };
}

/** Pure maths — how much would be refunded? (used for the preview too) */
function computeRefund(order, itemIds) {
  const { chosen, items } = plan(order, itemIds);
  const p = order.pricing || {};
  const originalSub = items.reduce((a, i) => a + (i.lineTotal || 0), 0) || 1;
  const coupon = p.couponDiscount || 0;
  const lineRefund = (it) => r2((it.lineTotal || 0) - (coupon * (it.lineTotal || 0)) / originalSub);
  const activeAfter = items.filter((i) => i.status !== 'declined' && !chosen.includes(i));
  const fullDecline = chosen.length > 0 && activeAfter.length === 0;
  const remaining = r2((p.total || 0) - (p.refundedAmount || 0));
  let amount = chosen.reduce((a, it) => a + lineRefund(it), 0);
  if (fullDecline) amount = remaining; // everything unfulfilled → refund the lot (incl. delivery + platform fee)
  amount = r2(Math.min(Math.max(amount, 0), remaining));
  return { chosen, fullDecline, amount, perLine: chosen.map((it) => ({ item: it, refund: lineRefund(it) })), activeAfter };
}

/**
 * Apply the decline. `razorpay` is an SDK instance (or null).
 * Throws Error with .statusCode for caller-fixable problems.
 */
async function declineItems(order, { itemIds, code, reason, actorName, razorpay }) {
  const bad = (m, s = 400) => { const e = new Error(m); e.statusCode = s; throw e; };
  if (order.paymentStatus !== 'paid') bad('Only paid orders can have items declined');
  if (!DECLINABLE.includes(order.orderStatus)) bad(`Items can only be declined while the order is confirmed or being prepared (now: ${order.orderStatus})`);
  if (!Array.isArray(itemIds) || !itemIds.length) bad('Select at least one item to decline');
  const dcode = CODES.includes(code) ? code : 'out_of_stock';
  const { chosen } = plan(order, itemIds);
  if (!chosen.length) bad('Those items are already declined or not on this order');

  const calc = computeRefund(order, itemIds);
  const itemNames = calc.chosen.map((i) => i.name);
  const note = String(reason || '').trim() || (dcode === 'out_of_stock' ? 'Item unavailable' : 'Declined by store');

  // 1) mark lines
  const prevActiveSub = order.items.filter((i) => i.status !== 'declined').reduce((a, i) => a + (i.lineTotal || 0), 0) || 1;
  const now = new Date();
  for (const { item, refund } of calc.perLine) {
    item.status = 'declined'; item.declineCode = dcode; item.declineReason = note;
    item.declinedAt = now; item.declinedBy = actorName; item.refundAmount = refund;
  }
  // 2) keep cost-of-goods snapshot in step with what is actually supplied
  const newActiveSub = order.items.filter((i) => i.status !== 'declined').reduce((a, i) => a + (i.lineTotal || 0), 0);
  order.pricing.itemsProcurementCost = r2((order.pricing.itemsProcurementCost || 0) * (newActiveSub / prevActiveSub));

  // 3) stock: unavailable → zero the shelf; other reasons → put it back
  for (const it of calc.chosen) {
    if (dcode === 'out_of_stock') await ExpressStoreProduct.findOneAndUpdate({ store: order.store, product: it.product }, { $set: { stockQty: 0 } });
    else await ExpressStoreProduct.findOneAndUpdate({ store: order.store, product: it.product }, { $inc: { stockQty: it.quantity } });
  }

  // 4) money
  const amount = calc.amount;
  const total = order.pricing.total || 0;
  const walletPaid = r2(order.pricing.walletApplied || 0);
  const cardPaid = r2(total - walletPaid);
  const alreadyToSource = r2((order.refunds || []).filter((r) => r.mode === 'source' && r.status !== 'failed').reduce((a, r) => a + (r.amount || 0), 0));
  const sourceCapacity = Math.max(0, r2(cardPaid - alreadyToSource));
  const wantSource = order.refundPreference === 'source';
  let toSource = wantSource ? r2(Math.min(amount, sourceCapacity)) : 0;
  let toWallet = r2(amount - toSource);
  let fallback = false;
  const entries = [];

  if (toSource > 0) {
    if (order.isDemoOrder || !order.razorpayPaymentId) {
      entries.push({ amount: toSource, mode: 'source', status: 'completed', reason: note, itemNames });  // demo: simulated
    } else {
      try {
        if (!razorpay) throw new Error('Payment gateway not configured');
        const rf = await razorpay.payments.refund(order.razorpayPaymentId, {
          amount: Math.round(toSource * 100), speed: 'normal',
          notes: { expressOrderId: order.orderId, reason: note.slice(0, 200) },
        });
        entries.push({ amount: toSource, mode: 'source', status: 'initiated', razorpayRefundId: rf?.id, reason: note, itemNames });
      } catch (err) {
        console.error('[express.refund] source refund failed, falling back to wallet:', err.message);
        entries.push({ amount: toSource, mode: 'source', status: 'failed', reason: `Source refund failed: ${err.message}`.slice(0, 200), itemNames, fallbackToWallet: true });
        toWallet = r2(toWallet + toSource); toSource = 0; fallback = true;
      }
    }
  }
  if (toWallet > 0) {
    await wallet.credit(order.buyer, toWallet, calc.fullDecline ? 'order_cancelled' : (fallback ? 'refund_fallback' : 'item_declined'),
      { orderId: order.orderId, orderRef: order._id, note: `${itemNames.join(', ')} — ${note}` });
    entries.push({ amount: toWallet, mode: 'wallet', status: 'completed', reason: note, itemNames, fallbackToWallet: fallback });
  }
  order.refunds.push(...entries);
  order.pricing.refundedAmount = r2((order.pricing.refundedAmount || 0) + amount);

  // 5) status + timeline
  order.timeline.push({ status: 'item_declined', note: `${itemNames.join(', ')} declined by ${actorName} (${note}) — ₹${amount} refunded` });
  if (calc.fullDecline) {
    order.orderStatus = 'cancelled';
    order.cancelReason = `All items unavailable${note ? ` (${note})` : ''}`;
    order.timeline.push({ status: 'cancelled', note: order.cancelReason });
  }
  await order.save();
  return { amount, toWallet, toSource, fallback, fullyCancelled: calc.fullDecline, itemNames, code: dcode };
}

module.exports = { declineItems, computeRefund, DECLINABLE, CODES };
