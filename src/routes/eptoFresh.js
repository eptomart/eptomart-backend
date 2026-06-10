// ============================================
// EPTOFRESH PROTEINS — Routes
// Base: /api/eptofresh
// ============================================
const express  = require('express');
const router   = express.Router();
const ctrl     = require('../controllers/eptoFreshController');
const sellerCtrl = require('../controllers/eptoFreshSellerController');
const adminCtrl  = require('../controllers/eptoFreshAdminController');
const { protect, optionalAuth } = require('../middleware/auth');
const { protectAdmin, protectSuperAdmin } = require('../middleware/adminAuth');
const { uploadDocument, uploadPackaging } = require('../config/cloudinary');
const multer   = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const cloudinary = require('../config/cloudinary').cloudinary;

// ── EptoFresh image storage ─────────────────────────────
const eptoFreshProductStorage = new CloudinaryStorage({
  cloudinary,
  params: { folder: 'eptomart/eptofresh/products', allowed_formats: ['jpg','jpeg','png','webp'], transformation: [{ width: 800, height: 800, crop: 'limit', quality: 'auto' }] },
});
const eptoFreshDocStorage = new CloudinaryStorage({
  cloudinary,
  params: { folder: 'eptomart/eptofresh/kyc', allowed_formats: ['jpg','jpeg','png','pdf'], resource_type: 'auto' },
});
const eptoFreshShopStorage = new CloudinaryStorage({
  cloudinary,
  params: { folder: 'eptomart/eptofresh/shops', allowed_formats: ['jpg','jpeg','png','webp'], transformation: [{ width: 1200, quality: 'auto' }] },
});
const eptoFreshPackedStorage = new CloudinaryStorage({
  cloudinary,
  params: { folder: 'eptomart/eptofresh/packed', allowed_formats: ['jpg','jpeg','png','webp'], transformation: [{ width: 1200, quality: 'auto' }] },
});

const uploadEpfProduct = multer({ storage: eptoFreshProductStorage, limits: { fileSize: 5 * 1024 * 1024 } });
const uploadEpfDoc     = multer({ storage: eptoFreshDocStorage,     limits: { fileSize: 10 * 1024 * 1024 } });
const uploadEpfShop    = multer({ storage: eptoFreshShopStorage,    limits: { fileSize: 5 * 1024 * 1024 } });
const uploadEpfPacked  = multer({ storage: eptoFreshPackedStorage,  limits: { fileSize: 8 * 1024 * 1024 } });

// ── Seller guard ────────────────────────────────────────
const EptoFreshSeller = require('../models/EptoFreshSeller');
const protectEpfSeller = [protect, async (req, res, next) => {
  const seller = await EptoFreshSeller.findOne({ user: req.user._id });
  if (!seller) return res.status(403).json({ success: false, message: 'EptoFresh seller account required' });
  req.epfSeller = seller;
  next();
}];

// ══════════════════════════════════════════════════════════
// PLACES AUTOCOMPLETE PROXY (hides Google API key from frontend)
// ══════════════════════════════════════════════════════════
router.get('/maps/config',         ctrl.mapsConfig);
router.get('/places/autocomplete', ctrl.placesAutocomplete);
router.get('/places/details',      ctrl.placesDetails);

// PUBLIC / CUSTOMER BROWSE
// ══════════════════════════════════════════════════════════
router.get('/sellers',                      optionalAuth, ctrl.getNearbySellers);
router.get('/sellers/:sellerId',            optionalAuth, ctrl.getSellerProfile);
router.get('/sellers/:sellerId/products',   optionalAuth, ctrl.getSellerProducts);
router.post('/delivery-check',              optionalAuth, ctrl.checkDelivery);

// ══════════════════════════════════════════════════════════
// CUSTOMER — auth required
// ══════════════════════════════════════════════════════════
router.get   ('/cart',                         protect, ctrl.getCart);
router.post  ('/cart',                         protect, ctrl.updateCart);
router.delete('/cart',                         protect, ctrl.clearCart);

router.post  ('/orders',                       protect, ctrl.placeOrder);
router.post  ('/orders/verify-payment',        protect, ctrl.verifyPayment);
router.get   ('/orders',                       protect, ctrl.getMyOrders);
router.get   ('/orders/:orderId',              protect, ctrl.getOrderDetail);
router.post  ('/orders/:orderId/confirm-delivery', protect, ctrl.confirmDelivery);
router.post  ('/orders/:orderId/cancel',       protect, ctrl.cancelOrder);
router.post  ('/orders/:orderId/review',       protect, ctrl.submitReview);
router.get   ('/orders/:orderId/tracking',     protect, ctrl.getTracking);

router.get   ('/wallet',                       protect, ctrl.getWallet);
router.post  ('/coupon/validate',              protect, ctrl.validateCoupon);

// ══════════════════════════════════════════════════════════
// PORTER WEBHOOK — public (verified by signature in handler)
// ══════════════════════════════════════════════════════════
router.post('/porter/webhook', adminCtrl.porterWebhook);

// ══════════════════════════════════════════════════════════
// SELLER PANEL
// ══════════════════════════════════════════════════════════

// Registration — protected, any logged-in user can apply
const kycFields = [
  { name: 'meatLicense', maxCount: 1 },
  { name: 'aadhaar',     maxCount: 1 },
  { name: 'pan',         maxCount: 1 },
  { name: 'fssai',       maxCount: 1 },
];
router.post('/seller/register', protect, uploadEpfDoc.fields(kycFields), sellerCtrl.register);
router.get ('/seller/profile',  protectEpfSeller, sellerCtrl.getMyProfile);
router.put ('/seller/profile',  protectEpfSeller, uploadEpfShop.fields([{ name: 'shopImage' }, { name: 'bannerImage' }]), sellerCtrl.updateProfile);

// Seller Dashboard
router.get('/seller/dashboard', protectEpfSeller, sellerCtrl.getDashboard);

// Products
router.get   ('/seller/products',             protectEpfSeller, sellerCtrl.getProducts);
router.post  ('/seller/products',             protectEpfSeller, uploadEpfProduct.array('images', 5), sellerCtrl.addProduct);
router.put   ('/seller/products/:productId',  protectEpfSeller, uploadEpfProduct.array('images', 5), sellerCtrl.updateProduct);
router.patch ('/seller/products/:productId/daily', protectEpfSeller, sellerCtrl.updateDailyStock);
router.delete('/seller/products/:productId', protectEpfSeller, sellerCtrl.deleteProduct);

// Orders
router.get ('/seller/orders',                protectEpfSeller, sellerCtrl.getOrders);
router.get ('/seller/orders/:orderId',       protectEpfSeller, sellerCtrl.getOrderDetail);
router.post('/seller/orders/:orderId/accept', protectEpfSeller, sellerCtrl.acceptOrder);
router.post('/seller/orders/:orderId/reject', protectEpfSeller, sellerCtrl.rejectOrder);
router.post('/seller/orders/:orderId/packed-photos', protectEpfSeller, uploadEpfPacked.array('photos', 5), sellerCtrl.uploadPackedPhotos);

// Payouts
router.get('/seller/payouts', protectEpfSeller, sellerCtrl.getPayouts);

// ══════════════════════════════════════════════════════════
// ADMIN PANEL
// ══════════════════════════════════════════════════════════

// Dashboard
router.get('/admin/dashboard', protectAdmin, adminCtrl.getDashboard);
router.get('/admin/analytics', protectAdmin, adminCtrl.getAnalytics);

// Sellers
router.post('/admin/sellers',                        protectSuperAdmin, adminCtrl.createSeller);
router.get ('/admin/sellers',                        protectAdmin, adminCtrl.getSellers);
router.get ('/admin/sellers/:sellerId',               protectAdmin, adminCtrl.getSellerDetail);
router.post('/admin/sellers/:sellerId/approve',       protectSuperAdmin, adminCtrl.approveSeller);
router.post('/admin/sellers/:sellerId/reject',        protectSuperAdmin, adminCtrl.rejectSeller);
router.post('/admin/sellers/:sellerId/suspend',       protectSuperAdmin, adminCtrl.suspendSeller);
router.patch('/admin/sellers/:sellerId/commission',   protectSuperAdmin, adminCtrl.adjustCommission);

// Products
router.get ('/admin/products/pending',               protectAdmin, adminCtrl.getPendingProducts);
router.post('/admin/products/:productId/approve',    protectAdmin, adminCtrl.approveProduct);
router.post('/admin/products/:productId/reject',     protectAdmin, adminCtrl.rejectProduct);

// Orders
router.get ('/admin/orders',                         protectAdmin, adminCtrl.getOrders);
router.get ('/admin/orders/:orderId',                protectAdmin, adminCtrl.getOrderDetail);
router.post('/admin/orders/:orderId/approve-packed', protectAdmin, adminCtrl.approvePackedPhotos);
router.post('/admin/orders/:orderId/reject-packed',  protectAdmin, adminCtrl.rejectPackedPhotos);
router.post('/admin/orders/:orderId/cancel',         protectAdmin, adminCtrl.cancelOrder);
router.post('/admin/orders/:orderId/override-delivery', protectAdmin, adminCtrl.overrideDelivery);

// Payouts
router.get ('/admin/payouts',       protectAdmin, adminCtrl.getPayouts);
router.post('/admin/payouts/settle',protectAdmin, adminCtrl.settlePayout);
router.post('/admin/refund',        protectAdmin, adminCtrl.processRefund);

// Coupons
router.get ('/admin/coupons',              protectAdmin, adminCtrl.getCoupons);
router.post('/admin/coupons',              protectAdmin, adminCtrl.createCoupon);
router.patch('/admin/coupons/:couponId/toggle', protectAdmin, adminCtrl.toggleCoupon);

// Delivery Config
router.get('/admin/delivery-config',       protectAdmin,      adminCtrl.getDeliveryConfig);
router.put('/admin/delivery-config',       protectSuperAdmin, adminCtrl.updateDeliveryConfig);

module.exports = router;
