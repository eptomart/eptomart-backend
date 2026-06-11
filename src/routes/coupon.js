// ============================================
// UNIVERSAL COUPON — Routes
// Base: /api/coupon
// Works across Koyambedu, Uzhavar & EptoFresh
// ============================================
const express = require('express');
const router  = express.Router();
const { protect, optionalAuth } = require('../middleware/auth');
const EptoFreshCoupon  = require('../models/EptoFreshCoupon');
const KoyambeduSeller  = require('../models/KoyambeduSeller');
const Farmer           = require('../models/Farmer');
const EptoFreshSeller  = require('../models/EptoFreshSeller');

/**
 * POST /api/coupon/validate
 * Body: { code, orderAmount, platform?, sellerId? }
 *   platform  — 'koyambedu' | 'uzhavar' | 'eptofresh' | undefined (main marketplace)
 *   sellerId  — ObjectId of the specific seller (for seller-specific coupons)
 *   orderAmount = subtotal + GST (shipping excluded)
 */
router.post('/validate', optionalAuth, async (req, res) => {
  try {
    const { code, orderAmount, platform, sellerId } = req.body;
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

    // ── Platform restriction check ────────────────────────
    if (coupon.platformRestriction && coupon.platformRestriction !== 'all') {
      if (!platform || platform !== coupon.platformRestriction) {
        const names = { koyambedu: 'Koyambedu Daily', uzhavar: 'Uzhavar Fresh', eptofresh: 'EptoFresh Proteins' };
        return res.status(400).json({
          success: false,
          message: `This coupon is only valid for ${names[coupon.platformRestriction] || coupon.platformRestriction} orders`,
        });
      }
    }

    // ── Seller-specific restriction check ────────────────
    if (coupon.assignedSellerId) {
      if (!sellerId || String(sellerId) !== String(coupon.assignedSellerId)) {
        return res.status(400).json({
          success: false,
          message: coupon.assignedSellerName
            ? `This coupon is only valid for orders from ${coupon.assignedSellerName}`
            : 'This coupon is only valid for a specific seller',
        });
      }
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
      discount = (amount * coupon.discountValue) / 100;
      if (coupon.maxDiscount) discount = Math.min(discount, coupon.maxDiscount);
    }
    discount = parseFloat(discount.toFixed(2));

    res.json({
      success:  true,
      discount,
      coupon: {
        code:               coupon.code,
        description:        coupon.description || '',
        discountType:       coupon.discountType,
        discountValue:      coupon.discountValue,
        platformRestriction: coupon.platformRestriction,
        assignedSellerId:   coupon.assignedSellerId,
        assignedSellerName: coupon.assignedSellerName,
      },
    });
  } catch (err) {
    console.error('[Coupon validate]', err.message);
    res.status(500).json({ success: false, message: 'Failed to validate coupon' });
  }
});

/**
 * POST /api/coupon/request
 * Any authenticated seller can request a promo.
 * Server auto-looks up the seller record for the platform so the coupon is
 * seller-specific when approved.
 * Body: { code, discountValue, minOrderValue, maxUsage, validFrom, validTo,
 *         description, requestReason, platform }
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

    // ── Auto-resolve seller ID for the platform ───────────
    const platformRestriction = platform || 'all';
    let assignedSellerId    = null;
    let assignedSellerName  = null;

    if (platform === 'koyambedu') {
      // Koyambedu is a market (multi-vendor) — platform-level restriction only
      // Individual vendor IDs are not passed at checkout, so no seller-specific lock
    } else if (platform === 'uzhavar') {
      // Uzhavar is platform-level only — no per-farmer seller restriction
      // (buyers order from the market, not a specific farmer by ID)
    } else if (platform === 'eptofresh') {
      const epfSeller = await EptoFreshSeller.findOne({ user: req.user._id }).lean();
      if (epfSeller) {
        assignedSellerId   = String(epfSeller._id);
        assignedSellerName = epfSeller.shopName || null;
      }
    }

    const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
    const descWithPlatform = platform
      ? `[${cap(platform)}] ${description || ''}`.trim()
      : (description || '');

    const coupon = await EptoFreshCoupon.create({
      code:               code.toUpperCase().trim(),
      discountType:       'percent',
      discountValue:      pct,
      minOrderValue:      Number(minOrderValue) || 0,
      maxUsage:           Number(maxUsage)      || 50,
      validFrom:          new Date(validFrom),
      validTo:            new Date(validTo),
      description:        descWithPlatform,
      requestReason:      requestReason || '',
      isActive:           false,
      requestStatus:      'pending',
      createdBy:          req.user._id,
      platformRestriction,
      assignedSellerId,
      assignedSellerName,
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
