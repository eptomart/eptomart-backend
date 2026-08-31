// ============================================
// FRUIT BASKETS & HAMPERS ORDER ADAPTER
// FruitBasketOrder model → canonical OrderDTO
// Mirrors uzhavarAdapter.js / eptofreshAdapter.js's structure — this
// vertical has no wallet and no partial-decline, so both are omitted.
// ============================================
'use strict';

const FruitBasketOrder = require('../../../models/FruitBasketOrder');
const { buildPaymentSummary } = require('../../../utils/orderCalculationService');
const {
  baseCard, timelineEvent, itemRow, SUPPORT_DEFAULT, round,
} = require('./dtoHelpers');

const verticalKey = 'fruitbasket';

async function fetchList(userId, { limit = 50, from, to } = {}) {
  const query = { buyer: userId };
  if (from || to) {
    query.createdAt = {};
    if (from) query.createdAt.$gte = from;
    if (to)   query.createdAt.$lte = to;
  }
  return FruitBasketOrder.find(query)
    .select('orderId orderStatus paymentStatus items pricing deliveryDate deliverySlot createdAt')
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
}

async function fetchOne(userId, id) {
  return FruitBasketOrder.findOne({ _id: id, buyer: userId })
    .populate('items.product', 'images')
    .lean();
}

function toCard(doc) {
  return baseCard(verticalKey, doc, {
    orderId:       doc.orderId,
    nativeStatus:  doc.orderStatus,
    paymentStatus: doc.paymentStatus,
    paymentMethod: 'razorpay',
    itemCount:     (doc.items || []).reduce((s, it) => s + (it.quantity || 0), 0),
    totalAmount:   doc.pricing?.total,
    deliveryDate:  doc.deliveryDate,
    placedAt:      doc.createdAt,
  });
}

function toDetail(doc) {
  const card = toCard(doc);
  const cancelled = doc.orderStatus === 'cancelled';

  const itemsOrdered = (doc.items || []).map(it => itemRow(it, {
    name:      it.name,
    image:     it.image || it.product?.images?.[0]?.url || null,
    unitPrice: it.unitPrice,
    lineTotal: it.lineTotal,
  }));

  const timeline = (doc.timeline || []).length
    ? doc.timeline.map(t => timelineEvent(t.status, t.note || t.status, t.at))
    : [timelineEvent('placed', 'Order Placed', doc.createdAt)];
  if (doc.orderStatus === 'delivered' && !doc.timeline?.some(t => t.status === 'delivered')) {
    timeline.push(timelineEvent('delivered', 'Delivered', doc.updatedAt));
  }

  return {
    ...card,
    seller:   null,
    customer: { name: doc.deliveryAddress?.name, phone: doc.deliveryAddress?.phone },
    address:  doc.deliveryAddress || null,
    delivery: {
      provider: 'internal',
      slot:     doc.deliverySlot || null,
      estimatedDelivery: doc.deliveryDate || null,
    },
    itemsOrdered,
    itemsDeclined:  [],
    itemsConfirmed: cancelled ? [] : itemsOrdered,
    timeline,
    paymentSummary: buildPaymentSummary(verticalKey, doc),
    refund: cancelled && doc.paymentStatus === 'paid'
      ? { status: 'processing', amount: round(doc.pricing?.total), method: 'razorpay', date: null, note: doc.cancelReason || null }
      : null,
    walletHistory: [],
    documents: [],
    support: { ...SUPPORT_DEFAULT },
  };
}

module.exports = { verticalKey, fetchList, fetchOne, toCard, toDetail };
