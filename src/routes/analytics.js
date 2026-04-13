const express = require('express');
const router = express.Router();
const { getOverview, trackPage } = require('../controllers/analyticsController');
const { protectAdmin } = require('../middleware/adminAuth');

router.get('/overview', protectAdmin, getOverview);
router.post('/track', trackPage);

module.exports = router;
