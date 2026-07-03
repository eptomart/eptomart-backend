// ============================================
// FARMER FRESH (Uzhavar) ORDER ADAPTER
// UzhavarOrder model → canonical OrderDTO
// Booking-fee model: customer pays fee online,
// pays farmer for produce at delivery.
// ============================================
'use strict';

const UzhavarOrder = require('../../../models/UzhavarOrder');
const { buildPaymentSummary } = require('../../../utils/orderCalculationService');
const {
  baseCard, timelineEvent, itemRow, SUPPORT_DEFAULT, round,
} = require('./dtoHelpers');

const verticalKey = 'uzhavar';

async function fetchList(userId, { limit = 50, from, to } = {}) {
  const query = { buyer: userId, status: { $ne: 'payment_pending' } };
  if (from || to) {
    query.createdAt = {};
    if (from) query.createdAt.$gte = from;
    if (to)   query.createdAt.$lte = to;
  }
  return UzhavarOrder.find(query)
    .select('orderNumber status paymentStatus paymentMethod items subtotal grandTotal bookingFee scheduledDate createdAt')
    .populate('farmer', 'name')
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
}

async function fetchOne(userId, id) {
  return UzhavarOrder.findOne({ _id: id, buyer: userId })
    .populate('farmer', 'name')
    .populate('items.product', 'images image photo')
    .lean();
}

function toCard(doc) {
  const card = baseCard(verticalKey, doc, {
    orderId:       doc.orderNumber,
    nativeStatus:  doc.status,
    paymentStatus: doc.paymentStatus,
    paymentMethod: doc.paymentMethod,
    itemCount:     (doc.items || []).length,
    totalAmount:   doc.grandTotal,
    deliveryDate:  doc.scheduledDate || doc.deliveredAt,
    placedAt:      doc.createdAt,
  });
  card.payFarmerOnDelivery = round(doc.balancePayableToFarmer ?? doc.subtotal);
  return card;
}

function toDetail(doc) {
  const card = toCard(doc);

  const itemsOrdered = (doc.items || []).map(it => itemRow(it, {
    unitPrice: it.pricePerUnit,
    lineTotal: it.lineTotal ?? (it.pricePerUnit || 0) * (it.quantity || 0),
  }));

  const cancelled = ['cancelled', 'auto_cancelled'].includes(doc.status);

  // Timeline synthesized from lifecycle timestamps
  const timeline = [
    timelineEvent('placed', 'Order Placed', doc.createdAt),
    doc.farmerAcceptedAt && timelineEvent('farmer_accepted', 'Farmer Accepted', doc.farmerAcceptedAt),
    doc.buyerConfirmedAt && timelineEvent('buyer_confirmed', 'You Confirmed', doc.buyerConfirmedAt),
    doc.deliveredAt      && timelineEvent('delivered', 'Delivered', doc.deliveredAt),
    doc.cancelledAt      && timelineEvent('cancelled',
      doc.status === 'auto_cancelled' ? 'Auto-Cancelled (Not Confirmed in Time)' : 'Cancelled',
      doc.cancelledAt,
      { description: doc.cancellationReason || null, actorRole: doc.cancelledBy || null }),
  ].filter(Boolean);

  return {
    ...card,
    seller:   doc.farmer ? { name: doc.farmer.name, type: 'farmer' } : null,
    customer: { name: doc.deliveryAddress?.name, phone: doc.deliveryAddress?.phone },
    address:  doc.deliveryAddress || null,
    delivery: {
      provider:      'farmer_direct',
      bookingType:   doc.bookingType || 'instant',
      scheduledDate: doc.scheduledDate || null,
      scheduledSlot: doc.scheduledSlot || null,
    },
    itemsOrdered,
    itemsDeclined:  [],
    itemsConfirmed: cancelled ? [] : itemsOrdered,
    timeline,
    paymentSummary: buildPaymentSummary(verticalKey, doc),
    refund: doc.paymentStatus === 'refunded'
      ? { status: 'processed', amount: round(doc.bookingFee?.total), method: 'razorpay', date: doc.cancelledAt || null, note: 'Booking fee refunded' }
      : null,
    walletHistory: [],
    documents: doc.invoiceUrl
      ? [{ type: 'tax', label: 'Invoice', number: null, generatedAt: null, url: doc.invoiceUrl, available: true, note: null }]
      : [],
    support: { ...SUPPORT_DEFAULT },
  };
}

module.exports = { verticalKey, fetchList, fetchOne, toCard, toDetail };
