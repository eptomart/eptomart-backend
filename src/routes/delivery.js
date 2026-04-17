const express = require('express');
const router  = express.Router();
const { estimateDelivery, estimateCart, geocodePincode } = require('../controllers/deliveryController');
const { protect } = require('../middleware/auth');
const { protectAdmin } = require('../middleware/adminAuth');

// ── Existing delivery estimate routes ────────
router.post('/estimate',        estimateDelivery);
router.post('/estimate-cart',   estimateCart);
router.get('/geocode/:pincode', geocodePincode);

// ── Shiprocket routes (admin only) ───────────
const shiprocket = require('../utils/shiprocket');

// Check courier serviceability for pincode pair
router.get('/serviceability', ...protectAdmin, async (req, res) => {
  try {
    const { pickup, delivery, weight, cod } = req.query;
    if (!pickup || !delivery) {
      return res.status(400).json({ success: false, message: 'pickup and delivery pincodes required' });
    }
    const data = await shiprocket.getServiceability({
      pickupPincode: pickup,
      deliveryPincode: delivery,
      weight: Number(weight) || 0.5,
      cod: cod === 'true',
    });
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.response?.data?.message || err.message });
  }
});

// Create shipment for an order
router.post('/shipment', ...protectAdmin, async (req, res) => {
  try {
    const Order = require('../models/Order');
    const { orderId } = req.body;
    const order = await Order.findById(orderId).populate('user', 'name email phone').lean();
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    const shippingAddress = order.shippingAddress;
    const data = await shiprocket.createShipment(order, shippingAddress);

    // Save Shiprocket order ID back to order
    await Order.findByIdAndUpdate(orderId, {
      'shipping.shiprocketOrderId': data.order_id,
      'shipping.awb': data.shipment_id,
      'shipping.status': 'booked',
    });

    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.response?.data?.message || err.message });
  }
});

// Track shipment by AWB
router.get('/track/:awb', protect, async (req, res) => {
  try {
    const data = await shiprocket.trackByAWB(req.params.awb);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.response?.data?.message || err.message });
  }
});

// Cancel shipment
router.post('/cancel', ...protectAdmin, async (req, res) => {
  try {
    const { awbs } = req.body; // array of AWB strings
    const data = await shiprocket.cancelShipment(awbs);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.response?.data?.message || err.message });
  }
});

module.exports = router;
