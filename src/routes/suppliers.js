const express = require('express');
const router  = express.Router();
const { protect, restrictTo } = require('../middleware/auth');
const {
  getSuppliers, createSupplier, getSupplier,
  updateSupplier, deleteSupplier, aiDescribeSupplier,
} = require('../controllers/supplierController');

// All routes require login (admin or seller)
router.use(protect);

router.get('/',         getSuppliers);
router.post('/',        createSupplier);
router.get('/:id',      getSupplier);
router.put('/:id',      updateSupplier);
router.delete('/:id',   deleteSupplier);
router.post('/:id/ai-describe', aiDescribeSupplier);

module.exports = router;
