// ============================================
// EPTOFRESH PROTEINS ORDER ADAPTER
// EptoFreshOrder model → canonical OrderDTO
// Privacy: seller phone / driver phone never exposed.
// ============================================
'use strict';

const EptoFreshOrder  = require('../../../models/EptoFreshOrder');
const EptoFreshWallet = require('../../../models/EptoFreshWallet');
const { buildPaymentSummary } = require('../../../utils/orderCalculationService');
const {
  baseCard, timelineFromStatusHistory, timelineEvent, itemRow,
  refundBlock, SUPPORT_DEFAULT, round,
} = require('./dtoHelpers');

const verticalKey = 'eptofresh';

const CUSTOMER_SAFE_DESELECT =
  '-deliveryOtp -porter.driverPhone -porter.webhookEvents';

async function fetchList(userId, { limit = 50, from, to } = {}) {
  const query = { buyer: userId, orderStatus: { $ne: 'payment_pending' } };
  if (from || to) {
    query.createdAt = {};
    if (from) query.createdAt.$gte = from;
    if (to)   query.createdAt.$lte = to;
  }
  return EptoFreshOrder.find(query)
    .select('orderId orderStatus paymentStatus paymentMethod pricing items.productName items.quantity porter.estimatedDelivery createdAt placedAt refund.status')
    .populate('seller', 'shopName')
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
}

async function fetchOne(userId, id) {
  return EptoFreshOrder.findOne({ _id: id, buyer: userId })
    .select(CUSTOMER_SAFE_DESELECT)
    .populate('seller', 'shopName shopImage rating')
    .populate('items.product', 'name images')
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
    deliveryDate:  doc.porter?.estimatedDelivery || doc.deliveredAt,
    placedAt:      doc.placedAt || doc.createdAt,
  });
}

function toDetail(doc, { walletHistory = [] } = {}) {
  const card = toCard(doc);
  const rejected = ['rejected', 'cancelled'].includes(doc.orderStatus);

  const mapItem = it => itemRow(it, {
    name:      it.productName,
    image:     it.product?.images?.[0] || null,
    unitPrice: it.unitPrice ?? it.variant?.price,
    lineTotal: it.totalPrice ?? (it.unitPrice || 0) * (it.quantity || 0),
    variantLabel: [it.variant?.label, it.cutType].filter(Boolean).join(' · ') || null,
  });

  const itemsOrdered = (doc.items || []).map(mapItem);

  // EptoFresh Proteins is accept/reject only — a rejection declines the whole order
  const itemsDeclined = rejected
    ? (doc.items || []).map(it => ({
        ...mapItem(it),
        declinedQty:  it.quantity,
        refundAmount: it.totalPrice ?? (it.unitPrice || 0) * (it.quantity || 0),
        reason: doc.sellerAction?.rejectReason || doc.cancelReason || 'unavailable',
      }))
    : [];

  const itemsConfirmed = rejected ? [] : itemsOrdered;

  const timeline = timelineFromStatusHistory(verticalKey, doc.statusHistory);
  if (!timeline.length) {
    timeline.push(timelineEvent('placed', 'Order Placed', doc.placedAt || doc.createdAt));
    if (doc.deliveredAt) timeline.push(timelineEvent('delivered', 'Delivered', doc.deliveredAt));
  }

  return {
    ...card,
    seller:   doc.seller ? { name: doc.seller.shopName, image: doc.seller.shopImage || null, rating: doc.seller.rating || null } : null,
    customer: { name: doc.shippingAddress?.fullName, phone: doc.shippingAddress?.phone },
    address:  doc.shippingAddress || null,
    delivery: {
      provider:    'porter',
      partner:     doc.porter?.driverName ? `Porter — ${doc.porter.driverName}` : 'Porter',
      trackingUrl: doc.porter?.trackingUrl || null,
      estimatedDelivery: doc.porter?.estimatedDelivery || null,
      otpVerified: !!doc.deliveryOtpVerified,
    },
    itemsOrdered,
    itemsDeclined,
    itemsConfirmed,
    timeline,
    paymentSummary: buildPaymentSummary(verticalKey, doc),
    refund:         refundBlock(doc.refund),
    walletHistory,
    documents: [],   // invoices arrive in Stage C
    support: {
      ...SUPPORT_DEFAULT,
      complaint: doc.complaint?.filed ? { status: doc.complaint.status, filedAt: doc.complaint.filedAt } : null,
    },
  };
}

/** Wallet transactions relating to this order. */
async function fetchWalletHistory(userId, doc) {
  const wallet = await EptoFreshWallet.findOne({ user: userId }).select('transactions').lean();
  if (!wallet) return [];
  return (wallet.transactions || [])
    .filter(t => String(t.order || '') === String(doc._id))
    .map(t => ({
      type: t.type, amount: round(t.amount), reason: t.description || null,
      reference: doc.orderId, note: null, date: t.createdAt,
    }));
}

module.exports = { verticalKey, fetchList, fetchOne, toCard, toDetail, fetchWalletHistory };
