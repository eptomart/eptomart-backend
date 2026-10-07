// ============================================
// KOYAMBEDU CUSTOM BILLS — Routes
// Mounted at /api/koyambedu/custom-bills (self-contained sub-router, same
// pattern as koyambeduNews.js — admin only).
// ============================================
const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/koyambeduCustomBillController');
const { protectAdmin } = require('../middleware/adminAuth');

router.get   ('/',    protectAdmin, ctrl.list);
router.post  ('/',    protectAdmin, ctrl.create);
router.post  ('/parse', protectAdmin, ctrl.parseText);
router.put   ('/:id', protectAdmin, ctrl.update);
router.delete('/:id', protectAdmin, ctrl.remove);

module.exports = router;
