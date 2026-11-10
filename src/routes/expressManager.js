// ============================================
// EPTOMART EXPRESS — Store Manager / Owner Routes
// Mounted at /api/express/manager. Login is public; everything else
// requires a valid store session (protectExpressManager) — either the legacy
// manager-password token OR a normal Eptomart login of a user an owner/admin
// assigned to the store.
//
// Roles (requireExpressRole): owner = everything; manager = fulfil/close
// orders + stock availability; accountant = accounts, expenses, read-only
// orders. A record with no role is an owner.
// ============================================
const express = require('express');
const router = express.Router();
const authCtrl = require('../controllers/expressManagerAuthController');
const ctrl = require('../controllers/expressManagerController');
const owner = require('../controllers/expressOwnerController');
const { protectExpressManager, requireExpressRole } = require('../middleware/expressAuth');
const { protect } = require('../middleware/auth');

const any    = [protectExpressManager];
const ops    = [protectExpressManager, requireExpressRole('owner', 'manager')];
const money  = [protectExpressManager, requireExpressRole('owner', 'accountant')];
const ownerO = [protectExpressManager, requireExpressRole('owner')];

router.post('/login', authCtrl.login);
router.get ('/me',    ...any, authCtrl.me);

router.get  ('/dashboard',      ...any, ctrl.getDashboard);
router.get  ('/store',          ...any, ctrl.getMyStore);
router.patch('/store/toggle',   ...ops, ctrl.toggleMyStore);

router.get  ('/products',                          ...ops, ctrl.listMyStoreProducts);
router.get  ('/products/print-list',               ...ops, ctrl.listMyStoreProductsForPrint);
router.patch('/products/:storeProductId/toggle',   ...ops, ctrl.toggleProductAvailability);
router.post ('/products/:storeProductId/loss',     ...ops, ctrl.recordLoss);
router.get  ('/stock-logs',                        ...ops, ctrl.listMyStockLogs);
router.get  ('/stock-logs/pending-ack',            ...ops, ctrl.listPendingAcknowledgements);
router.post ('/stock-logs/:logId/acknowledge',     ...ops, ctrl.acknowledgeStock);

router.get ('/inventory-requests',  ...ops, ctrl.listMyInventoryRequests);
router.post('/inventory-requests',  ...ops, ctrl.createInventoryRequest);

// Orders: everyone on the team can VIEW; only owner/manager can move/close them.
router.get  ('/orders',                          ...any, ctrl.listMyOrders);
router.patch('/orders/:orderId/status',          ...ops, ctrl.updateOrderStatus);
router.patch('/orders/:orderId/delivery-expense',...ops, ctrl.recordDeliveryExpense);
router.get  ('/orders/:orderId/decline-preview', ...ops, ctrl.previewDecline);
router.post ('/orders/:orderId/decline-items',   ...ops, ctrl.declineOrderItems);

// ── Store OWNER tools (all scoped to the caller's own store) ─────────────
router.get  ('/owner-access',               protect, owner.ownerAccess);
router.get  ('/owner/overview',             ...money, owner.overview);
router.get  ('/owner/catalog',              ...ownerO, owner.listCatalog);
router.post ('/owner/items',                ...ownerO, owner.saveItem);
router.post ('/owner/products',             ...ownerO, owner.createOwnProduct);
router.patch('/owner/products/:productId',  ...ownerO, owner.updateOwnProduct);
router.get  ('/owner/pos-users',            ...ownerO, owner.listMyPOSUsers);
router.post ('/owner/pos-users',            ...ownerO, owner.createMyPOSUser);
router.patch('/owner/pos-users/:posUserId', ...ownerO, owner.updateMyPOSUser);
router.get  ('/owner/accounts',             ...money, owner.myAccounts);
router.get  ('/owner/expenses',             ...money, owner.myExpenses);
router.post ('/owner/expenses',             ...money, owner.addMyExpense);
router.delete('/owner/expenses/:expenseId', ...money, owner.deleteMyExpense);

// Delivery & store settings: owner sets everything; a manager may hold/resume
router.get  ('/owner/store',                     ...ownerO, owner.getStoreSettings);
router.patch('/owner/store/delivery-slots',      ...ownerO, owner.updateMyDeliverySlots);
router.patch('/owner/store/delivery-fee',        ...ownerO, owner.updateMyDeliveryFee);
router.patch('/owner/store/toggle-pause',        ...ops,    owner.toggleMyPause);
router.patch('/owner/store/toggle-online-shop',  ...ownerO, owner.toggleMyOnlineShop);

// GST / invoice profile — set once by the owner (locked after the first final invoice)
router.get  ('/owner/gst',                       ...ownerO, owner.getGst);
router.put  ('/owner/gst',                       ...ownerO, owner.saveGst);

// Team (manager / accountant profiles) and WhatsApp order-alert numbers
router.get   ('/owner/team',                ...ownerO, owner.listTeam);
router.post  ('/owner/team',                ...ownerO, owner.addTeamMember);
router.patch ('/owner/team/:memberId',      ...ownerO, owner.updateTeamMember);
router.delete('/owner/team/:memberId',      ...ownerO, owner.removeTeamMember);
router.get   ('/owner/alerts',              ...ownerO, owner.getAlerts);
router.put   ('/owner/alerts',              ...ownerO, owner.setAlerts);

module.exports = router;
