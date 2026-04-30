const express = require('express');
const router  = express.Router();
const {
  placeOrder, getMyOrders, getOrder, cancelOrder,
  getSellerOrders, sellerConfirmOrder, uploadPackageImages,
} = require('../controllers/orderController');
const { protect }         = require('../middleware/auth');
const { uploadPackaging } = require('../config/cloudinary');

router.post('/',                     protect, placeOrder);
router.get('/',                      protect, getMyOrders);
router.get('/seller/mine',           protect, getSellerOrders);         // before /:id
router.get('/:id',                   protect, getOrder);
router.put('/:id/cancel',            protect, cancelOrder);
router.patch('/:id/seller-confirm',  protect, sellerConfirmOrder);

// Seller: upload packaging photos (min 4 required to submit for admin review)
router.post('/:id/package-images',   protect, uploadPackaging.array('images', 10), uploadPackageImages);

module.exports = router;
