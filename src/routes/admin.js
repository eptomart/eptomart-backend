const express = require('express');
const router = express.Router();
const {
  getDashboard, getUsers, getUserLoginHistory,
  toggleUserStatus, getAllOrders, updateOrderStatus
} = require('../controllers/adminController');
const { protectAdmin } = require('../middleware/adminAuth');

// All admin routes are protected
router.use(protectAdmin);

router.get('/dashboard', getDashboard);
router.get('/users', getUsers);
router.get('/users/:id/login-history', getUserLoginHistory);
router.put('/users/:id/status', toggleUserStatus);
router.get('/orders', getAllOrders);
router.put('/orders/:id/status', updateOrderStatus);

module.exports = router;
