const express = require('express');
const router  = express.Router();
const { protect }    = require('../middleware/auth');
const protectAdmin   = require('../middleware/adminAuth').protectAdmin;
const { myInvoices, getInvoice, downloadPDF, allInvoices, regeneratePDF } = require('../controllers/invoiceController');

router.get('/',              protect, myInvoices);
router.get('/admin/all',     protect, protectAdmin, allInvoices);
router.get('/:id',           protect, getInvoice);
router.get('/:id/pdf',       protect, downloadPDF);
router.get('/:id/download',  protect, downloadPDF); // alias — frontend calls /download
router.post('/:id/regenerate', protect, protectAdmin, regeneratePDF);

module.exports = router;
