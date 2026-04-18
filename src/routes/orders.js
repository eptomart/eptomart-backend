const express = require('express');
const router = express.Router();
const { placeOrder, getMyOrders, getOrder, cancelOrder, getSellerOrders, sellerConfirmOrder } = require('../controllers/orderController');
const { protect } = require('../middleware/auth');

router.post('/',                    protect, placeOrder);
router.get('/',                     protect, getMyOrders);
router.get('/seller/mine',          protect, getSellerOrders);      // must be before /:id
router.get('/:id',                  protect, getOrder);
router.put('/:id/cancel',           protect, cancelOrder);
router.patch('/:id/seller-confirm', protect, sellerConfirmOrder);

module.exports = router;
