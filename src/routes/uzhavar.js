// ============================================
// UZHAVAR FRESH ROUTES
// ============================================
const express  = require('express');
const router   = express.Router();
const ctrl     = require('../controllers/uzhavarController');
const { protect } = require('../middleware/auth');
const { protectAdmin } = require('../middleware/adminAuth');

// ── Public / Buyer ──────────────────────────
router.get('/farmers/nearby',          ctrl.getNearbyFarmers);
router.get('/farmers/:farmerId/products', ctrl.getFarmerProducts);
router.get('/products/search',         ctrl.searchNearbyProducts);

// ── Buyer (auth required) ───────────────────
router.post('/orders',                 protect, ctrl.createOrder);
router.post('/orders/payment',         protect, ctrl.createPaymentOrder);
router.post('/orders/verify-payment',  protect, ctrl.verifyPayment);
router.post('/orders/:orderId/confirm',protect, ctrl.buyerConfirmOrder);
router.post('/orders/:orderId/rate',   protect, ctrl.rateOrder);
router.get('/my-orders',               protect, async (req, res) => {
  const UzhavarOrder = require('../models/UzhavarOrder');
  const orders = await UzhavarOrder.find({ buyer: req.user._id })
    .populate('farmer', 'name address ratings')
    .sort({ createdAt: -1 }).lean();
  res.json({ success: true, orders });
});

// ── Subscription ────────────────────────────
router.post('/subscription',               protect, ctrl.createSubscription);
router.post('/subscription/verify',        protect, ctrl.verifySubscription);
router.get('/subscription/my',             protect, async (req, res) => {
  const UzhavarSubscription = require('../models/UzhavarSubscription');
  const sub = await UzhavarSubscription.findOne({ buyer: req.user._id, isActive: true, paymentStatus: 'paid' });
  res.json({ success: true, subscription: sub });
});

// ── Farmer self-service ─────────────────────
router.post('/farmer/register',         protect, ctrl.registerFarmer);
router.post('/farmer/products',         protect, ctrl.addFarmerProduct);
router.put('/farmer/products/:productId', protect, ctrl.updateFarmerProduct);
router.delete('/farmer/products/:productId', protect, ctrl.deleteFarmerProduct);
router.patch('/farmer/toggle-availability', protect, ctrl.toggleAvailability);
router.get('/farmer/orders',            protect, ctrl.getFarmerOrders);
router.post('/farmer/orders/:orderId/accept', protect, ctrl.farmerAcceptOrder);
router.post('/farmer/orders/:orderId/reject', protect, ctrl.farmerRejectOrder);
router.get('/farmer/me', protect, async (req, res) => {
  const Farmer = require('../models/Farmer');
  const farmer = await Farmer.findOne({ user: req.user._id })
    .select('-aadhaarNumber -bankAccount.accountNumber -bankAccount.ifsc');
  res.json({ success: true, farmer });
});

// ── Admin ───────────────────────────────────
router.get('/admin/farmers',            ...protectAdmin, ctrl.adminGetFarmers);
router.patch('/admin/farmers/:farmerId/action', ...protectAdmin, ctrl.adminApproveFarmer);
router.get('/admin/orders',             ...protectAdmin, ctrl.adminGetOrders);
router.get('/admin/subscriptions',      ...protectAdmin, ctrl.adminGetSubscriptions);
router.get('/admin/stats',              ...protectAdmin, ctrl.adminGetStats);

module.exports = router;
