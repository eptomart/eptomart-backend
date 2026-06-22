// ============================================
// KOYAMBEDU DAILY — Routes
// Base: /api/koyambedu
// ============================================
const express  = require('express');
const router   = express.Router();
const ctrl     = require('../controllers/koyambeduController');
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
// PUBLIC — no auth required
// ══════════════════════════════════════════════
router.get ('/categories',             ctrl.getCategories);
router.get ('/products',               ctrl.getProducts);
router.get ('/products/featured',      ctrl.getFeaturedProducts);
router.get ('/products/:productId',             ctrl.getProductDetail);
router.get ('/products/:productId/price-history', ctrl.getProductPriceHistory);
router.get ('/slots',                  ctrl.getDeliverySlots);

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
router.get   ('/my-orders',                 protect, ctrl.getMyOrders);
router.get   ('/my-orders/:orderId',        protect, ctrl.getMyOrder);
router.post  ('/orders/:orderId/approve-revision', protect, ctrl.approveRevision);
router.post  ('/orders/:orderId/cancel',    protect, ctrl.cancelOrder);

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
router.put  ('/seller-admin/sellers/:sellerId/products/:productId', protectSellerAdmin, ctrl.sellerAdminUpdateProduct);
router.patch('/seller-admin/sellers/:sellerId/edit-request',        protectSellerAdmin, ctrl.sellerAdminRequestEdit);

// ══════════════════════════════════════════════
// ADMIN — admin or superAdmin
// ══════════════════════════════════════════════
router.get  ('/admin/dashboard',                  protectAdmin, ctrl.adminDashboard);
router.get  ('/admin/orders',                     protectAdmin, ctrl.adminGetOrders);
router.patch('/admin/orders/:orderId/status',     protectAdmin, ctrl.adminUpdateOrderStatus);
router.get  ('/admin/sellers',                    protectAdmin,      ctrl.adminGetSellers);
router.post ('/admin/sellers',                    protectSuperAdmin, ctrl.adminCreateSeller);
router.patch('/admin/sellers/:sellerId/approve',  protectAdmin,      ctrl.adminApproveSeller);
router.patch('/admin/sellers/:sellerId/toggle',   protectAdmin,      ctrl.adminToggleSeller);
router.patch('/admin/sellers/:sellerId/contact',  protectSuperAdmin, ctrl.adminEditSellerContact);
router.get  ('/admin/categories',                 protectAdmin, ctrl.adminGetCategories);
router.patch('/admin/categories/:catId/approve',  protectAdmin, ctrl.adminApproveCategory);
router.get  ('/admin/analytics',                  protectAdmin, ctrl.adminAnalytics);
router.post ('/admin/sellers/:sellerId/products', protectAdmin, ctrl.adminCreateProduct);

// SellerAdmin management
router.post ('/admin/sellers/:sellerId/review-edit', protectSuperAdmin, ctrl.adminReviewSellerEdit); // SuperAdmin approves/rejects SA edit request
router.get  ('/admin/user-search',                protectAdmin,      ctrl.adminUserSearch);          // any admin can search users
router.post ('/admin/seller-admins',              protectAdmin,      ctrl.adminCreateSellerAdmin);   // any admin can create
router.get  ('/admin/seller-admins',              protectAdmin,      ctrl.adminGetSellerAdmins);     // any admin can list
router.patch('/admin/seller-admins/:saId/approve',protectSuperAdmin, ctrl.adminApproveSellerAdmin); // superAdmin only to approve/reject

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

module.exports = router;
