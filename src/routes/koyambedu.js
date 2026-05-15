// ============================================
// KOYAMBEDU DAILY — Routes
// Base: /api/koyambedu
// ============================================
const express  = require('express');
const router   = express.Router();
const ctrl     = require('../controllers/koyambeduController');
const { protect, optionalAuth } = require('../middleware/auth');
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
router.get ('/products/:productId',    ctrl.getProductDetail);
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
router.get ('/seller-admin/sellers/:sellerId/products',          protectSellerAdmin, ctrl.sellerAdminGetProducts);
router.put ('/seller-admin/sellers/:sellerId/products/:productId', protectSellerAdmin, ctrl.sellerAdminUpdateProduct);

// ══════════════════════════════════════════════
// ADMIN — admin or superAdmin
// ══════════════════════════════════════════════
router.get  ('/admin/dashboard',                  protectAdmin, ctrl.adminDashboard);
router.get  ('/admin/orders',                     protectAdmin, ctrl.adminGetOrders);
router.patch('/admin/orders/:orderId/status',     protectAdmin, ctrl.adminUpdateOrderStatus);
router.get  ('/admin/sellers',                    protectAdmin, ctrl.adminGetSellers);
router.patch('/admin/sellers/:sellerId/approve',  protectAdmin, ctrl.adminApproveSeller);
router.patch('/admin/sellers/:sellerId/toggle',   protectAdmin, ctrl.adminToggleSeller);
router.get  ('/admin/categories',                 protectAdmin, ctrl.adminGetCategories);
router.patch('/admin/categories/:catId/approve',  protectAdmin, ctrl.adminApproveCategory);
router.get  ('/admin/analytics',                  protectAdmin, ctrl.adminAnalytics);

// SellerAdmin management
router.get  ('/admin/user-search',                protectAdmin,      ctrl.adminUserSearch);          // any admin can search users
router.post ('/admin/seller-admins',              protectAdmin,      ctrl.adminCreateSellerAdmin);   // any admin can create
router.get  ('/admin/seller-admins',              protectAdmin,      ctrl.adminGetSellerAdmins);     // any admin can list
router.patch('/admin/seller-admins/:saId/approve',protectSuperAdmin, ctrl.adminApproveSellerAdmin); // superAdmin only to approve/reject

module.exports = router;
