const express = require('express');
const router  = express.Router();
const {
  placeOrder, getMyOrders, getOrder, cancelOrder,
  getSellerOrders, sellerConfirmOrder, uploadPackageImages,
  getPendingPaymentOrders,
} = require('../controllers/orderController');
const { protect }         = require('../middleware/auth');
const { requireOrderPermission } = require('../middleware/orderPermissions');
const { uploadPackaging } = require('../config/cloudinary');

router.post('/',                     protect, placeOrder);
router.get('/',                      protect, getMyOrders);
router.get('/seller/mine',           protect, getSellerOrders);         // before /:id
router.get('/pending-payments',      protect, getPendingPaymentOrders);  // before /:id
router.get('/:id',                   protect, getOrder);
// Cancellation is Super Admin only (unified permission matrix) —
// customers receive a friendly "contact support" message instead.
router.put('/:id/cancel',            protect, requireOrderPermission('cancel_order'), cancelOrder);
router.patch('/:id/seller-confirm',  protect, sellerConfirmOrder);

// Seller: upload packaging photos (min 4 required to submit for admin review)
router.post('/:id/package-images',   protect, uploadPackaging.array('images', 10), uploadPackageImages);

module.exports = router;
