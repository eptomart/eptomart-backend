const express = require('express');
const router = express.Router();
const { initiatePayment, confirmUpiPayment, adminVerifyUpi } = require('../controllers/paymentController');
const { protect } = require('../middleware/auth');
const { protectAdmin } = require('../middleware/adminAuth');

router.post('/initiate', protect, initiatePayment);
router.post('/confirm-upi', protect, confirmUpiPayment);
router.post('/admin-verify-upi/:orderId', protectAdmin, adminVerifyUpi);

module.exports = router;
