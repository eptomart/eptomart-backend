const express = require('express');
const router = express.Router();
const { getOverview, trackPage, getVisitorsList } = require('../controllers/analyticsController');
const { protectAdmin } = require('../middleware/adminAuth');

router.get('/overview',  protectAdmin, getOverview);
router.get('/visitors',  protectAdmin, getVisitorsList);
router.post('/track',    trackPage);

module.exports = router;
