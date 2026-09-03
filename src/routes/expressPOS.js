// ============================================
// EPTOMART EXPRESS — POS Routes
// Mounted at /api/express/pos. Login is public; everything else requires a
// valid POS session (protectExpressPOS).
// ============================================
const express = require('express');
const router = express.Router();
const authCtrl = require('../controllers/expressPOSAuthController');
const ctrl = require('../controllers/expressPOSController');
const { protectExpressPOS } = require('../middleware/expressAuth');

router.post('/login', authCtrl.login);
router.get ('/me',    protectExpressPOS, authCtrl.me);

router.get ('/products', protectExpressPOS, ctrl.listProducts);

router.get   ('/bills',              protectExpressPOS, ctrl.listMyBills);
router.post  ('/bills',              protectExpressPOS, ctrl.createBill);
router.get   ('/bills/:billId',      protectExpressPOS, ctrl.getBill);
router.post  ('/bills/:billId/item', protectExpressPOS, ctrl.updateBillItem);
router.patch ('/bills/:billId/complete', protectExpressPOS, ctrl.completeBill);
router.patch ('/bills/:billId/void',     protectExpressPOS, ctrl.voidBill);

module.exports = router;
