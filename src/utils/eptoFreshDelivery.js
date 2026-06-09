// ============================================
// EPTOFRESH DELIVERY CHARGE CALCULATOR
// Rules as specified in EptoFresh Proteins spec
// ============================================

/**
 * Calculate delivery charge and warnings based on distance and order amount
 *
 * Rules:
 *  - Order >= ₹1049               → FREE
 *  - Distance <= 6km              → ₹49
 *  - 6km < distance <= 10km       → ₹149
 *  - 10km < distance <= 15km      → ₹199
 *  - distance > 15km              → NOT serviceable (or require confirmation)
 *  - Order > ₹1000 (but < ₹1049) → reduce calculated charge by ₹50
 *
 * Warnings:
 *  - distance > 10km: freshness warning
 *  - distance > 15km: strong warning requiring confirmation
 */
function calculateDeliveryCharge(distanceKm, orderAmount) {
  const dist = parseFloat(distanceKm) || 0;
  const amt  = parseFloat(orderAmount) || 0;

  let charge = 0;
  let warning = null;
  let requiresConfirmation = false;
  let serviceable = true;

  // Free delivery threshold
  if (amt >= 1049) {
    charge = 0;
  } else {
    // Distance-based charge
    if (dist <= 6) {
      charge = 49;
    } else if (dist <= 10) {
      charge = 149;
    } else if (dist <= 15) {
      charge = 199;
    } else {
      // Beyond 15km — flag but allow with confirmation
      charge = 249;
      serviceable = false; // admin can override
    }

    // ₹50 discount if order > ₹1000 (but still under ₹1049)
    if (amt > 1000) {
      charge = Math.max(0, charge - 50);
    }
  }

  // Distance warnings
  if (dist > 15) {
    warning = 'This seller is very far away (>15 km). Freshness and delivery time will be significantly affected. Do you still want to proceed?';
    requiresConfirmation = true;
  } else if (dist > 10) {
    warning = 'Seller is located farther away. Product freshness and delivery time may be affected.';
  }

  return {
    charge,
    warning,
    requiresConfirmation,
    serviceable: dist <= 15,
    distanceKm: dist,
    isFreeDelivery: charge === 0,
  };
}

/**
 * Calculate haversine distance between two GPS coordinates (km)
 */
function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 6371; // Earth radius in km
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return parseFloat((R * c).toFixed(2));
}

function toRad(deg) {
  return deg * (Math.PI / 180);
}

/**
 * Calculate platform fee and seller payout
 * Platform Fee: 10%
 * GST on Fee: 18%
 * Seller receives: orderAmount - platformFee - gstOnFee
 */
function calculatePayout(orderAmount, commissionRate = 10) {
  const platformFee    = parseFloat(((orderAmount * commissionRate) / 100).toFixed(2));
  const gstOnFee       = parseFloat(((platformFee * 18) / 100).toFixed(2));
  const totalDeduction = parseFloat((platformFee + gstOnFee).toFixed(2));
  const sellerReceives = parseFloat((orderAmount - totalDeduction).toFixed(2));

  return { orderAmount, platformFee, gstOnFee, totalDeduction, sellerReceives };
}

module.exports = { calculateDeliveryCharge, haversineDistance, calculatePayout };
