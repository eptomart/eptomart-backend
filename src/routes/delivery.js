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

// ── Public: COD availability + EDD for a buyer pincode ──
// Used by checkout and product pages (no auth required)
router.get('/cod-check', async (req, res) => {
  try {
    const { delivery, pickup, weight } = req.query;
    if (!delivery) return res.status(400).json({ success: false, message: 'delivery pincode required' });

    // Default pickup pincode — use env or fallback
    const pickupPin = pickup || process.env.DEFAULT_PICKUP_PINCODE || '600001';

    if (!process.env.SHIPROCKET_EMAIL || !process.env.SHIPROCKET_PASSWORD) {
      // Shiprocket not configured — return optimistic estimate
      return res.json({ success: true, codAvailable: true, edd: null, note: 'Estimate based on location' });
    }

    const data = await shiprocket.getServiceability({
      pickupPincode:   pickupPin,
      deliveryPincode: delivery,
      weight:          Number(weight) || 0.5,
      cod:             true,
    });

    const couriers    = data?.data?.available_courier_companies || [];
    const codCouriers = couriers.filter(c => c.cod === 1);

    // Best COD courier by rate (cheapest with ETD)
    const codWithEtd     = codCouriers.filter(c => c.etd).sort((a, b) => (a.rate || 9999) - (b.rate || 9999));
    const bestCodCourier = codWithEtd[0];

    // Best overall courier (fastest EDD)
    const allWithEtd  = couriers.filter(c => c.etd).sort((a, b) => new Date(a.etd) - new Date(b.etd));
    const bestCourier = allWithEtd[0];

    // Use COD courier for display; fallback to overall best
    const display = bestCodCourier || bestCourier;

    const allRates = couriers.map(c => c.rate).filter(r => r > 0);
    const minRate  = allRates.length ? Math.min(...allRates) : null;

    res.json({
      success:         true,
      codAvailable:    codCouriers.length > 0,
      codCouriers:     codCouriers.length,
      edd:             display?.etd || null,
      eddDays:         display?.estimated_delivery_days || null,
      courierName:     display?.courier_name || null,
      shippingRate:    display?.rate          || null,   // ₹ — actual courier charge
      minShippingRate: minRate,                          // cheapest available courier
    });
  } catch (err) {
    console.error('[COD Check] Shiprocket serviceability failed:', err.message);
    // Don't block checkout — return graceful fallback
    res.json({ success: true, codAvailable: true, edd: null, note: 'Could not verify serviceability' });
  }
});

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
