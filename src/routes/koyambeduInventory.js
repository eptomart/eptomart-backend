// ============================================
// KOYAMBEDU INVENTORY / PURCHASE / WASTAGE / PROFIT — Routes
// Mounted at /api/koyambedu/inventory (Super Admin only throughout).
// New, additive route file — does not alter any existing koyambedu route.
// ============================================
const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/koyambeduInventoryController');
const { protectSuperAdmin } = require('../middleware/adminAuth');
const { uploadKoyambeduBill } = require('../config/cloudinary');

router.use(protectSuperAdmin);

// Purchases
router.post  ('/purchases',      ctrl.createPurchase);
router.get   ('/purchases',      ctrl.listPurchases);
router.patch ('/purchases/:id',  ctrl.updatePurchase);
router.delete('/purchases/:id',  ctrl.deletePurchase);
// Optional bill/receipt attachment (image or PDF, max 10MB)
router.post  ('/purchases/:id/bill', uploadKoyambeduBill.single('bill'), ctrl.uploadPurchaseBill);

// Wastage
router.post  ('/wastage',        ctrl.createWastage);
router.get   ('/wastage',        ctrl.listWastage);
router.delete('/wastage/:id',    ctrl.deleteWastage);

// Packing material / other non-produce usage — linked to a specific order
router.get   ('/material-purchases', ctrl.listMaterialPurchases);
router.post  ('/material-usage',     ctrl.createMaterialUsage);
router.get   ('/material-usage',     ctrl.listMaterialUsage);
router.delete('/material-usage/:id', ctrl.deleteMaterialUsage);
router.get   ('/orders/lookup',      ctrl.lookupOrder);

// Balance + Profit report
router.get   ('/balance',        ctrl.getInventoryBalance);
router.get   ('/profit-report',  ctrl.getProfitReport);

// Lookups
router.get   ('/products',       ctrl.listProductsLite);
router.get   ('/sellers',        ctrl.listSellersLite);

module.exports = router;
