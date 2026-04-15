const express = require('express');
const router  = express.Router();
const { protect }    = require('../middleware/auth');
const protectAdmin   = require('../middleware/adminAuth').protectAdmin;
const sellerAuth     = require('../middleware/sellerAuth');
const {
  listApprovals, approvalStats, getApprovalHistory,
  approve, reject, requestCorrection, resubmit,
} = require('../controllers/approvalController');

// Admin
router.get('/',                           protect, protectAdmin, listApprovals);
router.get('/stats',                      protect, protectAdmin, approvalStats);
router.get('/:productId/history',         protect, protectAdmin, getApprovalHistory);
router.post('/:productId/approve',        protect, protectAdmin, approve);
router.post('/:productId/reject',         protect, protectAdmin, reject);
router.post('/:productId/request-correction', protect, protectAdmin, requestCorrection);

// Seller
router.post('/:productId/resubmit',       sellerAuth, resubmit);

module.exports = router;
