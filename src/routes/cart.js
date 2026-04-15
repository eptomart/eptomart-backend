const express = require('express');
const router  = express.Router();
const { protect } = require('../middleware/auth');
const { getCart, addToCart, updateCartItem, removeCartItem, clearCart, syncCart } = require('../controllers/cartController');

router.use(protect);

router.get('/',                getCart);
router.post('/add',            addToCart);
router.post('/sync',           syncCart);
router.put('/item/:itemId',    updateCartItem);
router.delete('/item/:itemId', removeCartItem);
router.delete('/',             clearCart);

module.exports = router;
