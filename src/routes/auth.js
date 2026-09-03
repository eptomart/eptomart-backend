const express = require('express');
const router = express.Router();
const { sendOtp, verifyOtp, register, getMe, updateProfile, logout, verifyFirebasePhone, addAddress, updateAddress, deleteAddress, setDefaultAddress, deleteAccount } = require('../controllers/authController');
const { protect } = require('../middleware/auth');
const { otpSendLimiter, authLimiter } = require('../middleware/rateLimiter');

router.post('/send-otp', otpSendLimiter, sendOtp);
router.post('/verify-otp', authLimiter, verifyOtp);
router.post('/register', register);
router.get('/me', protect, getMe);
router.put('/update-profile', protect, updateProfile);
router.post('/logout', protect, logout);
router.post('/firebase-phone-verify', authLimiter, verifyFirebasePhone);

// Account deletion
router.delete('/delete-account', protect, deleteAccount);

// Address management
router.post('/add-address',                protect, addAddress);
router.put('/address/:addressId',          protect, updateAddress);
router.delete('/address/:addressId',       protect, deleteAddress);
router.patch('/address/:addressId/default',protect, setDefaultAddress);

module.exports = router;
