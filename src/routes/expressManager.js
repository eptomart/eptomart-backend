// ============================================
// EPTOMART EXPRESS — Store Manager Routes
// Mounted at /api/express/manager. Login is public; everything else
// requires a valid Store Manager session (protectExpressManager).
// ============================================
const express = require('express');
const router = express.Router();
const authCtrl = require('../controllers/expressManagerAuthController');
const ctrl = require('../controllers/expressManagerController');
const { protectExpressManager } = require('../middleware/expressAuth');

router.post('/login', authCtrl.login);
router.get ('/me',    protectExpressManager, authCtrl.me);

router.get  ('/dashboard',      protectExpressManager, ctrl.getDashboard);
router.get  ('/store',          protectExpressManager, ctrl.getMyStore);
router.patch('/store/toggle',   protectExpressManager, ctrl.toggleMyStore);

router.get  ('/products',                          protectExpressManager, ctrl.listMyStoreProducts);
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

module.exports = router;
