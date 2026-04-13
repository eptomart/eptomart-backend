const express = require('express');
const router = express.Router();
const { placeOrder, getMyOrders, getOrder, cancelOrder } = require('../controllers/orderController');
const { protect } = require('../middleware/auth');

router.post('/', protect, placeOrder);
router.get('/', protect, getMyOrders);
router.get('/:id', protect, getOrder);
router.put('/:id/cancel', protect, cancelOrder);

module.exports = router;
