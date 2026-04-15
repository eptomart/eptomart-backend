const express = require('express');
const router = express.Router();
const { sendOtp, verifyOtp, register, getMe, updateProfile, logout, verifyFirebasePhone, addAddress, deleteAddress, setDefaultAddress } = require('../controllers/authController');
const { protect } = require('../middleware/auth');
const { otpSendLimiter, authLimiter } = require('../middleware/rateLimiter');

router.post('/send-otp', otpSendLimiter, sendOtp);
router.post('/verify-otp', authLimiter, verifyOtp);
router.post('/register', register);
router.get('/me', protect, getMe);
router.put('/update-profile', protect, updateProfile);
router.post('/logout', protect, logout);
router.post('/firebase-phone-verify', authLimiter, verifyFirebasePhone);

// Address management
router.post('/add-address',                protect, addAddress);
router.delete('/address/:addressId',       protect, deleteAddress);
router.patch('/address/:addressId/default',protect, setDefaultAddress);

module.exports = router;
