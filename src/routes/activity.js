// ============================================
// ACTIVITY LOG ROUTES
// ============================================
const express = require('express');
const router = express.Router();
const { getLogs } = require('../controllers/activityController');
const { protectSuperAdmin } = require('../middleware/adminAuth');

// GET activity logs — superAdmin only
router.get('/', ...protectSuperAdmin, getLogs);

module.exports = router;
