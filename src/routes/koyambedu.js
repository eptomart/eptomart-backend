// ============================================
// KOYAMBEDU DAILY — Routes
// Base: /api/koyambedu
// ============================================
const express  = require('express');
const router   = express.Router();
const ctrl     = require('../controllers/koyambeduController');
const schedCtrl = require('../controllers/koyambeduScheduleController');
const devCtrl   = require('../controllers/koyambeduDevSettingsController');
const { protect, optionalAuth } = require('../middleware/auth');
const { uploadKoyambedu } = require('../config/cloudinary');
const { protectAdmin, protectSuperAdmin } = require('../middleware/adminAuth');

// ── Seller guard middleware ──────────────────
const protectSeller = [protect, async (req, res, next) => {
  const KoyambeduSeller = require('../models/KoyambeduSeller');
  const seller = await KoyambeduSeller.findOne({ user: req.user._id });
  if (!seller) return res.status(403).json({ success: false, message: 'Koyambedu seller account required' });
  req.kbdSeller = seller;
  next();
}];

// ── SellerAdmin guard middleware ─────────────
const protectSellerAdmin = [protect, async (req, res, next) => {
  const KoyambeduSellerAdmin = require('../models/KoyambeduSellerAdmin');
  const sa = await KoyambeduSellerAdmin.findOne({ user: req.user._id });
  if (!sa) return res.status(403).json({ success: false, message: 'Koyambedu SellerAdmin account required' });
  if (sa.status !== 'approved') return res.status(403).json({ success: false, message: 'SellerAdmin account not yet approved' });
  req.kbdSellerAdmin = sa;
  next();
}];

// ══════════════════════════════════════════════
// DEV SETTINGS — public read, superAdmin write
// ══════════════════════════════════════════════
// Public: checkout page reads this to decide whether to show test buttons
router.get('/dev-settings/payment-test-mode',               devCtrl.getPaymentTestModePublic);
// SuperAdmin: full status + audit log
router.get('/admin/dev-settings/payment-test-mode',         protectSuperAdmin, devCtrl.getPaymentTestModeAdmin);
// SuperAdmin: enable (body: { expiresIn: '30m'|'1h'|'2h'|'eod'|'never' })
router.put('/admin/dev-settings/payment-test-mode/enable',  protectSuperAdmin, devCtrl.enablePaymentTestMode);
// SuperAdmin: disable
router.put('/admin/dev-settings/payment-test-mode/disable', protectSuperAdmin, devCtrl.disablePaymentTestMode);

// ══════════════════════════════════════════════
// PUBLIC — no auth required
// ══════════════════════════════════════════════
router.get ('/categories',             ctrl.getCategories);
router.get ('/products',               ctrl.getProducts);
router.get ('/products/featured',      ctrl.getFeaturedProducts);
router.get ('/products/:productId',             ctrl.getProductDetail);
router.get ('/products/:productId/price-history', ctrl.getProductPriceHistory);
router.get ('/slots',                  ctrl.getDeliverySlots);

// ── Delivery Schedule (public: available slots for checkout) ──
router.get('/schedule/available',      optionalAuth, schedCtrl.getAvailableSlots);

// ══════════════════════════════════════════════
// DELIVERY CHECK — auth optional (returns weight-based charge if logged in)
// ══════════════════════════════════════════════
router.post('/check-delivery', optionalAuth, ctrl.checkDeliveryAvailability);

// ══════════════════════════════════════════════
// BUYER — auth required
// ══════════════════════════════════════════════
router.get   ('/cart',                      protect, ctrl.getCart);
router.post  ('/cart',                      protect, ctrl.updateCart);
router.delete('/cart/clear',               protect, ctrl.clearCart);

router.post  ('/orders',                    protect, ctrl.placeOrder);
router.post  ('/orders/create-razorpay',    protect, ctrl.createRazorpayOrder);
router.post  ('/orders/verify-payment',     protect, ctrl.verifyPayment);
// DEV ONLY — guarded by ENABLE_TEST_PAYMENT_BUTTONS=true on the server; no-op in production
router.post  ('/orders/test-payment',       protect, ctrl.testPayment);
router.delete('/orders/:orderId/pending',   protect, ctrl.cancelPendingOrder);
router.get   ('/my-orders',                 protect, ctrl.getMyOrders);
router.get   ('/my-orders/:orderId',        protect, ctrl.getMyOrder);
router.post  ('/orders/:orderId/approve-revision', protect, ctrl.approveRevision);
router.post  ('/orders/:orderId/cancel',    protect, ctrl.cancelOrder);
router.get   ('/orders/:orderId/invoice',   protect, ctrl.getOrderInvoice);
router.post  ('/orders/:orderId/delivery-ack', protect, ctrl.submitDeliveryAck);
router.post  ('/orders/:orderId/delivery-ack/close', protect, ctrl.confirmResolutionAndClose);
router.get   ('/orders/:orderId/timeline',  protect, ctrl.getOrderTimeline);
router.get   ('/orders/:orderId/calculation', protect, ctrl.getOrderCalculation);

// ══════════════════════════════════════════════
// WALLET — customer
// ══════════════════════════════════════════════
// Settings — public
router.get('/settings/last-update', ctrl.getLastProductUpdateTime);

router.get ('/wallet',                 protect, ctrl.getWallet);
router.post('/wallet/refund-request',  protect, ctrl.requestWalletRefund);

// ══════════════════════════════════════════════
// AI — translate & describe (any logged-in user)
// ══════════════════════════════════════════════
router.post('/ai/translate', protect, ctrl.aiTranslate);
router.post('/ai/describe',  protect, ctrl.aiDescribe);

// ══════════════════════════════════════════════
// IMAGE UPLOAD
// ══════════════════════════════════════════════
router.post('/upload-image', protect, uploadKoyambedu.single('image'), ctrl.uploadImage);

// ══════════════════════════════════════════════
// SELLER — requires KoyambeduSeller profile
// ══════════════════════════════════════════════
router.post ('/seller/register',                  protect, ctrl.sellerRegister);
router.get  ('/seller/profile',                   protectSeller, ctrl.getSellerProfile);
router.put  ('/seller/profile',                   protectSeller, ctrl.updateSellerProfile);

router.get  ('/seller/products',                  protectSeller, ctrl.getSellerProducts);
router.post ('/seller/products',                  protectSeller, ctrl.createSellerProduct);
router.put  ('/seller/products/:productId',       protectSeller, ctrl.updateSellerProduct);
router.patch('/seller/products/:productId/toggle',protectSeller, ctrl.toggleProductAvailability);
router.delete('/seller/products/:productId',      protectSeller, ctrl.deleteSellerProduct);

router.post ('/seller/categories',                protectSeller, ctrl.createSellerCategory);

router.get  ('/seller/orders',                    protectSeller, ctrl.getSellerOrders);
router.post ('/seller/orders/:orderId/confirm-stock',           protectSeller, ctrl.confirmStock);
router.post ('/seller/orders/:orderId/request-price-revision',  protectSeller, ctrl.requestPriceRevision);

// ══════════════════════════════════════════════
// SELLER ADMIN PORTAL
// ══════════════════════════════════════════════
router.get ('/seller-admin/profile',                             protectSellerAdmin, ctrl.sellerAdminGetProfile);
router.get ('/seller-admin/sellers',                             protectSellerAdmin, ctrl.sellerAdminGetSellers);
router.post('/seller-admin/sellers',                             protectSellerAdmin, ctrl.sellerAdminCreateSeller);
router.get ('/seller-admin/categories',                            protectSellerAdmin, ctrl.sellerAdminGetCategories);
router.post('/seller-admin/categories',                            protectSellerAdmin, ctrl.sellerAdminCreateCategory);
router.get  ('/seller-admin/sellers/:sellerId/products',            protectSellerAdmin, ctrl.sellerAdminGetProducts);
router.post ('/seller-admin/sellers/:sellerId/products',            protectSellerAdmin, ctrl.sellerAdminCreateProduct);
router.put  ('/seller-admin/sellers/:sellerId/products/:productId',        protectSellerAdmin, ctrl.sellerAdminUpdateProduct);
router.patch('/seller-admin/sellers/:sellerId/products/:productId/toggle', protectSellerAdmin, ctrl.sellerAdminToggleProduct);
router.patch('/seller-admin/sellers/:sellerId/edit-request',               protectSellerAdmin, ctrl.sellerAdminRequestEdit);
router.get  ('/seller-admin/orders',                                       protectSellerAdmin, ctrl.sellerAdminGetOrders);
router.get  ('/seller-admin/alerts',                                       protectSellerAdmin, ctrl.sellerAdminGetAlerts);
// router.patch('/seller-admin/orders/:orderId/status', ...) — REVOKED: SA no longer allowed to change order status
// ── SA item-level review actions ────────────────────────────────────────
router.patch('/seller-admin/orders/:orderId/items/:itemId/confirm',        protectSellerAdmin, ctrl.sellerAdminConfirmItem);
router.patch('/seller-admin/orders/:orderId/items/:itemId/decline',        protectSellerAdmin, ctrl.sellerAdminDeclineItem);
router.patch('/seller-admin/orders/:orderId/items/:itemId/reduce-qty',     protectSellerAdmin, ctrl.sellerAdminReduceItemQty);
router.patch('/seller-admin/orders/:orderId/items/:itemId/available',      protectSellerAdmin, ctrl.sellerAdminMarkItemAvailable);
router.post ('/seller-admin/orders/:orderId/submit-review',                protectSellerAdmin, ctrl.sellerAdminSubmitForApproval);
router.post ('/seller-admin/orders/:orderId/confirm-all',                  protectSellerAdmin, ctrl.sellerAdminConfirmAllItems);

// ══════════════════════════════════════════════
// ADMIN — admin or superAdmin
// ══════════════════════════════════════════════
router.get  ('/admin/dashboard',                  protectAdmin, ctrl.adminDashboard);
router.get  ('/admin/orders',                               protectAdmin,      ctrl.adminGetOrders);
router.get  ('/admin/orders/pending-approval',              protectSuperAdmin, ctrl.adminGetPendingApprovalOrders);
router.get  ('/admin/orders/:orderId/wallet-history',       protectSuperAdmin, ctrl.adminGetOrderWalletHistory);
router.patch('/admin/orders/:orderId/close',      protectSuperAdmin, ctrl.adminCloseOrder);

// Hero video upload (Koyambedu home banner) — Super Admin only
const { uploadHeroVideo } = require('../config/cloudinary');
router.post('/admin/hero-video/upload', protectSuperAdmin, uploadHeroVideo.single('video'), (req, res) => {
  if (!req.file?.path) return res.status(400).json({ success: false, message: 'No video uploaded' });
  const url = req.file.path;
  // Cloudinary derives a poster frame by swapping the extension to .jpg
  const poster = url.replace(/\.(mp4|webm|mov|m4v)(\?.*)?$/i, '.jpg');
  res.json({ success: true, url, poster });
});
router.get  ('/admin/alerts',                     protectAdmin,      ctrl.adminGetAlerts);
router.patch('/admin/orders/:orderId/alerts/resolve', protectSuperAdmin, ctrl.adminResolveAlert);
router.patch('/admin/orders/:orderId/status',                         protectAdmin, ctrl.adminUpdateOrderStatus);
router.patch('/admin/orders/:orderId/delivered',                      protectAdmin, ctrl.adminMarkDelivered);
router.patch('/admin/orders/:orderId/approve-review',                 protectSuperAdmin, ctrl.adminApproveOrderReview);
router.patch('/admin/orders/:orderId/cancel',                         protectSuperAdmin, ctrl.adminCancelOrder);
router.patch('/admin/orders/:orderId/items/:itemIndex/qty',           protectAdmin, ctrl.adminEditOrderItemQty);
router.patch('/admin/orders/:orderId/items/:itemIndex/decline',       protectAdmin, ctrl.adminDeclineOrderItem);
// Wallet refund request management (SuperAdmin)
router.get  ('/admin/refund-requests',                                protectAdmin, ctrl.adminGetRefundRequests);
router.patch('/admin/refund-requests/:walletId/:requestId',           protectAdmin, ctrl.adminUpdateRefundRequest);
// All-customer wallet management (SuperAdmin)
router.get  ('/admin/wallets',                                        protectSuperAdmin, ctrl.adminGetAllWallets);
router.get  ('/admin/wallets/:walletId/transactions',                 protectSuperAdmin, ctrl.adminGetWalletTransactions);
router.post ('/admin/wallets/:walletId/manual-credit',                protectSuperAdmin, ctrl.adminWalletManualCredit);
router.post ('/admin/wallets/:walletId/manual-debit',                 protectSuperAdmin, ctrl.adminWalletManualDebit);
router.get  ('/admin/sellers',                    protectAdmin,      ctrl.adminGetSellers);
router.post ('/admin/sellers',                    protectSuperAdmin, ctrl.adminCreateSeller);
router.patch('/admin/sellers/:sellerId/approve',  protectAdmin,      ctrl.adminApproveSeller);
router.patch('/admin/sellers/:sellerId/toggle',   protectAdmin,      ctrl.adminToggleSeller);
router.patch('/admin/sellers/:sellerId/contact',  protectSuperAdmin, ctrl.adminEditSellerContact);
router.get  ('/admin/categories',                 protectAdmin, ctrl.adminGetCategories);
router.post ('/admin/categories',                 protectAdmin, ctrl.adminCreateCategory);
router.put  ('/admin/categories/:catId',          protectAdmin, ctrl.adminEditCategory);
router.patch('/admin/categories/:catId/approve',  protectAdmin, ctrl.adminApproveCategory);
router.get  ('/admin/analytics',                  protectAdmin, ctrl.adminAnalytics);
router.get  ('/admin/products',                              protectAdmin,      ctrl.adminGetAllProducts);
router.get  ('/admin/products/pending',                      protectSuperAdmin, ctrl.adminGetPendingProducts);
router.post ('/admin/products/:productId/approve',           protectSuperAdmin, ctrl.adminApproveProduct);
router.post ('/admin/products/:productId/reject',            protectSuperAdmin, ctrl.adminRejectProduct);
router.post ('/admin/products/:productId/approve-edit',      protectSuperAdmin, ctrl.adminApproveProductEdit);
router.post ('/admin/products/:productId/reject-edit',       protectSuperAdmin, ctrl.adminRejectProductEdit);
router.put   ('/admin/products/:productId',                  protectAdmin,      ctrl.adminUpdateProduct);
router.patch ('/admin/products/:productId/toggle',           protectAdmin,      ctrl.adminToggleProduct);
router.delete('/admin/products/:productId',                  protectSuperAdmin, ctrl.adminDeleteProduct);
router.post  ('/admin/sellers/:sellerId/products',           protectAdmin,      ctrl.adminCreateProduct);

// SellerAdmin management
router.post ('/admin/sellers/:sellerId/review-edit', protectSuperAdmin, ctrl.adminReviewSellerEdit); // SuperAdmin approves/rejects SA edit request
router.get  ('/admin/user-search',                protectAdmin,      ctrl.adminUserSearch);          // any admin can search users
router.post ('/admin/seller-admins',              protectAdmin,      ctrl.adminCreateSellerAdmin);   // any admin can create
router.get  ('/admin/seller-admins',              protectAdmin,      ctrl.adminGetSellerAdmins);     // any admin can list
router.patch('/admin/seller-admins/:saId/approve',protectSuperAdmin, ctrl.adminApproveSellerAdmin); // superAdmin only to approve/reject

// ── Admin cost update (internal, never shown to customer) ────────
router.patch('/admin/orders/:orderId/costs',             protectAdmin, ctrl.adminUpdateOrderCosts);
// ── Partial Razorpay refund ────────────────────────────────────
router.patch('/admin/orders/:orderId/partial-refund',    protectSuperAdmin, ctrl.adminPartialRefund);
// Procurement invoice — generate final invoice with actual prices + wallet adjustment
router.post ('/admin/orders/:id/procurement-invoice',   protectSuperAdmin, ctrl.generateProcurementInvoice);
// Manual price revision trigger — Super Admin can force-apply daily price changes to a single order
router.post ('/admin/orders/:orderId/apply-price-revision', protectSuperAdmin, ctrl.adminApplyPriceRevision);
// ── Reports ───────────────────────────────────────────────────────
router.get('/admin/reports/order-report',            protectAdmin, ctrl.adminOrderReport);
router.get('/admin/reports/product-consolidation',   protectAdmin, ctrl.adminProductConsolidationReport);
router.get('/admin/reports/cashflow',                protectAdmin, ctrl.adminCashflowReport);

// ── SuperAdmin: wipe all Koyambedu data ──────
router.delete('/admin/wipe-all', protectSuperAdmin, ctrl.adminWipeAll);

// ══════════════════════════════════════════════
// FEATURE 4 — Daily Price Update Panel
// ══════════════════════════════════════════════
router.get  ('/seller-admin/daily-price',            protectSellerAdmin, ctrl.getDailyPricePanel);
router.patch('/seller-admin/daily-price/:productId', protectSellerAdmin, ctrl.updateDailyPrice);
router.post ('/seller-admin/daily-price/bulk',       protectSellerAdmin, ctrl.bulkUpdateDailyPrice);
router.get  ('/admin/daily-price',                   protectAdmin,       ctrl.getDailyPricePanel);
router.patch('/admin/daily-price/:productId',        protectAdmin,       ctrl.updateDailyPrice);
router.post ('/admin/daily-price/bulk',              protectAdmin,       ctrl.bulkUpdateDailyPrice);

// ══════════════════════════════════════════════
// FEATURE 5 — Price History
// ══════════════════════════════════════════════
router.get('/seller-admin/price-history', protectSellerAdmin, ctrl.getPriceHistory);
router.get('/admin/price-history',        protectAdmin,       ctrl.getPriceHistory);

// ══════════════════════════════════════════════
// FEATURE 6 — Forecast Price
// ══════════════════════════════════════════════
router.get  ('/seller-admin/forecast',                    protectSellerAdmin, ctrl.getForecasts);
router.patch('/seller-admin/forecast/:productId',         protectSellerAdmin, ctrl.setForecastPrice);
router.post ('/seller-admin/forecast/:productId/approve', protectSellerAdmin, ctrl.approveForecast);
router.get  ('/admin/forecast',                           protectAdmin,       ctrl.getForecasts);
router.patch('/admin/forecast/:productId',                protectAdmin,       ctrl.setForecastPrice);
router.post ('/admin/forecast/:productId/approve',        protectAdmin,       ctrl.approveForecast);

// ══════════════════════════════════════════════
// FEATURES 7–10 — Reports & Dashboard Stats
// ══════════════════════════════════════════════
// Admin daily price panel (with optional sellerAdmin filter)
router.get  ('/admin/daily-price',            protectAdmin, ctrl.getDailyPricePanel);
router.patch('/admin/daily-price/:productId', protectAdmin, ctrl.updateDailyPrice);
router.post ('/admin/daily-price/bulk',       protectAdmin, ctrl.bulkUpdateDailyPrice);
router.get('/admin/reports/procurement',        protectAdmin,       ctrl.procurementReport);
router.get('/admin/reports/slot-wise',          protectAdmin,       ctrl.slotWiseReport);
router.get('/admin/reports/destination',        protectAdmin,       ctrl.destinationReport);
router.get('/admin/reports/dashboard',          protectAdmin,       ctrl.dashboardStats);
router.get('/seller-admin/reports/procurement', protectSellerAdmin, ctrl.procurementReport);
router.get('/seller-admin/reports/slot-wise',   protectSellerAdmin, ctrl.slotWiseReport);
router.get('/seller-admin/reports/destination', protectSellerAdmin, ctrl.destinationReport);
router.get('/seller-admin/reports/dashboard',   protectSellerAdmin, ctrl.dashboardStats);

// ══════════════════════════════════════════════
// FEATURE 12 — Special Occasion Requests
// ══════════════════════════════════════════════
router.post ('/special-request',                     optionalAuth,       ctrl.submitSpecialRequest);
router.get  ('/admin/special-requests',              protectAdmin,       ctrl.getSpecialRequests);
router.patch('/admin/special-requests/:id',          protectAdmin,       ctrl.updateSpecialRequest);
router.get  ('/seller-admin/special-requests',       protectSellerAdmin, ctrl.getSpecialRequests);
router.patch('/seller-admin/special-requests/:id',   protectSellerAdmin, ctrl.updateSpecialRequest);

// ══════════════════════════════════════════════
// DELIVERY SCHEDULE MANAGEMENT — Super Admin only
// ══════════════════════════════════════════════
router.get  ('/admin/schedule/stats',                             protectSuperAdmin, schedCtrl.getScheduleStats);
router.get  ('/admin/schedule',                                   protectSuperAdmin, schedCtrl.adminGetSchedules);
router.post ('/admin/schedule/generate',                          protectSuperAdmin, schedCtrl.generateSchedules);
router.patch('/admin/schedule/:id/status',                        protectSuperAdmin, schedCtrl.toggleDateStatus);
router.patch('/admin/schedule/:id/slots/:slotKey/status',         protectSuperAdmin, schedCtrl.toggleSlotStatus);
router.patch('/admin/schedule/:id/slots/:slotKey/capacity',       protectSuperAdmin, schedCtrl.updateSlotCapacity);

module.exports = router;
