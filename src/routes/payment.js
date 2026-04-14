const express = require('express');
const router = express.Router();
const {
  initiatePayment, confirmUpiPayment, adminVerifyUpi,
  createRazorpayOrder, verifyRazorpayPayment, razorpayWebhook,
} = require('../controllers/paymentController');
const { protect } = require('../middleware/auth');
const { protectAdmin } = require('../middleware/adminAuth');

// COD + UPI
router.post('/initiate', protect, initiatePayment);
router.post('/confirm-upi', protect, confirmUpiPayment);
router.post('/admin-verify-upi/:orderId', protectAdmin, adminVerifyUpi);

// Razorpay
router.post('/razorpay/create-order', protect, createRazorpayOrder);
router.post('/razorpay/verify', protect, verifyRazorpayPayment);
router.post('/razorpay/webhook', razorpayWebhook);

module.exports = router;
