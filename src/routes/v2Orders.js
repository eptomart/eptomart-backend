// ============================================
// UNIFIED ORDERS API — v2
// One Orders API for every Eptomart vertical.
//
//   GET /api/v2/orders/verticals          → tab config
//   GET /api/v2/orders?vertical=all&page= → merged order cards
//   GET /api/v2/orders/:vertical/:id      → full canonical order detail
// ============================================
const express = require('express');
const router  = express.Router();
const { protect } = require('../middleware/auth');
const svc = require('../services/orders/unifiedOrderService');

// Tab / vertical configuration (registry-driven)
router.get('/verticals', protect, (req, res) => {
  res.json({ success: true, verticals: svc.getVerticalTabs() });
});

// Merged order list
router.get('/', protect, async (req, res) => {
  try {
    const { vertical = 'all', page = 1, limit = 20 } = req.query;
    const result = await svc.listOrders(req.user._id, { vertical, page, limit });
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('GET /v2/orders:', err);
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

// Full order detail (canonical DTO)
router.get('/:vertical/:id', protect, async (req, res) => {
  try {
    const order = await svc.getOrderDetail(req.user._id, req.params.vertical, req.params.id);
    res.json({ success: true, order });
  } catch (err) {
    if (err.name === 'CastError') {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }
    console.error('GET /v2/orders/:vertical/:id:', err);
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

module.exports = router;
