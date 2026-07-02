// ============================================
// ORDER PERMISSION MATRIX — single source of truth
// for who may do what on any order, in any vertical.
//
//   Super Admin : cancel orders, approve/initiate refunds,
//                 credit wallet, gateway refunds, override seller
//   Admin       : view & coordinate (no cancel/refund powers)
//   Seller /
//   Seller Admin: accept orders, reduce quantity, decline products,
//                 VIEW refund calculations only
//   Customer    : track orders, download documents, view refund status
// ============================================
'use strict';

// action → roles allowed (User.role values)
const MATRIX = {
  // ── Super Admin exclusive ──────────────────
  cancel_order:            ['superAdmin'],
  approve_refund:          ['superAdmin'],
  initiate_refund:         ['superAdmin'],
  credit_wallet:           ['superAdmin'],
  gateway_refund:          ['superAdmin'],
  override_seller:         ['superAdmin'],
  approve_order_changes:   ['superAdmin'],
  mark_delivered:          ['superAdmin', 'admin'],

  // ── Seller / Seller Admin ──────────────────
  accept_order:            ['seller', 'superAdmin'],
  reduce_quantity:         ['seller', 'superAdmin'],
  decline_item:            ['seller', 'superAdmin'],
  view_refund_calculation: ['seller', 'admin', 'superAdmin'],

  // ── Customer ───────────────────────────────
  track_order:             ['user', 'seller', 'admin', 'superAdmin'],
  download_documents:      ['user', 'seller', 'admin', 'superAdmin'],
  view_refund_status:      ['user', 'seller', 'admin', 'superAdmin'],
};

// Friendly denial messages for customer-facing actions
const DENIAL_MESSAGES = {
  cancel_order:
    'Orders can no longer be cancelled directly. Please contact customer support and we will arrange the cancellation and refund for you.',
  initiate_refund:
    'Refunds are processed by our team. You can view your refund status on the order page.',
};

/** Pure check — usable outside Express too. */
function can(role, action) {
  const allowed = MATRIX[action];
  return Array.isArray(allowed) && allowed.includes(role);
}

/**
 * Express middleware factory.
 * Usage: router.put('/:id/cancel', protect, requireOrderPermission('cancel_order'), handler)
 */
function requireOrderPermission(action) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Not authenticated' });
    }
    if (!can(req.user.role, action)) {
      return res.status(403).json({
        success: false,
        code:    'ORDER_PERMISSION_DENIED',
        action,
        message: DENIAL_MESSAGES[action] || 'You do not have permission to perform this action.',
      });
    }
    next();
  };
}

module.exports = { MATRIX, can, requireOrderPermission };
