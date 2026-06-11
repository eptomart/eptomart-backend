// ============================================
// UNIVERSAL COUPON — Routes
// Base: /api/coupon
// Works across Koyambedu, Uzhavar & EptoFresh
// ============================================
const express = require('express');
const router  = express.Router();
const { protect, optionalAuth } = require('../middleware/auth');
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

/**
 * POST /api/coupon/request
 * Any authenticated seller (Koyambedu / Uzhavar / EptoFresh) can request a promo
 * Body: { code, discountValue, minOrderValue, maxUsage, validFrom, validTo, description, requestReason, platform }
 */
router.post('/request', protect, async (req, res) => {
  try {
    const {
      code, discountValue, minOrderValue, maxUsage,
      validFrom, validTo, description, requestReason, platform,
    } = req.body;

    if (!code || !discountValue || !validFrom || !validTo) {
      return res.status(400).json({ success: false, message: 'Code, discount %, valid-from and valid-to are required' });
    }
    const pct = Number(discountValue);
    if (isNaN(pct) || pct <= 0 || pct > 100) {
      return res.status(400).json({ success: false, message: 'Discount must be between 1–100%' });
    }

    const existing = await EptoFreshCoupon.findOne({ code: code.toUpperCase().trim() });
    if (existing) return res.status(400).json({ success: false, message: 'Coupon code already exists' });

    const coupon = await EptoFreshCoupon.create({
      code:          code.toUpperCase().trim(),
      discountType:  'percent',
      discountValue: pct,
      minOrderValue: Number(minOrderValue) || 0,
      maxUsage:      Number(maxUsage)      || 50,
      validFrom:     new Date(validFrom),
      validTo:       new Date(validTo),
      description:   description || '',
      requestReason: requestReason || '',
      isActive:      false,
      requestStatus: 'pending',
      createdBy:     req.user._id,
      // platform tag stored in description prefix if provided
      ...(platform ? { description: `[${platform}] ${description || ''}`.trim() } : {}),
    });

    res.status(201).json({ success: true, coupon });
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ success: false, message: 'Coupon code already exists' });
    console.error('[Coupon request]', err.message);
    res.status(500).json({ success: false, message: 'Failed to submit request' });
  }
});

/**
 * GET /api/coupon/my-requests
 * Returns all promo requests submitted by the logged-in user
 */
router.get('/my-requests', protect, async (req, res) => {
  try {
    const coupons = await EptoFreshCoupon.find({ createdBy: req.user._id })
      .sort({ createdAt: -1 })
      .lean();
    res.json({ success: true, coupons });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch requests' });
  }
});

module.exports = router;
