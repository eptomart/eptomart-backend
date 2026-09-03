// ============================================
// KOYAMBEDU NEWS — Routes
// Mounted at /api/koyambedu/news (self-contained sub-router, same
// pattern as koyambeduCombo.js/koyambeduBulkHarvest.js — zero
// server.js changes).
// ============================================
const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/koyambeduNewsController');
const { protectSuperAdmin } = require('../middleware/adminAuth');
const { uploadKoyambeduNews } = require('../config/cloudinary');

// ══════════════════════════════════════════════
// PUBLIC — no auth required, no login gate
// ══════════════════════════════════════════════
router.get('/', ctrl.listActive);

// ══════════════════════════════════════════════
// SUPER ADMIN
// ══════════════════════════════════════════════
router.get   ('/admin/all',        protectSuperAdmin, ctrl.adminList);
router.post  ('/admin',            protectSuperAdmin, uploadKoyambeduNews.single('image'), ctrl.adminCreate);
router.put   ('/admin/:id',        protectSuperAdmin, uploadKoyambeduNews.single('image'), ctrl.adminUpdate);
router.patch ('/admin/:id/verify', protectSuperAdmin, ctrl.adminSetVerified);
router.patch ('/admin/:id/status', protectSuperAdmin, ctrl.adminSetStatus);
router.delete('/admin/:id',        protectSuperAdmin, ctrl.adminDelete);

module.exports = router;
