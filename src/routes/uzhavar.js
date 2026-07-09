// ============================================
// UZHAVAR FRESH ROUTES
// ============================================
const express  = require('express');
const router   = express.Router();
const ctrl     = require('../controllers/uzhavarController');
const { protect } = require('../middleware/auth');
const { protectAdmin } = require('../middleware/adminAuth');

const { uploadDocument } = require('../config/cloudinary');

// ── Public / Buyer ──────────────────────────
router.get('/farmers/all',             ctrl.getAllFarmers);
router.get('/farmers/nearby',          ctrl.getNearbyFarmers);
router.get('/farmers/:farmerId/products', ctrl.getFarmerProducts);
router.get('/farmers/:farmerId/profile',  ctrl.getFarmerProfile);
router.get('/products/homepage',       ctrl.getHomepageProducts);
router.get('/products/search',         ctrl.searchNearbyProducts);

// ── Buyer (auth required) ───────────────────
router.post('/orders',                   protect, ctrl.createOrder);
router.post('/orders/payment',           protect, ctrl.createPaymentOrder);
router.post('/orders/verify-payment',    protect, ctrl.verifyPayment);
router.post('/orders/:orderId/confirm',  protect, ctrl.buyerConfirmOrder);
router.post('/orders/:orderId/cancel',   protect, ctrl.cancelPaymentPendingOrder);
router.post('/orders/:orderId/rate',     protect, ctrl.rateOrder);
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
router.post('/farmer/upload-doc',       protect, uploadDocument.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });
    // Cloudinary storage engine puts the URL in req.file.path; memoryStorage fallback won't have it
    const url = req.file.path || req.file.filename || null;
    if (!url) return res.status(500).json({ success: false, message: 'Upload storage not configured' });
    res.json({ success: true, url });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});
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

  // Primary: look up by linked user ID
  let farmer = await Farmer.findOne({ user: req.user._id })
    .select('-aadhaarNumber -bankAccount.accountNumber -bankAccount.ifsc');

  // Fallback: admin-created farmers have user:null — match by phone and auto-link
  if (!farmer && req.user.phone) {
    farmer = await Farmer.findOne({ phone: req.user.phone, user: null })
      .select('-aadhaarNumber -bankAccount.accountNumber -bankAccount.ifsc');
    if (farmer) {
      farmer.user = req.user._id;
      await farmer.save();
    }
  }

  res.json({ success: true, farmer: farmer || null });
});

// ── Admin ───────────────────────────────────
router.post('/admin/farmers',                   ...protectAdmin, ctrl.adminCreateFarmer);
router.get('/admin/farmers',                    ...protectAdmin, ctrl.adminGetFarmers);
router.get('/admin/farmers/:farmerId',          ...protectAdmin, ctrl.adminGetFarmerDetail);
router.patch('/admin/farmers/:farmerId/action', ...protectAdmin, ctrl.adminApproveFarmer);
router.get('/admin/orders',             ...protectAdmin, ctrl.adminGetOrders);
router.get('/admin/subscriptions',      ...protectAdmin, ctrl.adminGetSubscriptions);
router.get('/admin/stats',              ...protectAdmin, ctrl.adminGetStats);

module.exports = router;
