const express = require('express');
const router = express.Router();
const { sendOtp, verifyOtp, register, getMe, updateProfile, logout, verifyFirebasePhone } = require('../controllers/authController');
const { protect } = require('../middleware/auth');
const { otpSendLimiter, authLimiter } = require('../middleware/rateLimiter');

router.post('/send-otp', otpSendLimiter, sendOtp);
router.post('/verify-otp', authLimiter, verifyOtp);
router.post('/register', register);
router.get('/me', protect, getMe);
router.put('/update-profile', protect, updateProfile);
router.post('/logout', protect, logout);
router.post('/firebase-phone-verify', authLimiter, verifyFirebasePhone);

module.exports = router;
