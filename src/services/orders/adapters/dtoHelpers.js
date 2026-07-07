// ============================================
// SHARED DTO HELPERS for vertical order adapters
// ============================================
'use strict';

const { getVertical } = require('../../../config/verticals');
const { toCanonical, statusLabel, isActive } = require('../statusMap');

function round(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function verticalMeta(key) {
  const v = getVertical(key) || {};
  return { key, name: v.name, shortName: v.shortName, emoji: v.emoji, color: v.color, logo: v.logo };
}

/**
 * Base order card DTO. Adapters spread extra fields on top.
 */
function baseCard(verticalKey, doc, {
  orderId, nativeStatus, paymentStatus, paymentMethod,
  itemCount, totalAmount, deliveryDate, placedAt,
}) {
  const canonical = toCanonical(verticalKey, nativeStatus);
  return {
    id:           String(doc._id),
    vertical:     verticalKey,
    verticalMeta: verticalMeta(verticalKey),
    orderId,
    placedAt:     placedAt || doc.createdAt,
    status:       canonical,
    nativeStatus,
    statusLabel:  statusLabel(verticalKey, nativeStatus),
    isActive:     isActive(canonical),
    paymentStatus: paymentStatus || 'pending',
    paymentMethod: paymentMethod || null,
    itemCount:    itemCount || 0,
    totalAmount:  round(totalAmount),
    deliveryDate: deliveryDate || null,
    detailUrl:    `/orders/${verticalKey}/${String(doc._id)}`,
  };
}

/** Canonical timeline event. */
function timelineEvent(event, label, timestamp, { description, actorRole, meta } = {}) {
  return {
    event,
    label,
    timestamp: timestamp || null,
    description: description || null,
    actorRole:   actorRole || null,
    meta:        meta || null,
  };
}

/** Convert a statusHistory array into canonical timeline events. */
function timelineFromStatusHistory(verticalKey, statusHistory = []) {
  return statusHistory
    .filter(h => h && h.status)
    .map(h => timelineEvent(
      h.status,
      statusLabel(verticalKey, h.status),
      h.timestamp,
      { description: h.note || null, actorRole: typeof h.updatedBy === 'string' ? h.updatedBy : null },
    ));
}

/** Canonical item row. */
function itemRow(it, { name, image, quantity, unit, unitPrice, lineTotal, declinedQty, refundAmount, reason, variantLabel, gradeName, gradeKey } = {}) {
  return {
    productId:  it.product ? String(it.product._id || it.product) : null,
    name:       name ?? it.name ?? it.productName ?? '',
    image:      image ?? it.image ?? null,
    unit:       unit ?? it.unit ?? null,
    variantLabel: variantLabel ?? it.variantLabel ?? null,
    // Grade fields — populated for koyambedu graded products
    gradeName:  gradeName ?? it.gradeName ?? null,
    gradeKey:   gradeKey  ?? it.gradeKey  ?? null,
    quantity:   Number(quantity ?? it.quantity ?? 0),
    unitPrice:  round(unitPrice),
    lineTotal:  round(lineTotal),
    declinedQty:  declinedQty != null ? Number(declinedQty) : undefined,
    refundAmount: refundAmount != null ? round(refundAmount) : undefined,
    reason:       reason || undefined,
  };
}

/** Canonical refund block. */
function refundBlock(r = {}) {
  if (!r || (!r.status && !r.amount)) return null;
  return {
    status: r.status || 'not_applicable',
    amount: round(r.amount || 0),
    method: r.method || null,
    date:   r.processedAt || r.completedAt || r.initiatedAt || null,
    note:   r.note || r.reason || null,
  };
}

/** Canonical document row (only include documents that exist). */
function documentRow(type, label, { number, generatedAt, url, available = true, note } = {}) {
  return { type, label, number: number || null, generatedAt: generatedAt || null, url: url || null, available, note: note || null };
}

const SUPPORT_DEFAULT = {
  supportPhone: '+91 6369 129 995',
  supportEmail: 'support@eptomart.com',
  raiseIssueUrl: '/contact',
};

module.exports = {
  round, verticalMeta, baseCard, timelineEvent, timelineFromStatusHistory,
  itemRow, refundBlock, documentRow, SUPPORT_DEFAULT,
};
