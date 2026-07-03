// ============================================
// EPTOMART (parent app) ORDER ADAPTER
// Order model → canonical OrderDTO
// ============================================
'use strict';

const Order = require('../../../models/Order');
const { buildPaymentSummary } = require('../../../utils/orderCalculationService');
const {
  baseCard, timelineFromStatusHistory, timelineEvent, itemRow,
  refundBlock, documentRow, SUPPORT_DEFAULT, round,
} = require('./dtoHelpers');

const verticalKey = 'eptomart';

async function fetchList(userId, { limit = 50, from, to } = {}) {
  const query = { user: userId };
  if (from || to) {
    query.createdAt = {};
    if (from) query.createdAt.$gte = from;
    if (to)   query.createdAt.$lte = to;
  }
  return Order.find(query)
    .select('orderId orderStatus paymentStatus paymentMethod pricing items.name items.quantity estimatedDelivery createdAt refund.status invoice')
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
}

async function fetchOne(userId, id) {
  return Order.findOne({ _id: id, user: userId })
    .populate('invoice', 'invoiceNumber generatedAt')
    .lean();
}

function toCard(doc) {
  return baseCard(verticalKey, doc, {
    orderId:       doc.orderId,
    nativeStatus:  doc.orderStatus,
    paymentStatus: doc.paymentStatus,
    paymentMethod: doc.paymentMethod,
    itemCount:     (doc.items || []).reduce((s, it) => s + (it.quantity || 0), 0),
    totalAmount:   doc.pricing?.total,
    deliveryDate:  doc.estimatedDelivery,
    placedAt:      doc.createdAt,
  });
}

function toDetail(doc) {
  const card = toCard(doc);

  const itemsOrdered = (doc.items || []).map(it => itemRow(it, {
    unitPrice: it.price,
    lineTotal: (it.price || 0) * (it.quantity || 0),
  }));

  const itemsDeclined = (doc.items || [])
    .filter(it => it.itemStatus === 'cancelled')
    .map(it => itemRow(it, {
      unitPrice:    it.price,
      lineTotal:    0,
      declinedQty:  it.quantity,
      refundAmount: (it.price || 0) * (it.quantity || 0),
      reason:       'unavailable',
    }));

  const itemsConfirmed = (doc.items || [])
    .filter(it => it.itemStatus !== 'cancelled')
    .map(it => itemRow(it, {
      unitPrice: it.price,
      lineTotal: (it.price || 0) * (it.quantity || 0),
    }));

  // Timeline from statusHistory (+ invoice event)
  const timeline = timelineFromStatusHistory(verticalKey, doc.statusHistory);
  if (doc.invoice?.generatedAt) {
    timeline.push(timelineEvent('invoice_generated', 'Invoice Generated', doc.invoice.generatedAt));
  }

  // Documents — tax invoice only (COD: available after delivery)
  const documents = [];
  if (doc.invoice) {
    const codPending = doc.paymentMethod === 'cod' && doc.orderStatus !== 'delivered';
    documents.push(documentRow('tax', 'Tax Invoice', {
      number:      doc.invoice.invoiceNumber,
      generatedAt: doc.invoice.generatedAt,
      url:         `/api/invoices/${doc.invoice._id}/download`,
      available:   !codPending,
      note:        codPending ? 'Available after delivery' : null,
    }));
  }

  return {
    ...card,
    seller: doc.sellerPickup?.sellerName
      ? { name: doc.sellerPickup.sellerName }
      : (doc.sellerBreakdown?.length ? { name: doc.sellerBreakdown.map(s => s.sellerName).filter(Boolean).join(', ') } : null),
    customer: { name: doc.shippingAddress?.fullName, phone: doc.shippingAddress?.phone },
    address:  doc.shippingAddress || null,
    delivery: {
      provider:    'shiprocket',
      partner:     doc.shiprocket?.courier || doc.deliveryPartner || null,
      trackingId:  doc.shiprocket?.awb || doc.trackingNumber || null,
      trackingUrl: doc.shiprocket?.trackingUrl || null,
      estimatedDelivery: doc.estimatedDelivery || null,
    },
    itemsOrdered,
    itemsDeclined,
    itemsConfirmed,
    timeline,
    paymentSummary: buildPaymentSummary(verticalKey, doc),
    gstBreakdown:   doc.gstBreakdown || null,
    refund:         refundBlock(doc.refund),
    walletHistory:  [],
    documents,
    support: { ...SUPPORT_DEFAULT },
  };
}

module.exports = { verticalKey, fetchList, fetchOne, toCard, toDetail };
