const express = require('express');
const router = express.Router();
const {
  getDashboard, getUsers, getUserLoginHistory,
  toggleUserStatus, updateUser, deleteUser,
  getAllOrders, updateOrderStatus, adminCancelWithRefund,
  listAdmins, createAdmin, deleteAdmin, updateAdminPermissions,
  createManualShipment, refreshShiprocketAWB, reviewPackaging,
  getShiprocketCharge, recalculatePayout,
  getSellerOrders, markSellerOrdersSettled,
  setAdminShippingCharge, uploadShiprocketBill,
  getPendingPaymentOrders,
} = require('../controllers/adminController');
const { uploadBill } = require('../config/cloudinary');
const { acknowledgePickup } = require('../controllers/sellerController');
const { protectAdmin, protectSuperAdmin, requirePermission } = require('../middleware/adminAuth');

// ── Admin + SuperAdmin routes — gated by RBAC permission ──
router.get('/orders',                              ...protectAdmin, requirePermission('orders'), getAllOrders);
router.get('/orders/pending-payments',             ...protectAdmin, requirePermission('orders'), getPendingPaymentOrders);
router.put('/orders/:id/status',                   ...protectAdmin, requirePermission('orders'), updateOrderStatus);
router.post('/orders/:id/ship',                    ...protectAdmin, requirePermission('orders'), createManualShipment);
router.post('/orders/:id/refresh-awb',             ...protectAdmin, requirePermission('orders'), refreshShiprocketAWB);
router.post('/orders/:id/cancel-refund',           ...protectAdmin, requirePermission('orders'), adminCancelWithRefund);
router.post('/orders/:orderId/acknowledge-pickup', ...protectAdmin, requirePermission('orders'), acknowledgePickup);
router.patch('/orders/:id/packaging-review',       ...protectAdmin, requirePermission('orders'), reviewPackaging);
router.get('/orders/:id/shiprocket-charge',        ...protectAdmin, requirePermission('orders'), getShiprocketCharge);
router.post('/orders/:id/recalculate-payout',      ...protectAdmin, requirePermission('orders'), recalculatePayout);
router.patch('/orders/:id/shipping-charge',        ...protectAdmin, requirePermission('orders'), setAdminShippingCharge);
router.post('/orders/:id/shiprocket-bill',         ...protectAdmin, requirePermission('orders'), uploadBill.single('bill'), uploadShiprocketBill);

// ── Seller order history + settlements ───────────────────
router.get('/sellers/:id/orders',           ...protectAdmin, requirePermission('orders'), getSellerOrders);
router.post('/sellers/:id/mark-settled',    ...protectAdmin, requirePermission('orders'), markSellerOrdersSettled);

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

// ── WhatsApp test — GET /api/admin/test-whatsapp?phone=91XXXXXXXXXX ──
router.get('/test-whatsapp', ...protectAdmin, async (req, res) => {
  const { sendMetaWhatsApp } = require('../utils/sendWhatsApp');
  const phone = req.query.phone || process.env.ADMIN_WHATSAPP_PHONE;
  if (!phone) return res.status(400).json({ success: false, message: 'Provide ?phone=91XXXXXXXXXX' });
  const result = await sendMetaWhatsApp(phone, '✅ Eptomart WhatsApp test message — if you see this, WhatsApp is working!');
  res.json({ success: result.success, phone, result });
});

module.exports = router;
