// ============================================
// SMOKE TEST — Stage B (permissions + integrity)
// Run: node src/scripts/testStageB.js
// ============================================
'use strict';

const assert = require('assert');
const { can, requireOrderPermission, MATRIX } = require('../middleware/orderPermissions');
const { addTimeline, addAudit, snapshotItemsOrdered } = require('../utils/orderAudit');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); failed++; }
}

// ── Permission matrix ────────────────────────
console.log('permission matrix');
test('only superAdmin can cancel orders', () => {
  assert.equal(can('superAdmin', 'cancel_order'), true);
  assert.equal(can('admin',      'cancel_order'), false);
  assert.equal(can('seller',     'cancel_order'), false);
  assert.equal(can('user',       'cancel_order'), false);
});
test('only superAdmin can approve/initiate refunds, credit wallet, gateway refund', () => {
  for (const action of ['approve_refund', 'initiate_refund', 'credit_wallet', 'gateway_refund', 'override_seller']) {
    assert.equal(can('superAdmin', action), true,  `superAdmin should have ${action}`);
    assert.equal(can('seller', action),     false, `seller must NOT have ${action}`);
    assert.equal(can('user', action),       false, `user must NOT have ${action}`);
  }
});
test('seller can accept/reduce/decline but customer cannot', () => {
  for (const action of ['accept_order', 'reduce_quantity', 'decline_item']) {
    assert.equal(can('seller', action), true);
    assert.equal(can('user', action),   false);
  }
});
test('seller can VIEW refund calculations', () =>
  assert.equal(can('seller', 'view_refund_calculation'), true));
test('customer can track, download documents, view refund status', () => {
  for (const action of ['track_order', 'download_documents', 'view_refund_status']) {
    assert.equal(can('user', action), true);
  }
});

// ── Middleware behavior ──────────────────────
console.log('middleware');
function runMiddleware(role, action) {
  const req = { user: role ? { role } : null };
  let statusCode = null, body = null, nextCalled = false;
  const res = { status(c) { statusCode = c; return this; }, json(b) { body = b; } };
  requireOrderPermission(action)(req, res, () => { nextCalled = true; });
  return { statusCode, body, nextCalled };
}
test('customer cancel → 403 with friendly support message', () => {
  const r = runMiddleware('user', 'cancel_order');
  assert.equal(r.statusCode, 403);
  assert.ok(r.body.message.includes('customer support'));
  assert.equal(r.body.code, 'ORDER_PERMISSION_DENIED');
});
test('superAdmin cancel → passes through', () => {
  const r = runMiddleware('superAdmin', 'cancel_order');
  assert.equal(r.nextCalled, true);
});
test('unauthenticated → 401', () => {
  const r = runMiddleware(null, 'cancel_order');
  assert.equal(r.statusCode, 401);
});

// ── Audit helpers ────────────────────────────
console.log('audit helpers');
test('addTimeline / addAudit append and never overwrite', () => {
  const order = { timeline: [], auditLog: [] };
  addTimeline(order, 'order_placed', 'Order placed', { role: 'customer' });
  addTimeline(order, 'order_cancelled', 'Cancelled', { role: 'super_admin' });
  addAudit(order, { action: 'order_cancelled', actorRole: 'super_admin', previousValue: 'placed', newValue: 'cancelled' });
  assert.equal(order.timeline.length, 2);
  assert.equal(order.timeline[0].event, 'order_placed'); // original untouched
  assert.equal(order.auditLog.length, 1);
  assert.equal(order.auditLog[0].previousValue, 'placed');
});
test('helpers no-op safely on legacy orders without fields', () => {
  const legacy = {};
  addTimeline(legacy, 'x', 'y');
  addAudit(legacy, { action: 'x' });
  assert.equal(legacy.timeline, undefined);
  assert.equal(legacy.auditLog, undefined);
});
test('snapshotItemsOrdered runs once, never re-snapshots', () => {
  const order = {
    itemsOrdered: [],
    items: [{ product: 'p1', name: 'Tomato', quantity: 5, price: 40 }],
  };
  snapshotItemsOrdered(order);
  assert.equal(order.itemsOrdered.length, 1);
  assert.equal(order.itemsOrdered[0].orderedQty, 5);
  assert.equal(order.itemsOrdered[0].lineTotal, 200);
  // Mutate working items then try again — snapshot must not change
  order.items[0].quantity = 3;
  snapshotItemsOrdered(order);
  assert.equal(order.itemsOrdered[0].orderedQty, 5);
});

// ── Model schema fields present ──────────────
console.log('model schemas');
test('Order/EptoFreshOrder/UzhavarOrder have itemsOrdered + auditLog', () => {
  const Order          = require('../models/Order');
  const EptoFreshOrder = require('../models/EptoFreshOrder');
  const UzhavarOrder   = require('../models/UzhavarOrder');
  for (const M of [Order, EptoFreshOrder, UzhavarOrder]) {
    assert.ok(M.schema.path('itemsOrdered'), `${M.modelName} missing itemsOrdered`);
    assert.ok(M.schema.path('auditLog'),     `${M.modelName} missing auditLog`);
  }
  assert.ok(Order.schema.path('timeline'), 'Order missing timeline');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
