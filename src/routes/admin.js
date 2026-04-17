const express = require('express');
const router = express.Router();
const {
  getDashboard, getUsers, getUserLoginHistory,
  toggleUserStatus, getAllOrders, updateOrderStatus,
  listAdmins, createAdmin, deleteAdmin,
} = require('../controllers/adminController');
const { protectAdmin, protectSuperAdmin } = require('../middleware/adminAuth');

// ── Routes accessible to ALL admins (admin + superAdmin) ──
// Orders: regular admin can view and confirm orders
router.get('/orders',            ...protectAdmin, getAllOrders);
router.put('/orders/:id/status', ...protectAdmin, updateOrderStatus);

// ── Routes restricted to superAdmin ONLY ──────────────────
// Dashboard with analytics
router.get('/dashboard',                   ...protectSuperAdmin, getDashboard);
// User management
router.get('/users',                       ...protectSuperAdmin, getUsers);
router.get('/users/:id/login-history',     ...protectSuperAdmin, getUserLoginHistory);
router.put('/users/:id/status',            ...protectSuperAdmin, toggleUserStatus);
// Admin account management (superAdmin only)
router.get('/admins',                      ...protectSuperAdmin, listAdmins);
router.post('/admins',                     ...protectSuperAdmin, createAdmin);
router.delete('/admins/:id',               ...protectSuperAdmin, deleteAdmin);

module.exports = router;
