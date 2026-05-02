// ============================================
// PAYOUT CALCULATOR
// ============================================
// Calculates the net payout owed to a seller for a delivered order.
//
// Formula:
//   grossAmount    = sum of (item.price × qty) for this seller's items (GST-inclusive)
//   gstAmount      = grossAmount - (grossAmount / (1 + gstRate/100))   ← GST goes to govt
//   baseAmount     = grossAmount - gstAmount                           ← seller's actual revenue
//   platformFee    = baseAmount × (platformFeeRate / 100)              ← Eptomart commission
//   shippingCost   = actual Shiprocket charge (stored in order.shiprocket.shippingCharge)
//   netPayout      = baseAmount - platformFee - shippingCost           ← amount sent to seller
//
// Note: GST is COLLECTED from the buyer and must be REMITTED to the government.
//       It is NOT part of the seller's profit. This is why we subtract it.
//       Failing to do this causes "GST positive / payout negative" bugs.
// ============================================

const Product = require('../models/Product');
const Seller  = require('../models/Seller');
const Order   = require('../models/Order');

// Default platform fee rate if not set on seller profile
const DEFAULT_PLATFORM_FEE_RATE = 10; // 10%

/**
 * Calculate payout for one order.
 * Works for single-seller orders (current model).
 * Returns a payout breakdown object ready to store on order.payout.
 *
 * @param {Object} order   - Mongoose Order doc (or lean object)
 * @returns {Object}       - { status, grossAmount, gstAmount, baseAmount, platformFee, shippingCost, netPayout, platformFeeRate, isNewSellerBonus, ... }
 */
const calculateOrderPayout = async (order) => {
  try {
    // ── 1. Find the seller for this order ───────────────────────────
    // We use the first item's seller (single-seller orders)
    let sellerDoc = null;
    let platformFeeRate = DEFAULT_PLATFORM_FEE_RATE;

    const firstProduct = await Product.findById(order.items?.[0]?.product)
      .populate('seller', 'defaultPlatformMargin businessName settlement')
      .lean();

    if (firstProduct?.seller) {
      sellerDoc       = firstProduct.seller;
      platformFeeRate = firstProduct.seller.defaultPlatformMargin ?? DEFAULT_PLATFORM_FEE_RATE;
    }

    // ── 2. Calculate gross (GST-inclusive total for all items) ───────
    // Use stored pricing.subtotal + pricing.tax = grossAmount
    // pricing.subtotal = base price total (ex-GST)
    // pricing.tax      = GST total
    // So grossAmount   = pricing.subtotal + pricing.tax (same as pricing.total - shipping)
    const pricing    = order.pricing || {};
    const subtotalExGst = parseFloat((pricing.subtotal || 0).toFixed(2));
    const gstAmount     = parseFloat((pricing.tax || 0).toFixed(2));
    const grossAmount   = parseFloat((subtotalExGst + gstAmount).toFixed(2));

    // Base amount = what seller actually earns before deductions (ex-GST)
    const baseAmount = subtotalExGst;

    // ── 3. Check if seller qualifies for first 20 orders bonus (no platform fee) ──
    // Rule: every seller's first 20 delivered orders are fee-free.
    // If seller can't be resolved (data issue), default to bonus = true (never charge in doubt).
    let isNewSellerBonus = true; // safe default — no charge if seller lookup fails
    if (sellerDoc?._id) {
      // Get all product IDs for this seller
      const sellerProducts = await Product.find({ seller: sellerDoc._id }).select('_id').lean();
      const productIds = sellerProducts.map(p => p._id);

      // Count delivered orders for this seller (excluding current order)
      const deliveredCount = await Order.countDocuments({
        'items.product': { $in: productIds },
        orderStatus: 'delivered',
        _id: { $ne: order._id },
      });

      // Bonus applies for first 20 delivered orders (orders 1–20 inclusive)
      isNewSellerBonus = deliveredCount < 20;

      console.log(
        `[Payout] Seller ${sellerDoc.businessName} — delivered orders so far: ${deliveredCount}` +
        ` | bonus: ${isNewSellerBonus ? 'YES (fee waived)' : 'NO (fee charged)'}`
      );
    } else {
      console.warn(`[Payout] Seller not found for order ${order.orderId} — applying new-seller bonus by default (no charge)`);
    }

    // ── 4. Platform fee on base (ex-GST) amount ──────────────────────
    // If new seller bonus applies, skip platform fee; otherwise calculate normally
    let platformFee = 0;
    if (!isNewSellerBonus) {
      platformFee = parseFloat((baseAmount * platformFeeRate / 100).toFixed(2));
    }

    // ── 5. Shipping cost = actual Shiprocket charge ──────────────────
    // Use admin-entered charge if set (most accurate), otherwise fall back to API/pricing value
    const shippingCost = parseFloat(
      (order.shiprocket?.adminShippingCharge ?? order.shiprocket?.shippingCharge ?? order.pricing?.shipping ?? 0).toFixed(2)
    );

    // ── 6. Net payout ───────────────────────────────────────────────
    const netPayout = parseFloat((baseAmount - platformFee - shippingCost).toFixed(2));

    console.log(
      `[Payout] Order ${order.orderId} | Gross: ₹${grossAmount} | GST: ₹${gstAmount}` +
      ` | Base: ₹${baseAmount} | Platform fee (${platformFeeRate}%): ₹${platformFee}${isNewSellerBonus ? ' [WAIVED - NEW SELLER]' : ''}` +
      ` | Shipping: ₹${shippingCost} | Net: ₹${netPayout}`
    );

    return {
      status:          netPayout > 0 ? 'calculated' : 'on_hold',
      grossAmount,
      gstAmount,
      baseAmount,
      platformFee,
      shippingCost,
      netPayout:       Math.max(0, netPayout), // never negative
      platformFeeRate,
      isNewSellerBonus,
      applyPlatformFee: !isNewSellerBonus, // If new seller bonus, don't apply fee
      calculatedAt:    new Date(),
      note:            netPayout < 0
        ? `Net payout was negative (₹${netPayout}) — shipping + platform fee exceeded base amount. Held for review.`
        : isNewSellerBonus
        ? 'First 20 orders bonus — platform fee waived'
        : null,
      sellerId:        sellerDoc?._id || null,
      sellerName:      sellerDoc?.businessName || null,
    };
  } catch (err) {
    console.error('[Payout] calculateOrderPayout error:', err.message);
    // Return safe fallback — don't crash order status update
    return {
      status:       'on_hold',
      grossAmount:  0,
      gstAmount:    0,
      baseAmount:   0,
      platformFee:  0,
      shippingCost: 0,
      netPayout:    0,
      platformFeeRate: DEFAULT_PLATFORM_FEE_RATE,
      calculatedAt: new Date(),
      note:         `Payout calculation failed: ${err.message}`,
    };
  }
};

/**
 * After calculating payout, update the seller's settlement.pendingAmount.
 * Call this only once per order (checks order.payout.status before adding).
 *
 * @param {Object} order      - Order doc with payout already calculated
 * @param {String} sellerId   - Seller _id
 * @param {Number} netPayout  - Amount to add to seller's pending balance
 */
const creditSellerSettlement = async (sellerId, netPayout) => {
  if (!sellerId || !netPayout || netPayout <= 0) return;
  try {
    await Seller.findByIdAndUpdate(sellerId, {
      $inc: { 'settlement.pendingAmount': netPayout },
      'settlement.status': 'pending',
    });
    console.log(`[Payout] Credited ₹${netPayout} to seller ${sellerId}`);
  } catch (err) {
    console.error('[Payout] creditSellerSettlement error:', err.message);
  }
};

module.exports = { calculateOrderPayout, creditSellerSettlement };
