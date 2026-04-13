const express = require('express');
const router = express.Router();
const {
  getProducts, getProduct, createProduct, updateProduct,
  deleteProduct, removeProductImage, addReview, searchProducts
} = require('../controllers/productController');
const { protect } = require('../middleware/auth');
const { protectAdmin } = require('../middleware/adminAuth');
const { uploadProduct } = require('../config/cloudinary');

router.get('/search', searchProducts);
router.get('/', getProducts);
router.get('/:slug', getProduct);

// Admin routes
router.post('/', protectAdmin, uploadProduct.array('images', 5), createProduct);
router.put('/:id', protectAdmin, uploadProduct.array('images', 5), updateProduct);
router.delete('/:id', protectAdmin, deleteProduct);
router.delete('/:id/image/:imageId', protectAdmin, removeProductImage);

// User routes
router.post('/:id/review', protect, addReview);

module.exports = router;
