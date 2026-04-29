const express = require('express');
const router  = express.Router();
const { protect }                          = require('../middleware/auth');
const { protectAdmin, protectSuperAdmin }  = require('../middleware/adminAuth');
const {
  myInvoices, getInvoice, downloadPDF, allInvoices, regeneratePDF,
  downloadSellerInvoice, downloadAdminInvoice,
  downloadShippingLabel,
  downloadCustomerInvoiceBySeller,
  downloadCustomerInvoiceByOrderIdAdmin,
} = require('../controllers/invoiceController');

// Customer
router.get('/',                protect,                    myInvoices);
router.get('/:id',             protect,                    getInvoice);
router.get('/:id/pdf',         protect,                    downloadPDF);
router.get('/:id/download',    protect,                    downloadPDF);

// Seller — payout statement for an order
router.get('/seller/order/:orderId/download',          protect, downloadSellerInvoice);
// Seller — customer invoice (to share with buyer)
router.get('/seller/order/:orderId/customer-invoice',  protect, downloadCustomerInvoiceBySeller);

// Admin
router.get('/admin/all',                                   ...protectAdmin, allInvoices);
router.post('/:id/regenerate',                             ...protectAdmin, regeneratePDF);
router.get('/admin/order/:orderId/customer-invoice',       ...protectAdmin, downloadCustomerInvoiceByOrderIdAdmin);
router.get('/admin/order/:orderId/download',               ...protectAdmin, downloadAdminInvoice);
router.get('/admin/order/:orderId/shipping-label',         ...protectAdmin, downloadShippingLabel);

module.exports = router;
