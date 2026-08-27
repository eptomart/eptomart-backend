// ============================================
// KOYAMBEDU COMBOS / FLASH SALE — Settings Routes
// Mounted at /api/koyambedu/combos (see routes/koyambedu.js — self-contained
// sub-router, same pattern as koyambeduInventory.js, so it rides on the
// existing /api/koyambedu base path with zero server.js changes).
//
// Combo PRODUCTS are created/edited through the existing Koyambedu product
// routes (isCombo + comboContents fields) — this router only exposes the
// combo-specific settings singleton (feature toggle, same-day cutoff,
// delivery slots, delivery pricing, minimum order value).
// ============================================
const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/koyambeduComboController');
const { protectSuperAdmin } = require('../middleware/adminAuth');

// ══════════════════════════════════════════════
// PUBLIC — no auth required
// ══════════════════════════════════════════════
router.get('/status', ctrl.getPublicStatus); // feature on/off + slots + delivery tiers + minOrderValue

// ══════════════════════════════════════════════
// SUPER ADMIN — settings
// ══════════════════════════════════════════════
router.get  ('/admin/settings',                   protectSuperAdmin, ctrl.adminGetSettings);
router.patch('/admin/settings/feature',           protectSuperAdmin, ctrl.adminToggleFeature);
router.put  ('/admin/settings/same-day-delivery', protectSuperAdmin, ctrl.adminUpdateSameDayDelivery);
router.put  ('/admin/settings/delivery-slots',    protectSuperAdmin, ctrl.adminUpdateDeliverySlots);
router.put  ('/admin/settings/delivery-charges',  protectSuperAdmin, ctrl.adminUpdateDeliveryCharges);
router.put  ('/admin/settings/min-order',         protectSuperAdmin, ctrl.adminUpdateMinOrderValue);
router.put  ('/admin/settings/platform-fee-discount', protectSuperAdmin, ctrl.adminUpdatePlatformFeeDiscount);

module.exports = router;
