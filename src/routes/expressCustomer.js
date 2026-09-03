// ============================================
// EPTOMART EXPRESS — Customer Routes (Phase 2)
// Mounted at /api/express. Store lookup + catalogue are public (no login
// needed to browse); cart requires login, same as every other vertical's
// cart. Kept entirely separate from /api/express/admin.
// ============================================
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/expressCustomerController');
const { protect } = require('../middleware/auth');

router.get ('/status',                     ctrl.getStatus);
router.post('/nearest-store',              ctrl.findNearestStore);
router.get ('/stores/:storeId/catalogue',  ctrl.getCatalogue);

router.get   ('/cart',       protect, ctrl.getCart);
router.post  ('/cart',       protect, ctrl.addToCart);
router.put   ('/cart',       protect, ctrl.updateCartItem);
router.delete('/cart/clear', protect, ctrl.clearCart);

module.exports = router;
