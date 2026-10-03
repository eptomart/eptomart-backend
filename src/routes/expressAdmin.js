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
const { uploadExpressBanner } = require('../config/cloudinary');

// Stores
router.get   ('/stores',                    protectAdmin, ctrl.listStores);
router.post  ('/stores',                    protectAdmin, ctrl.createStore);
router.put   ('/stores/:storeId',           protectAdmin, ctrl.updateStore);
router.patch ('/stores/:storeId/toggle',    protectAdmin, ctrl.toggleStoreActive);
router.patch ('/stores/:storeId/toggle-online-shop', protectAdmin, ctrl.toggleOnlineShop);
router.patch ('/stores/:storeId/toggle-pause', protectAdmin, ctrl.togglePauseStore);
router.patch ('/stores/:storeId/delivery-slots', protectAdmin, ctrl.updateDeliverySlots);
router.patch ('/stores/:storeId/delivery-fee', protectAdmin, ctrl.updateDeliveryFeeConfig);
router.get   ('/stores/:storeId/hold-waitlist', protectAdmin, ctrl.getHoldWaitlist);
router.patch ('/hold-waitlist/:entryId/called-back', protectAdmin, ctrl.markWaitlistCalledBack);
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

// Native products/combos — created entirely within Express, never touching
// Koyambedu Daily's catalog. searchExpressProducts (Express's own catalogue,
// native + Koyambedu-linked) powers the combo-contents picker.
router.get ('/products/native/search', protectAdmin, ctrl.searchExpressProducts);
router.post('/products/native',        protectAdmin, ctrl.createNativeProduct);
router.post('/products/generate-description', protectAdmin, ctrl.generateProductDescription);

// Store Products (per-store availability + stock)
router.get   ('/stores/:storeId/products',              protectAdmin, ctrl.listStoreProducts);
router.get   ('/stores/:storeId/products/print-list',   protectAdmin, ctrl.listStoreProductsForPrint);
router.post  ('/stores/:storeId/products',              protectAdmin, ctrl.upsertStoreProduct);
router.delete('/stores/:storeId/products/:productId',   protectAdmin, ctrl.removeStoreProduct);
router.post  ('/stores/:storeId/products/:productId/add-stock', protectAdmin, ctrl.addStock);

// Combined "pick Koyambedu product → assign to store with stock + price" flow
router.post  ('/products/assign-to-store', protectAdmin, ctrl.adminAssignProductToStore);

// Online Catalog (per-store "show online?" + price) — separate from the
// Products/Store Products section above, which is for physical
// stock/inventory and stays untouched by this.
router.get  ('/stores/:storeId/online-catalog',                              protectAdmin, ctrl.adminListOnlineCatalog);
router.patch('/stores/:storeId/online-catalog',                              protectAdmin, ctrl.adminBulkSetOnlineListing);
router.patch('/stores/:storeId/online-catalog/native/:expressProductId',     protectAdmin, ctrl.adminSetNativeOnlineListing);
router.patch('/stores/:storeId/online-catalog/:koyambeduProductId',          protectAdmin, ctrl.adminSetOnlineListing);

// Stock Report (admin additions + store-manager losses, all in one report)
router.get('/stock-logs', protectAdmin, ctrl.listStockLogs);

// Expenses
router.get   ('/expenses',            protectAdmin, ctrl.listExpenses);
router.post  ('/expenses',            protectAdmin, ctrl.createExpense);
router.delete('/expenses/:expenseId', protectAdmin, ctrl.deleteExpense);

// Finance Dashboard (profit / loss)
router.get('/finance-dashboard', protectAdmin, ctrl.getFinanceDashboard);

// Orders (cross-store admin view — see expressManagerController for the
// store-scoped manager equivalent, left untouched)
router.get  ('/orders',                     protectAdmin, ctrl.adminListOrders);
router.get  ('/orders/:orderId',            protectAdmin, ctrl.adminGetOrder);
router.patch('/orders/:orderId/status',     protectAdmin, ctrl.adminUpdateOrderStatus);
router.patch('/orders/:orderId/charges',    protectAdmin, ctrl.adminSetOrderCharges);

// Bill-wise + overall profit report (online orders)
router.get('/orders-pnl', protectAdmin, ctrl.adminOrdersPnL);

// Manual fallback payment reconciliation (see expressRazorpayWebhook for
// the automatic path)
router.post('/orders/:orderId/manual-verify-payment', protectAdmin, ctrl.adminManualVerifyExpressPayment);

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

// Hero Banners (flash sale / lowest-price / custom promos on the Express
// storefront) — "image" is an optional multipart field; without it the
// banner falls back to its gradientFrom/gradientTo background.
router.get   ('/banners',                   protectAdmin, ctrl.listBanners);
router.post  ('/banners',                   protectAdmin, uploadExpressBanner.single('image'), ctrl.createBanner);
router.put   ('/banners/:bannerId',         protectAdmin, uploadExpressBanner.single('image'), ctrl.updateBanner);
router.patch ('/banners/:bannerId/toggle',  protectAdmin, ctrl.toggleBannerActive);
router.delete('/banners/:bannerId',         protectAdmin, ctrl.deleteBanner);

module.exports = router;
