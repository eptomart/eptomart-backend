// ============================================
// ORDER AUDIT HELPERS — append-only history for
// any order model that has timeline[]/auditLog[].
// Never overwrites; silently no-ops if the order
// schema lacks the fields (legacy safety).
// ============================================
'use strict';

/**
 * Append a customer-visible timeline event.
 * @param {Object} order  - mongoose document
 * @param {String} event  - machine event key e.g. 'order_cancelled'
 * @param {String} description
 * @param {Object} actor  - { role, userId, name }
 * @param {Object} meta
 */
function addTimeline(order, event, description, actor = {}, meta = null) {
  if (!order || !Array.isArray(order.timeline)) return;
  order.timeline.push({
    event,
    description: description || null,
    actor: {
      role:   actor.role || 'system',
      userId: actor.userId || null,
      name:   actor.name || null,
    },
    meta,
    timestamp: new Date(),
  });
}

/**
 * Append an internal audit-log entry.
 * @param {Object} order - mongoose document
 * @param {Object} entry - { action, actorRole, actorId, previousValue,
 *                           newValue, amount, refundMethod, notes }
 */
function addAudit(order, entry = {}) {
  if (!order || !Array.isArray(order.auditLog)) return;
  order.auditLog.push({
    action:        entry.action,
    actorRole:     entry.actorRole || 'system',
    actorId:       entry.actorId || null,
    previousValue: entry.previousValue ?? null,
    newValue:      entry.newValue ?? null,
    amount:        entry.amount ?? null,
    refundMethod:  entry.refundMethod || null,
    notes:         entry.notes || null,
    timestamp:     new Date(),
  });
}

/**
 * Snapshot the customer's original order into itemsOrdered.
 * Call ONCE at order placement. No-op if already snapshotted
 * or the schema lacks the field.
 */
function snapshotItemsOrdered(order, mapItem) {
  if (!order || !Array.isArray(order.itemsOrdered)) return;
  if (order.itemsOrdered.length > 0) return; // immutable — never re-snapshot
  const items = order.items || [];
  for (const it of items) {
    order.itemsOrdered.push(mapItem ? mapItem(it) : {
      product:    it.product,
      name:       it.name || it.productName,
      unit:       it.unit || null,
      orderedQty: it.quantity ?? it.orderedQty ?? 0,
      unitPrice:  it.price ?? it.unitPrice ?? it.pricePerUnit ?? 0,
      lineTotal:  (it.quantity ?? 0) * (it.price ?? it.unitPrice ?? it.pricePerUnit ?? 0),
    });
  }
}

module.exports = { addTimeline, addAudit, snapshotItemsOrdered };
