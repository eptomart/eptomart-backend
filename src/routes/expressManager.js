// ============================================
// EPTOMART EXPRESS — Store Manager Routes
// Mounted at /api/express/manager. Login is public; everything else
// requires a valid Store Manager session (protectExpressManager).
// ============================================
const express = require('express');
const router = express.Router();
const authCtrl = require('../controllers/expressManagerAuthController');
const ctrl = require('../controllers/expressManagerController');
const owner = require('../controllers/expressOwnerController');
const { protectExpressManager } = require('../middleware/expressAuth');
const { protect } = require('../middleware/auth');

router.post('/login', authCtrl.login);
router.get ('/me',    protectExpressManager, authCtrl.me);

router.get  ('/dashboard',      protectExpressManager, ctrl.getDashboard);
router.get  ('/store',          protectExpressManager, ctrl.getMyStore);
router.patch('/store/toggle',   protectExpressManager, ctrl.toggleMyStore);

router.get  ('/products',                          protectExpressManager, ctrl.listMyStoreProducts);
router.get  ('/products/print-list',               protectExpressManager, ctrl.listMyStoreProductsForPrint);
router.patch('/products/:storeProductId/toggle',   protectExpressManager, ctrl.toggleProductAvailability);
router.post ('/products/:storeProductId/loss',     protectExpressManager, ctrl.recordLoss);
router.get  ('/stock-logs',                        protectExpressManager, ctrl.listMyStockLogs);
router.get  ('/stock-logs/pending-ack',            protectExpressManager, ctrl.listPendingAcknowledgements);
router.post ('/stock-logs/:logId/acknowledge',     protectExpressManager, ctrl.acknowledgeStock);

router.get ('/inventory-requests',  protectExpressManager, ctrl.listMyInventoryRequests);
router.post('/inventory-requests',  protectExpressManager, ctrl.createInventoryRequest);

router.get  ('/orders',                          protectExpressManager, ctrl.listMyOrders);
router.patch('/orders/:orderId/status',          protectExpressManager, ctrl.updateOrderStatus);
router.patch('/orders/:orderId/delivery-expense',protectExpressManager, ctrl.recordDeliveryExpense);

// ── Store OWNER tools (same account as manager; all scoped to own store) ──
router.get  ('/owner-access',               protect, owner.ownerAccess);
router.get  ('/owner/overview',            protectExpressManager, owner.overview);
router.get  ('/owner/catalog',             protectExpressManager, owner.listCatalog);
router.post ('/owner/items',               protectExpressManager, owner.saveItem);
router.post ('/owner/products',            protectExpressManager, owner.createOwnProduct);
router.patch('/owner/products/:productId', protectExpressManager, owner.updateOwnProduct);
router.get  ('/owner/pos-users',           protectExpressManager, owner.listMyPOSUsers);
router.post ('/owner/pos-users',           protectExpressManager, owner.createMyPOSUser);
router.patch('/owner/pos-users/:posUserId',protectExpressManager, owner.updateMyPOSUser);
router.get  ('/owner/accounts',            protectExpressManager, owner.myAccounts);
router.get  ('/owner/expenses',            protectExpressManager, owner.myExpenses);
router.post ('/owner/expenses',            protectExpressManager, owner.addMyExpense);
router.delete('/owner/expenses/:expenseId',protectExpressManager, owner.deleteMyExpense);

module.exports = router;
