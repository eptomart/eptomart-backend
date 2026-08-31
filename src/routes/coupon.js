// ============================================
// UNIVERSAL COUPON — Routes
// Base: /api/coupon
// Works across Koyambedu, Uzhavar & EptoFresh
// ============================================
const express = require('express');
const router  = express.Router();
const { protect, optionalAuth } = require('../middleware/auth');
const { protectAdmin }          = require('../middleware/adminAuth');
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
        const names = { main: 'Eptomart', koyambedu: 'Koyambedu Daily', uzhavar: 'Uzhavar Fresh', eptofresh: 'EptoFresh Proteins', fruitbasket: 'Fruit Baskets & Hampers' };
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
    const platformRestriction = (platform || 'all').toLowerCase();
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

// ============================================================
// ADMIN ROUTES — require protectAdmin
// ============================================================

/**
 * GET /api/coupon/admin/all
 * Returns all coupons, newest first. Optional ?status=pending|approved|admin_created
 */
router.get('/admin/all', protectAdmin, async (req, res) => {
  try {
    const filter = {};
    if (req.query.status) filter.requestStatus = req.query.status;
    const coupons = await EptoFreshCoupon.find(filter).sort({ createdAt: -1 }).lean();
    res.json({ success: true, coupons });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch coupons' });
  }
});

/**
 * POST /api/coupon/admin/create
 * Admin creates a coupon directly (requestStatus = 'admin_created', isActive = true)
 */
router.post('/admin/create', protectAdmin, async (req, res) => {
  try {
    const {
      code, discountType, discountValue, maxDiscount,
      minOrderValue, maxUsage, validFrom, validTo,
      description, platformRestriction, assignedSellerId, assignedSellerName,
    } = req.body;

    if (!code || !discountType || !discountValue || !validFrom || !validTo) {
      return res.status(400).json({ success: false, message: 'code, discountType, discountValue, validFrom and validTo are required' });
    }
    const existing = await EptoFreshCoupon.findOne({ code: code.toUpperCase().trim() });
    if (existing) return res.status(400).json({ success: false, message: 'Coupon code already exists' });

    const coupon = await EptoFreshCoupon.create({
      code:                code.toUpperCase().trim(),
      discountType:        discountType || 'percent',
      discountValue:       Number(discountValue),
      maxDiscount:         maxDiscount ? Number(maxDiscount) : undefined,
      minOrderValue:       Number(minOrderValue) || 0,
      maxUsage:            Number(maxUsage) || 100,
      validFrom:           new Date(validFrom),
      validTo:             new Date(validTo),
      description:         description || '',
      isActive:            true,
      requestStatus:       'admin_created',
      createdBy:           req.user._id,
      platformRestriction: (platformRestriction || 'all').toLowerCase(),
      assignedSellerId:    assignedSellerId || null,
      assignedSellerName:  assignedSellerName || null,
    });

    res.status(201).json({ success: true, coupon });
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ success: false, message: 'Coupon code already exists' });
    console.error('[Admin coupon create]', err.message);
    res.status(500).json({ success: false, message: 'Failed to create coupon' });
  }
});

/**
 * PATCH /api/coupon/admin/:id/toggle
 * Toggle isActive
 */
router.patch('/admin/:id/toggle', protectAdmin, async (req, res) => {
  try {
    const coupon = await EptoFreshCoupon.findById(req.params.id);
    if (!coupon) return res.status(404).json({ success: false, message: 'Coupon not found' });
    coupon.isActive = !coupon.isActive;
    await coupon.save();
    res.json({ success: true, coupon });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to toggle coupon' });
  }
});

/**
 * PATCH /api/coupon/admin/:id/approve
 * Approve a seller promo request
 */
router.patch('/admin/:id/approve', protectAdmin, async (req, res) => {
  try {
    const coupon = await EptoFreshCoupon.findByIdAndUpdate(
      req.params.id,
      { requestStatus: 'approved', isActive: true },
      { new: true },
    ).lean();
    if (!coupon) return res.status(404).json({ success: false, message: 'Coupon not found' });
    res.json({ success: true, coupon });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to approve coupon' });
  }
});

/**
 * PATCH /api/coupon/admin/:id/reject
 * Reject a seller promo request
 */
router.patch('/admin/:id/reject', protectAdmin, async (req, res) => {
  try {
    const { reason } = req.body;
    const coupon = await EptoFreshCoupon.findByIdAndUpdate(
      req.params.id,
      { requestStatus: 'rejected', isActive: false, rejectReason: reason || '' },
      { new: true },
    ).lean();
    if (!coupon) return res.status(404).json({ success: false, message: 'Coupon not found' });
    res.json({ success: true, coupon });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to reject coupon' });
  }
});

/**
 * DELETE /api/coupon/admin/:id
 * Hard-delete a coupon
 */
router.delete('/admin/:id', protectAdmin, async (req, res) => {
  try {
    await EptoFreshCoupon.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to delete coupon' });
  }
});

module.exports = router;
