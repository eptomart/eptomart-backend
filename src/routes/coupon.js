// ============================================
// UNIVERSAL COUPON — Routes
// Base: /api/coupon
// Works across Koyambedu, Uzhavar & EptoFresh
// ============================================
const express = require('express');
const router  = express.Router();
const { optionalAuth } = require('../middleware/auth');
const EptoFreshCoupon  = require('../models/EptoFreshCoupon');

/**
 * POST /api/coupon/validate
 * Body: { code, orderAmount }
 * orderAmount = subtotal + GST (shipping excluded, as per promo rules)
 */
router.post('/validate', optionalAuth, async (req, res) => {
  try {
    const { code, orderAmount } = req.body;
    if (!code) return res.status(400).json({ success: false, message: 'Coupon code is required' });

    const coupon = await EptoFreshCoupon.findOne({
      code:          code.toUpperCase().trim(),
      isActive:      true,
      requestStatus: { $in: ['admin_created', 'approved'] },
      validFrom:     { $lte: new Date() },
      validTo:       { $gte: new Date() },
    });

    if (!coupon) {
      return res.status(404).json({ success: false, message: 'Invalid or expired coupon code' });
    }
    if (coupon.usedCount >= coupon.maxUsage) {
      return res.status(400).json({ success: false, message: 'This coupon has reached its usage limit' });
    }

    const amount = parseFloat(orderAmount) || 0;
    if (amount < coupon.minOrderValue) {
      return res.status(400).json({
        success: false,
        message: `Minimum order ₹${coupon.minOrderValue} required for this coupon`,
      });
    }

    let discount = 0;
    if (coupon.discountType === 'flat') {
      discount = Math.min(coupon.discountValue, amount);
    } else {
      // percent — shipping is excluded (applied on subtotal+GST only)
      discount = (amount * coupon.discountValue) / 100;
      if (coupon.maxDiscount) discount = Math.min(discount, coupon.maxDiscount);
    }
    discount = parseFloat(discount.toFixed(2));

    res.json({
      success:  true,
      discount,
      coupon: {
        code:          coupon.code,
        description:   coupon.description || '',
        discountType:  coupon.discountType,
        discountValue: coupon.discountValue,
      },
    });
  } catch (err) {
    console.error('[Coupon validate]', err.message);
    res.status(500).json({ success: false, message: 'Failed to validate coupon' });
  }
});

module.exports = router;
