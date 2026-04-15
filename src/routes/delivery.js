const express = require('express');
const router  = express.Router();
const { estimateDelivery, estimateCart, geocodePincode } = require('../controllers/deliveryController');

router.post('/estimate',       estimateDelivery);
router.post('/estimate-cart',  estimateCart);
router.get('/geocode/:pincode', geocodePincode);

module.exports = router;
