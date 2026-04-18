const express = require('express');
const router = express.Router();
const {
  getDashboard, getUsers, getUserLoginHistory,
  toggleUserStatus, updateUser, deleteUser,
  getAllOrders, updateOrderStatus,
  listAdmins, createAdmin, deleteAdmin, updateAdminPermissions,
} = require('../controllers/adminController');
const { protectAdmin, protectSuperAdmin, requirePermission } = require('../middleware/adminAuth');

// ── Admin + SuperAdmin routes — gated by RBAC permission ──
router.get('/orders',            ...protectAdmin, requirePermission('orders'), getAllOrders);
router.put('/orders/:id/status', ...protectAdmin, requirePermission('orders'), updateOrderStatus);

// ── Routes restricted to superAdmin ONLY ──────────────────
// Dashboard with analytics
router.get('/dashboard',                   ...protectSuperAdmin, getDashboard);
// User management
router.get('/users',                       ...protectSuperAdmin, getUsers);
router.get('/users/:id/login-history',     ...protectSuperAdmin, getUserLoginHistory);
router.put('/users/:id/status',            ...protectSuperAdmin, toggleUserStatus);
router.put('/users/:id',                   ...protectSuperAdmin, updateUser);
router.delete('/users/:id',               ...protectSuperAdmin, deleteUser);
// Admin account management (superAdmin only)
router.get('/admins',                      ...protectSuperAdmin, listAdmins);
router.post('/admins',                     ...protectSuperAdmin, createAdmin);
router.patch('/admins/:id/permissions',    ...protectSuperAdmin, updateAdminPermissions);
router.delete('/admins/:id',               ...protectSuperAdmin, deleteAdmin);

module.exports = router;
