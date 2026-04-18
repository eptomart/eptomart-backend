const express = require('express');
const router  = express.Router();
const { protect }    = require('../middleware/auth');
const { protectAdmin, requirePermission } = require('../middleware/adminAuth');
const sellerAuth     = require('../middleware/sellerAuth');
const {
  listApprovals, approvalStats, getApprovalHistory,
  approve, reject, requestCorrection, resubmit,
} = require('../controllers/approvalController');

// Admin — requires 'approvals' permission
router.get('/',                           ...protectAdmin, requirePermission('approvals'), listApprovals);
router.get('/stats',                      ...protectAdmin, requirePermission('approvals'), approvalStats);
router.get('/:productId/history',         ...protectAdmin, requirePermission('approvals'), getApprovalHistory);
router.post('/:productId/approve',        ...protectAdmin, requirePermission('approvals'), approve);
router.post('/:productId/reject',         ...protectAdmin, requirePermission('approvals'), reject);
router.post('/:productId/request-correction', ...protectAdmin, requirePermission('approvals'), requestCorrection);

// Seller
router.post('/:productId/resubmit',       sellerAuth, resubmit);

module.exports = router;
