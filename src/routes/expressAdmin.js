// ============================================
// EPTOMART EXPRESS — Admin Routes (Phase 1)
// Mounted at /api/express/admin, SuperAdmin-only. Entirely separate from
// every other vertical's routes.
// ============================================
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/expressAdminController');
const { protectSuperAdmin } = require('../middleware/adminAuth');

// Stores
router.get   ('/stores',                    protectSuperAdmin, ctrl.listStores);
router.post  ('/stores',                    protectSuperAdmin, ctrl.createStore);
router.put   ('/stores/:storeId',           protectSuperAdmin, ctrl.updateStore);
router.patch ('/stores/:storeId/toggle',    protectSuperAdmin, ctrl.toggleStoreActive);
router.delete('/stores/:storeId',           protectSuperAdmin, ctrl.archiveStore);

// Store Managers
router.get ('/managers',              protectSuperAdmin, ctrl.listStoreManagers);
router.post('/managers',              protectSuperAdmin, ctrl.createStoreManager);
router.put ('/managers/:managerId',   protectSuperAdmin, ctrl.updateStoreManager);

// POS Users
router.get ('/pos-users',             protectSuperAdmin, ctrl.listPOSUsers);
router.post('/pos-users',             protectSuperAdmin, ctrl.createPOSUser);
router.put ('/pos-users/:posUserId',  protectSuperAdmin, ctrl.updatePOSUser);

// Products (master catalogue)
router.get   ('/koyambedu-catalog',         protectSuperAdmin, ctrl.searchKoyambeduCatalog);
router.get   ('/products',                  protectSuperAdmin, ctrl.listProducts);
router.post  ('/products',                  protectSuperAdmin, ctrl.createProduct);
router.put   ('/products/:productId',       protectSuperAdmin, ctrl.updateProduct);
router.delete('/products/:productId',       protectSuperAdmin, ctrl.deleteProduct);
router.get   ('/products/:productId/price-preview', protectSuperAdmin, ctrl.previewPrice);

// Store Products (per-store availability + stock)
router.get   ('/stores/:storeId/products',              protectSuperAdmin, ctrl.listStoreProducts);
router.post  ('/stores/:storeId/products',              protectSuperAdmin, ctrl.upsertStoreProduct);
router.delete('/stores/:storeId/products/:productId',   protectSuperAdmin, ctrl.removeStoreProduct);
router.post  ('/stores/:storeId/products/:productId/add-stock', protectSuperAdmin, ctrl.addStock);

// Stock Report (admin additions + store-manager losses, all in one report)
router.get('/stock-logs', protectSuperAdmin, ctrl.listStockLogs);

// Expenses
router.get   ('/expenses',            protectSuperAdmin, ctrl.listExpenses);
router.post  ('/expenses',            protectSuperAdmin, ctrl.createExpense);
router.delete('/expenses/:expenseId', protectSuperAdmin, ctrl.deleteExpense);

// Finance Dashboard (profit / loss)
router.get('/finance-dashboard', protectSuperAdmin, ctrl.getFinanceDashboard);

// Visitors + Carts
router.get('/visitors', protectSuperAdmin, ctrl.adminGetVisitors);
router.get('/carts',    protectSuperAdmin, ctrl.adminGetCarts);

// Margin Config
router.get ('/margin-config',               protectSuperAdmin, ctrl.getMarginConfig);
router.put ('/margin-config',               protectSuperAdmin, ctrl.updateMarginConfig);
router.post('/margin-config/logistics',     protectSuperAdmin, ctrl.recomputeLogisticsCost);
router.patch('/margin-config/toggle-enabled', protectSuperAdmin, ctrl.toggleExpressEnabled);

// Inventory Requests
router.get  ('/inventory-requests',                    protectSuperAdmin, ctrl.listInventoryRequests);
router.patch('/inventory-requests/:requestId/approve',  protectSuperAdmin, ctrl.approveInventoryRequest);
router.patch('/inventory-requests/:requestId/reject',   protectSuperAdmin, ctrl.rejectInventoryRequest);

// Audit Log
router.get('/audit-log', protectSuperAdmin, ctrl.listAuditLog);

module.exports = router;
