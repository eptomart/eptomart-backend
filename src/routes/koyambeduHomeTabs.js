// ============================================
// KOYAMBEDU HOME TABS — Routes
// Mounted at /api/koyambedu/home-tabs (self-contained sub-router, same
// pattern as koyambeduCombo.js — zero server.js changes).
// ============================================
const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/koyambeduHomeTabsController');
const { protectSuperAdmin } = require('../middleware/adminAuth');

// ══════════════════════════════════════════════
// PUBLIC — no auth required
// ══════════════════════════════════════════════
router.get('/status', ctrl.getPublicStatus);

// ══════════════════════════════════════════════
// SUPER ADMIN — settings
// ══════════════════════════════════════════════
router.get  ('/admin/settings',                 protectSuperAdmin, ctrl.adminGetSettings);
router.patch('/admin/settings/bulk-harvest',    protectSuperAdmin, ctrl.adminToggleBulkHarvest);
router.patch('/admin/settings/news',            protectSuperAdmin, ctrl.adminToggleNews);

module.exports = router;
