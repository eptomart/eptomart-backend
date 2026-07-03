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
const { renderOrderDocument } = require('../services/orders/documentService');

// Tab / vertical configuration (registry-driven)
router.get('/verticals', protect, (req, res) => {
  res.json({ success: true, verticals: svc.getVerticalTabs() });
});

// Merged order list
router.get('/', protect, async (req, res) => {
  try {
    const { vertical = 'all', page = 1, limit = 20, status, from, to } = req.query;
    const result = await svc.listOrders(req.user._id, { vertical, page, limit, status, from, to });
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('GET /v2/orders:', err);
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

// Download a 3-stage document (proforma / confirmation / tax) as PDF.
// Availability is enforced server-side: e.g. tax invoices exist only
// after delivery, and never include declined items.
router.get('/:vertical/:id/documents/:type', protect, async (req, res) => {
  try {
    const { vertical, id, type } = req.params;
    if (!['proforma', 'confirmation', 'tax'].includes(type)) {
      return res.status(400).json({ success: false, message: 'Unknown document type' });
    }
    // getOrderDetail enforces ownership (buyer-scoped query in adapters)
    const dto = await svc.getOrderDetail(req.user._id, vertical, id);
    const docMeta = (dto.documents || []).find(d => d.type === type);
    if (!docMeta) {
      return res.status(404).json({ success: false, message: 'This document does not exist for this order' });
    }
    if (!docMeta.available) {
      return res.status(403).json({ success: false, codPending: type === 'tax', message: docMeta.note || 'Document not available yet' });
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${docMeta.number || type}-${dto.orderId}.pdf"`);
    renderOrderDocument(type, dto, res);
  } catch (err) {
    if (err.name === 'CastError') {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }
    console.error('GET /v2/orders documents:', err);
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
