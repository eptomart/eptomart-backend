// ============================================
// CANONICAL ORDER STATUS MAP
// Maps every vertical's native status enum onto
// one shared vocabulary used by the unified
// Orders API, cards, and timeline.
// ============================================
'use strict';

// Canonical statuses in lifecycle order
const CANONICAL = [
  'payment_pending',
  'placed',
  'seller_review',              // seller/farmer/SA reviewing the order
  'changes_pending_approval',   // SA changes awaiting Super Admin
  'confirmed',
  'packing',
  'packed',
  'out_for_delivery',
  'delivered',
  'cancelled',
  'returned',
  'refund_processing',
  'refunded',
];

const CANONICAL_LABELS = {
  payment_pending:          'Payment Pending',
  placed:                   'Order Placed',
  seller_review:            'Seller Reviewing',
  changes_pending_approval: 'Changes Under Approval',
  confirmed:                'Confirmed',
  packing:                  'Packing',
  packed:                   'Packed',
  out_for_delivery:         'Out for Delivery',
  delivered:                'Delivered',
  cancelled:                'Cancelled',
  returned:                 'Returned',
  refund_processing:        'Refund Processing',
  refunded:                 'Refunded',
};

// Statuses considered "active" (order still in progress)
const ACTIVE_STATUSES = [
  'payment_pending', 'placed', 'seller_review', 'changes_pending_approval',
  'confirmed', 'packing', 'packed', 'out_for_delivery',
];

// ── Per-vertical native → canonical maps ─────
const MAPS = {
  eptomart: {
    placed:              'placed',
    confirmed:           'confirmed',
    processing:          'packing',
    shipped:             'out_for_delivery',
    partially_delivered: 'out_for_delivery',
    delivered:           'delivered',
    cancelled:           'cancelled',
    returned:            'returned',
  },

  koyambedu: {
    placed:                 'placed',
    pending_confirmation:   'seller_review',
    sa_review_submitted:    'changes_pending_approval',
    price_revision_pending: 'changes_pending_approval',
    confirmed:              'confirmed',
    packing:                'packing',
    dispatched:             'out_for_delivery',
    delivered:              'delivered',
    cancelled:              'cancelled',
    refund_initiated:       'refund_processing',
  },

  eptofresh: {
    payment_pending:  'payment_pending',
    placed:           'placed',
    accepted:         'confirmed',
    rejected:         'cancelled',
    preparing:        'packing',
    packed:           'packed',
    admin_approved:   'packed',
    porter_assigned:  'out_for_delivery',
    picked_up:        'out_for_delivery',
    out_for_delivery: 'out_for_delivery',
    delivered:        'delivered',
    cancelled:        'cancelled',
    refund_initiated: 'refund_processing',
    refunded:         'refunded',
  },

  uzhavar: {
    payment_pending: 'payment_pending',
    pending_farmer:  'seller_review',
    farmer_accepted: 'confirmed',
    buyer_confirmed: 'confirmed',
    out_for_delivery:'out_for_delivery',
    delivered:       'delivered',
    cancelled:       'cancelled',
    auto_cancelled:  'cancelled',
  },
};

// Native-status label overrides (where canonical label is misleading)
const NATIVE_LABEL_OVERRIDES = {
  eptofresh: {
    accepted:        'Seller Accepted',
    admin_approved:  'Packed — Awaiting Pickup',
    porter_assigned: 'Driver Assigned',
    picked_up:       'Picked Up',
    rejected:        'Declined by Seller',
  },
  uzhavar: {
    pending_farmer:  'Waiting for Farmer',
    farmer_accepted: 'Farmer Accepted — Confirm Now',
    buyer_confirmed: 'Confirmed',
    auto_cancelled:  'Cancelled (Not Confirmed in Time)',
  },
  koyambedu: {
    dispatched: 'On the Way',
  },
};

/**
 * Map a native status to canonical.
 * Unknown statuses pass through unchanged (never throw).
 */
function toCanonical(verticalKey, nativeStatus) {
  return (MAPS[verticalKey] && MAPS[verticalKey][nativeStatus]) || nativeStatus || 'placed';
}

/** Human label for a status (native override → canonical label → raw). */
function statusLabel(verticalKey, nativeStatus) {
  const override = NATIVE_LABEL_OVERRIDES[verticalKey]?.[nativeStatus];
  if (override) return override;
  const canonical = toCanonical(verticalKey, nativeStatus);
  return CANONICAL_LABELS[canonical] || nativeStatus;
}

function isActive(canonicalStatus) {
  return ACTIVE_STATUSES.includes(canonicalStatus);
}

module.exports = {
  CANONICAL, CANONICAL_LABELS, ACTIVE_STATUSES, MAPS,
  toCanonical, statusLabel, isActive,
};
