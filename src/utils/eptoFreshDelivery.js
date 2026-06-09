// ============================================
// EPTOFRESH DELIVERY CHARGE CALCULATOR
// ============================================

/**
 * Calculate delivery charge based on distance and order amount.
 *
 * FREE DELIVERY:
 *   Order >= freeDeliveryThreshold (₹1049) AND distance <= freeDeliveryDistanceLimit (10km) → FREE
 *
 * HIGH VALUE ORDERS (>= ₹1049) beyond 10km:
 *   ₹50 for every 2km (or part thereof) beyond 10km
 *   Examples: 11km=₹50, 12km=₹50, 13km=₹100, 15km=₹150, 18km=₹200, 22km=₹300, 30km=₹500
 *
 * STANDARD ORDERS (< ₹1049):
 *   0-6km   → ₹49
 *   6-10km  → ₹149
 *   10-12km → ₹199
 *   >12km   → ₹199 + ₹50 for every 3km (or part) beyond 12km
 *
 * MANDATORY CONSENT: order >= ₹1049 AND distance > 10km → requiresConsent = true
 *
 * @param {number} distanceKm
 * @param {number} orderAmount
 * @param {object} config  - admin-overridable settings
 */
function calculateDeliveryCharge(distanceKm, orderAmount, config = {}) {
  const {
    freeDeliveryThreshold      = 1049,
    freeDeliveryDistanceLimit  = 10,
    highValueSurchargePerSlab  = 50,
    highValueSlabSizeKm        = 2,
    standardSurchargePerSlab   = 50,
    standardSlabSizeKm         = 3,
    standardBaseBeyond12km     = 199,
    maxServiceableDistance     = 0, // 0 = unlimited
  } = config;

  const dist      = parseFloat(distanceKm) || 0;
  const amt       = parseFloat(orderAmount) || 0;
  const isHighVal = amt >= freeDeliveryThreshold;
  const isLong    = dist > freeDeliveryDistanceLimit;   // > 10km

  // Max distance check
  if (maxServiceableDistance > 0 && dist > maxServiceableDistance) {
    return {
      charge: 0,
      isFreeDelivery: false,
      requiresConsent: false,
      isLongDistance: true,
      serviceable: false,
      warning: `Delivery not available beyond ${maxServiceableDistance} km`,
      distanceKm: dist,
      orderAmount: amt,
    };
  }

  let charge = 0;
  let isFreeDelivery = false;

  if (isHighVal) {
    if (!isLong) {
      // FREE — high value within 10km
      charge = 0;
      isFreeDelivery = true;
    } else {
      // Long-distance surcharge for high value orders
      const beyondKm = dist - freeDeliveryDistanceLimit;
      const slabs    = Math.ceil(beyondKm / highValueSlabSizeKm);
      charge = slabs * highValueSurchargePerSlab;
    }
  } else {
    // Standard orders
    if (dist <= 6) {
      charge = 49;
    } else if (dist <= 10) {
      charge = 149;
    } else if (dist <= 12) {
      charge = standardBaseBeyond12km;
    } else {
      const beyondKm = dist - 12;
      const slabs    = Math.ceil(beyondKm / standardSlabSizeKm);
      charge = standardBaseBeyond12km + slabs * standardSurchargePerSlab;
    }
  }

  // Mandatory consent warning (high value + long distance)
  const requiresConsent = isHighVal && isLong;

  const warning = isLong
    ? (isHighVal
        ? 'Long distance delivery charges apply. Free delivery is not available beyond 10 km.'
        : 'Seller is farther than 10 km. Additional delivery charges apply.')
    : null;

  return {
    charge,
    isFreeDelivery,
    requiresConsent,   // must show warning popup + checkbox
    isLongDistance: isLong,
    serviceable: true,
    warning,
    distanceKm: dist,
    orderAmount: amt,
  };
}

/**
 * Haversine distance between two GPS coordinates (km)
 */
function haversineDistance(lat1, lng1, lat2, lng2) {
  const R    = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a    =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return parseFloat((R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))).toFixed(2));
}

function toRad(deg) { return deg * (Math.PI / 180); }

/**
 * Calculate platform fee and seller payout
 * Platform Fee: commissionRate% + 18% GST on fee
 */
function calculatePayout(orderAmount, commissionRate = 10) {
  const platformFee    = parseFloat(((orderAmount * commissionRate) / 100).toFixed(2));
  const gstOnFee       = parseFloat(((platformFee * 18) / 100).toFixed(2));
  const totalDeduction = parseFloat((platformFee + gstOnFee).toFixed(2));
  const sellerReceives = parseFloat((orderAmount - totalDeduction).toFixed(2));
  return { orderAmount, platformFee, gstOnFee, totalDeduction, sellerReceives };
}

module.exports = { calculateDeliveryCharge, haversineDistance, calculatePayout };
