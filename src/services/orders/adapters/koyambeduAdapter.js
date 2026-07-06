// ============================================
// KOYAMBEDU DAILY ORDER ADAPTER
// KoyambeduOrder model → canonical OrderDTO
// ============================================
'use strict';

const KoyambeduOrder  = require('../../../models/KoyambeduOrder');
const KoyambeduWallet = require('../../../models/KoyambeduWallet');
const { buildPaymentSummary } = require('../../../utils/orderCalculationService');
const {
  baseCard, timelineEvent, itemRow, refundBlock, documentRow,
  SUPPORT_DEFAULT, round,
} = require('./dtoHelpers');

const verticalKey = 'koyambedu';

// Koyambedu native timeline event → label
const EVENT_LABELS = {
  order_placed:       'Order Placed',
  payment_received:   'Payment Received',
  sa_review_started:  'Seller Reviewing',
  item_confirmed:     'Item Confirmed',
  item_declined:      'Item Declined',
  qty_reduced:        'Quantity Updated',
  item_restored:      'Item Arranged — Available',
  review_submitted:   'Changes Sent for Approval',
  review_rejected:    'Changes Sent Back for Revision',
  admin_approved:     'Order Confirmed',
  refund_calculated:  'Refund Calculated',
  refund_initiated:   'Refund Initiated',
  refund_credited_wallet: 'Refund Credited to Wallet',
  order_cancelled:    'Order Cancelled',
  order_closed:       'Order Closed',
  packing:            'Procurement in Progress',
  dispatched:         'Out for Delivery',
  delivered:          'Delivered',
  invoice_generated:  'Invoice Generated',
  delivery_acknowledged:    'Delivery Confirmed by You',
  delivery_issue_reported:  'Delivery Issue Reported',
  delivery_issue_resolved:  'Delivery Issue Resolved',
};

// ── Decline visibility gate ───────────────────
// Declines / quantity reductions are shown to the CUSTOMER only after
// Super Admin approval. Until then the customer sees the original order.
// (Cancelled orders always show their refund.)
function declinesVisible(doc) {
  if (doc.adminApproval?.status === 'approved') return true;
  return ['confirmed', 'packing', 'dispatched', 'delivered', 'reported', 'cancelled', 'closed', 'refund_initiated']
    .includes(doc.orderStatus);
}

// Internal Seller Admin ↔ Super Admin approval workflow — NEVER shown
// to customers, at any stage
const INTERNAL_EVENTS = ['review_submitted', 'review_rejected', 'sa_review_started', 'refund_calculated'];
// Decline events additionally hidden until Super Admin approval
const PRE_APPROVAL_EVENTS = ['item_declined', 'qty_reduced', 'item_restored'];

/** A masked view of the order as if nothing was declined (pre-approval). */
function maskedDoc(doc) {
  return {
    ...doc,
    items: (doc.items || []).map(it => ({
      ...it,
      itemStatus:   'pending',
      confirmedQty: it.orderedQty ?? it.quantity,
      declinedQty:  0,
    })),
  };
}

async function fetchList(userId, { limit = 50, from, to } = {}) {
  const query = { buyer: userId };
  if (from || to) {
    query.createdAt = {};
    if (from) query.createdAt.$gte = from;
    if (to)   query.createdAt.$lte = to;
  }
  return KoyambeduOrder.find(query)
    .select('orderId orderStatus paymentStatus paymentMethod pricing calculatedPricing adminApproval.status items.name items.quantity items.confirmedQty items.itemStatus deliveryDate deliverySlot createdAt placedAt refund invoices')
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
}

async function fetchOne(userId, id) {
  return KoyambeduOrder.findOne({ _id: id, buyer: userId })
    .populate('items.seller', 'businessName stallNumber')
    .populate('items.product', 'images')
    .populate('itemsOrdered.product', 'images')
    .lean();
}

function itemCount(doc) {
  return (doc.items || []).length;
}

function displayTotal(doc) {
  // Before Super Admin approval the customer sees the ORIGINAL total —
  // recalculated (post-decline) totals only after approval.
  if (!declinesVisible(doc)) return doc.pricing?.total || 0;
  if (doc.calculatedPricing?.finalPayableAmount > 0 && doc.calculatedPricing?.lastCalculatedAt) {
    return doc.calculatedPricing.finalPayableAmount;
  }
  return doc.pricing?.total || 0;
}

function toCard(doc) {
  const visible = declinesVisible(doc);
  const walletAdj = doc.pricing?.walletAdjustment || 0;
  // Show the pre-wallet order value so customers see the full order amount
  const preWalletTotal = displayTotal(doc) + walletAdj;
  const card = baseCard(verticalKey, doc, {
    orderId:       doc.orderId,
    nativeStatus:  doc.orderStatus,
    paymentStatus: doc.paymentStatus,
    paymentMethod: doc.paymentMethod,
    itemCount:     itemCount(doc),
    totalAmount:   preWalletTotal,
    deliveryDate:  doc.deliveryDate,
    placedAt:      doc.placedAt || doc.createdAt,
  });
  card.deliverySlot    = doc.deliverySlot || null;
  card.walletAdjustment = walletAdj;          // non-zero only when wallet was used
  card.hasDeclinedItems = visible && (doc.items || []).some(it => ['declined', 'partial'].includes(it.itemStatus));
  card.refundStatus = doc.refund?.status || null;
  return card;
}

function unitPriceOf(it) {
  return it.orderedPrice ?? it.finalPrice ?? it.unitPrice ?? 0;
}

/** Product image (primary → first) from a populated item. */
function imgOf(it) {
  const imgs = it.product?.images;
  if (!Array.isArray(imgs) || !imgs.length) return null;
  return imgs.find(i => i.isPrimary)?.url || imgs[0]?.url || null;
}

function toDetail(doc, { walletHistory = [] } = {}) {
  const card = toCard(doc);
  const visible = declinesVisible(doc);
  // Pre-approval: customer sees the original order as placed
  const effectiveDoc = visible ? doc : maskedDoc(doc);

  // ── Items Ordered — immutable snapshot ──────
  const snapshot = (doc.itemsOrdered && doc.itemsOrdered.length)
    ? doc.itemsOrdered.map(it => itemRow(it, {
        image:     imgOf(it),
        quantity:  it.orderedQty,
        unitPrice: it.unitPrice,
        lineTotal: it.lineTotal ?? (it.orderedQty || 0) * (it.unitPrice || 0),
      }))
    : (doc.items || []).map(it => itemRow(it, {
        image:     imgOf(it),
        quantity:  it.orderedQty || it.quantity,
        unitPrice: unitPriceOf(it),
        lineTotal: (it.orderedQty || it.quantity || 0) * unitPriceOf(it),
      }));

  // ── Items Declined (full + partial) — post-approval only ─────
  const itemsDeclined = (effectiveDoc.items || [])
    .filter(it => ['declined', 'partial'].includes(it.itemStatus))
    .map(it => {
      const declinedQty = it.itemStatus === 'declined'
        ? (it.orderedQty || it.quantity || 0)
        : (it.declinedQty || 0);
      return itemRow(it, {
        image:        imgOf(it),
        quantity:     it.orderedQty || it.quantity,
        unitPrice:    unitPriceOf(it),
        lineTotal:    (it.confirmedQty || 0) * unitPriceOf(it),
        declinedQty,
        refundAmount: declinedQty * unitPriceOf(it),
        reason:       it.declinedReason || 'unavailable',
      });
    });

  // ── Items Confirmed (deliverable only) ──────
  const itemsConfirmed = (effectiveDoc.items || [])
    .filter(it => it.itemStatus !== 'declined')
    .map(it => {
      const qty = it.confirmedQty != null && it.itemStatus !== 'pending'
        ? it.confirmedQty
        : (it.orderedQty || it.quantity || 0);
      return itemRow(it, {
        image:     imgOf(it),
        quantity:  qty,
        unitPrice: unitPriceOf(it),
        lineTotal: qty * unitPriceOf(it),
      });
    })
    .filter(r => r.quantity > 0);

  // ── Timeline — native timeline[] preferred ──
  // Review/decline events stay hidden from the customer until approval
  const timelineSource = (doc.timeline || []).filter(
    t => !INTERNAL_EVENTS.includes(t.event) && (visible || !PRE_APPROVAL_EVENTS.includes(t.event)),
  );
  let timeline = timelineSource.map(t => timelineEvent(
    t.event,
    EVENT_LABELS[t.event] || t.event,
    t.timestamp,
    { description: t.description, actorRole: t.actor?.role, meta: t.meta },
  ));
  if (!timeline.length) {
    // Legacy orders: synthesize from timestamps
    timeline = [
      timelineEvent('order_placed', 'Order Placed', doc.placedAt || doc.createdAt),
      doc.confirmedAt  && timelineEvent('admin_approved', 'Order Confirmed', doc.confirmedAt),
      doc.dispatchedAt && timelineEvent('dispatched', 'Out for Delivery', doc.dispatchedAt),
      doc.deliveredAt  && timelineEvent('delivered', 'Delivered', doc.deliveredAt),
    ].filter(Boolean);
  }

  // ── Documents (only those that exist) ───────
  const documents = [];
  const inv = doc.invoices || {};
  if (inv.proforma?.isAvailable) {
    documents.push(documentRow('proforma', 'Proforma Invoice', {
      number: inv.proforma.number, generatedAt: inv.proforma.generatedAt,
      url: `/api/koyambedu/orders/${doc._id}/invoice?type=proforma`,
    }));
  }
  if (inv.confirmation?.isAvailable) {
    documents.push(documentRow('confirmation', 'Order Confirmation', {
      number: inv.confirmation.number, generatedAt: inv.confirmation.generatedAt,
      url: `/api/koyambedu/orders/${doc._id}/invoice?type=confirmation`,
    }));
  }
  if (inv.tax?.isAvailable) {
    documents.push(documentRow('tax', 'Final Tax Invoice', {
      number: inv.tax.number, generatedAt: inv.tax.generatedAt,
      url: `/api/koyambedu/orders/${doc._id}/invoice?type=tax`,
    }));
  }

  // ── Refund ──────────────────────────────────
  // Never surfaced to the customer before Super Admin approval
  const pendingRefund = visible ? (doc.saReview?.pendingRefundAmount || 0) : 0;
  let refund = refundBlock(doc.refund);
  // Legacy cancelled orders without a refund record: full paid amount
  if (!refund && doc.orderStatus === 'cancelled' && doc.paymentStatus === 'paid') {
    refund = { status: 'initiated', amount: round(doc.pricing?.total || 0), method: 'wallet', date: null, note: 'Full order refund on cancellation' };
  }
  if (!refund && pendingRefund > 0) {
    refund = {
      status: doc.adminApproval?.status === 'approved' ? 'processed' : 'calculated',
      amount: round(pendingRefund),
      method: doc.saReview?.refundMethod || null,
      date:   doc.adminApproval?.approvedAt || null,
      note:   null,
    };
  }

  const sellers = [...new Set((doc.items || [])
    .map(it => it.seller?.businessName)
    .filter(Boolean))];

  return {
    ...card,
    seller:   sellers.length ? { name: sellers.join(', ') } : { name: 'Koyambedu Market' },
    customer: { name: doc.shippingAddress?.fullName, phone: doc.shippingAddress?.phone },
    address:  doc.shippingAddress || null,
    delivery: {
      provider:     'internal',
      partner:      doc.deliveryPartner || null,
      deliveryDate: doc.deliveryDate || null,
      deliverySlot: doc.deliverySlot || null,
      deliveryType: doc.deliveryType || null,
    },
    itemsOrdered: snapshot,
    itemsDeclined,
    itemsConfirmed,
    timeline,
    paymentSummary: buildPaymentSummary(verticalKey, effectiveDoc),
    refund,
    partialRefunds: (visible ? (doc.partialRefunds || []) : []).map(r => ({
      amount: round(r.amount), status: r.status, date: r.initiatedAt, reason: r.reason || null,
    })),
    walletHistory,
    documents,
    support: { ...SUPPORT_DEFAULT },
    // Delivery acknowledgement — customer confirms receipt after delivery
    deliveryAck: doc.deliveryAck && doc.deliveryAck.status !== 'none'
      ? {
          status:      doc.deliveryAck.status,
          submittedAt: doc.deliveryAck.submittedAt,
          issues:      doc.deliveryAck.issues || [],
          alertActive: !!doc.deliveryAck.alert?.active,
          resolution:  doc.deliveryAck.alert?.resolvedAt
            ? { note: doc.deliveryAck.alert.resolution || '', resolvedAt: doc.deliveryAck.alert.resolvedAt }
            : null,
          resolutionAccepted: !!doc.deliveryAck.resolutionAccepted,
          // Ask the customer to confirm & close once resolved
          canConfirmClose: !!doc.deliveryAck.alert?.resolvedAt &&
            !doc.deliveryAck.alert?.active &&
            !doc.deliveryAck.resolutionAccepted &&
            doc.orderStatus !== 'closed',
        }
      : null,
    canAcknowledgeDelivery: doc.orderStatus === 'delivered' &&
      (!doc.deliveryAck || doc.deliveryAck.status === 'none'),
  };
}

/** Wallet transactions relating to this order. */
async function fetchWalletHistory(userId, doc) {
  const wallet = await KoyambeduWallet.findOne({ user: userId }).select('transactions').lean();
  if (!wallet) return [];
  return (wallet.transactions || [])
    .filter(t => String(t.orderRef || '') === String(doc._id) || t.orderId === doc.orderId)
    .map(t => ({
      type: t.type, amount: round(t.amount), reason: t.reason || null,
      reference: t.orderId || null, note: t.note || null, date: t.createdAt,
    }));
}

module.exports = { verticalKey, fetchList, fetchOne, toCard, toDetail, fetchWalletHistory };
