// ============================================
// FRUIT BASKETS & HAMPERS — Routes
// Base: /api/fruitbaskets
// A standalone vertical — does not touch or depend on any other vertical's
// routes/controllers/models.
// ============================================
const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/fruitBasketController');
const { protect, optionalAuth } = require('../middleware/auth');
const { protectSuperAdmin } = require('../middleware/adminAuth');
const { uploadFruitBasket } = require('../config/cloudinary');

// ══════════════════════════════════════════════
// PUBLIC — no auth required
// ══════════════════════════════════════════════
router.get ('/status',                 ctrl.getPublicStatus); // feature on/off + slots + delivery tiers (Home.jsx banner + shop page)
router.get ('/products',               ctrl.getProducts);
router.get ('/products/:idOrSlug',     ctrl.getProductDetail);
router.post('/check-delivery',         optionalAuth, ctrl.checkDelivery);

// ══════════════════════════════════════════════
// BUYER — cart (server-persisted so items appear in the common /cart page)
// ══════════════════════════════════════════════
router.get   ('/cart',        protect, ctrl.getCart);
router.post  ('/cart',        protect, ctrl.updateCart);
router.delete('/cart/clear',  protect, ctrl.clearCart);

// ══════════════════════════════════════════════
// BUYER — auth required
// ══════════════════════════════════════════════
router.post('/quote',                       protect, ctrl.getQuote);
router.post('/orders/create-razorpay',      protect, ctrl.createRazorpayOrder);
router.post('/orders/verify-payment',       protect, ctrl.verifyPayment);
router.get ('/my-orders',                   protect, ctrl.getMyOrders);
router.get ('/my-orders/:orderId',          protect, ctrl.getMyOrder);
router.post('/orders/:orderId/cancel',      protect, ctrl.cancelMyOrder);

// ══════════════════════════════════════════════
// SUPER ADMIN — settings
// ══════════════════════════════════════════════
router.get ('/admin/settings',                        protectSuperAdmin, ctrl.adminGetSettings);
router.patch('/admin/settings/feature',                protectSuperAdmin, ctrl.adminToggleFeature);
router.put ('/admin/settings/same-day-delivery',       protectSuperAdmin, ctrl.adminUpdateSameDayDelivery);
router.put ('/admin/settings/delivery-slots',          protectSuperAdmin, ctrl.adminUpdateDeliverySlots);
router.put ('/admin/settings/delivery-charges',        protectSuperAdmin, ctrl.adminUpdateDeliveryCharges);

// ══════════════════════════════════════════════
// SUPER ADMIN — basket catalog
// ══════════════════════════════════════════════
router.get   ('/admin/products',              protectSuperAdmin, ctrl.adminGetProducts);
router.post  ('/admin/products',              protectSuperAdmin, ctrl.adminCreateProduct);
router.put   ('/admin/products/:productId',   protectSuperAdmin, ctrl.adminUpdateProduct);
router.delete('/admin/products/:productId',   protectSuperAdmin, ctrl.adminDeleteProduct);
router.post  ('/admin/upload-image',          protectSuperAdmin, uploadFruitBasket.single('image'), ctrl.uploadImage);
router.post  ('/admin/generate-description',  protectSuperAdmin, ctrl.adminGenerateDescription);

// ══════════════════════════════════════════════
// SUPER ADMIN — orders
// ══════════════════════════════════════════════
router.get  ('/admin/orders',                 protectSuperAdmin, ctrl.adminGetOrders);
router.patch('/admin/orders/:orderId/status', protectSuperAdmin, ctrl.adminUpdateOrderStatus);

module.exports = router;
