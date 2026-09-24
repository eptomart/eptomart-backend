// ============================================
// EPTOMART EXPRESS — Admin Routes
// Mounted at /api/express/admin. Open to superAdmin (always) and to any
// admin explicitly granted the 'express' permission (Admin Accounts ->
// Edit Permissions -> Eptomart Express) — same pattern as Farmer Fresh
// ('uzhavar') and Koyambedu Daily ('koyambedu'): gating happens via the
// frontend nav (AdminLayout.jsx) checking permissions, while these routes
// stay open to any authenticated admin via protectAdmin. Entirely separate
// from every other vertical's routes.
// ============================================
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/expressAdminController');
const { protectAdmin } = require('../middleware/adminAuth');

// Stores
router.get   ('/stores',                    protectAdmin, ctrl.listStores);
router.post  ('/stores',                    protectAdmin, ctrl.createStore);
router.put   ('/stores/:storeId',           protectAdmin, ctrl.updateStore);
router.patch ('/stores/:storeId/toggle',    protectAdmin, ctrl.toggleStoreActive);
router.delete('/stores/:storeId',           protectAdmin, ctrl.archiveStore);

// Store Managers
router.get ('/managers',              protectAdmin, ctrl.listStoreManagers);
router.post('/managers',              protectAdmin, ctrl.createStoreManager);
router.put ('/managers/:managerId',   protectAdmin, ctrl.updateStoreManager);

// POS Users
router.get ('/pos-users',             protectAdmin, ctrl.listPOSUsers);
router.post('/pos-users',             protectAdmin, ctrl.createPOSUser);
router.put ('/pos-users/:posUserId',  protectAdmin, ctrl.updatePOSUser);

// Products (master catalogue)
router.get   ('/koyambedu-catalog',         protectAdmin, ctrl.searchKoyambeduCatalog);
router.get   ('/products',                  protectAdmin, ctrl.listProducts);
router.post  ('/products',                  protectAdmin, ctrl.createProduct);
router.put   ('/products/:productId',       protectAdmin, ctrl.updateProduct);
router.delete('/products/:productId',       protectAdmin, ctrl.deleteProduct);
router.get   ('/products/:productId/price-preview', protectAdmin, ctrl.previewPrice);
router.patch ('/products/:productId/plu',            protectAdmin, ctrl.adminSetProductPlu);

// Store Products (per-store availability + stock)
router.get   ('/stores/:storeId/products',              protectAdmin, ctrl.listStoreProducts);
router.get   ('/stores/:storeId/products/print-list',   protectAdmin, ctrl.listStoreProductsForPrint);
router.post  ('/stores/:storeId/products',              protectAdmin, ctrl.upsertStoreProduct);
router.delete('/stores/:storeId/products/:productId',   protectAdmin, ctrl.removeStoreProduct);
router.post  ('/stores/:storeId/products/:productId/add-stock', protectAdmin, ctrl.addStock);

// Combined "pick Koyambedu product → assign to store with stock + price" flow
router.post  ('/products/assign-to-store', protectAdmin, ctrl.adminAssignProductToStore);

// Stock Report (admin additions + store-manager losses, all in one report)
router.get('/stock-logs', protectAdmin, ctrl.listStockLogs);

// Expenses
router.get   ('/expenses',            protectAdmin, ctrl.listExpenses);
router.post  ('/expenses',            protectAdmin, ctrl.createExpense);
router.delete('/expenses/:expenseId', protectAdmin, ctrl.deleteExpense);

// Finance Dashboard (profit / loss)
router.get('/finance-dashboard', protectAdmin, ctrl.getFinanceDashboard);

// Visitors + Carts
router.get('/visitors', protectAdmin, ctrl.adminGetVisitors);
router.get('/carts',    protectAdmin, ctrl.adminGetCarts);

// Margin Config
router.get ('/margin-config',               protectAdmin, ctrl.getMarginConfig);
router.put ('/margin-config',               protectAdmin, ctrl.updateMarginConfig);
router.post('/margin-config/logistics',     protectAdmin, ctrl.recomputeLogisticsCost);
router.patch('/margin-config/toggle-enabled', protectAdmin, ctrl.toggleExpressEnabled);

// Inventory Requests
router.get  ('/inventory-requests',                    protectAdmin, ctrl.listInventoryRequests);
router.patch('/inventory-requests/:requestId/approve',  protectAdmin, ctrl.approveInventoryRequest);
router.patch('/inventory-requests/:requestId/reject',   protectAdmin, ctrl.rejectInventoryRequest);

// Audit Log
router.get('/audit-log', protectAdmin, ctrl.listAuditLog);

module.exports = router;
