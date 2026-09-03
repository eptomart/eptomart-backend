// ============================================
// KOYAMBEDU BULK HARVEST — Routes
// Mounted at /api/koyambedu/bulk-harvest (self-contained sub-router, same
// pattern as koyambeduCombo.js/koyambeduInventory.js — zero server.js
// changes).
// ============================================
const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/koyambeduBulkHarvestController');
const { protect, optionalAuth } = require('../middleware/auth');
const { protectSuperAdmin } = require('../middleware/adminAuth');
const { uploadBulkHarvest } = require('../config/cloudinary');

// ══════════════════════════════════════════════
// PUBLIC — teaser visible to everyone; optionalAuth attaches req.user
// when a valid token is present so view-logging can attribute to a user
// ══════════════════════════════════════════════
router.get('/',        optionalAuth, ctrl.listActive);
router.get('/:id',     optionalAuth, ctrl.getListing);

// ══════════════════════════════════════════════
// LOGIN REQUIRED — revealing farmer contact is the gated action
// ══════════════════════════════════════════════
router.post('/:id/reveal', protect, ctrl.revealContact);

// ══════════════════════════════════════════════
// SUPER ADMIN — Koyambedu admin manages listings
// ══════════════════════════════════════════════
router.get   ('/admin/all',              protectSuperAdmin, ctrl.adminList);
router.get   ('/admin/dashboard',        protectSuperAdmin, ctrl.adminDashboard);
router.post  ('/admin',                  protectSuperAdmin, uploadBulkHarvest.array('images', 5), ctrl.adminCreate);
router.put   ('/admin/:id',              protectSuperAdmin, uploadBulkHarvest.array('images', 5), ctrl.adminUpdate);
router.delete('/admin/:id/image/:index', protectSuperAdmin, ctrl.adminRemoveImage);
router.patch ('/admin/:id/status',       protectSuperAdmin, ctrl.adminSetStatus);
router.delete('/admin/:id',              protectSuperAdmin, ctrl.adminDelete);

module.exports = router;
