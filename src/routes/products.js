const express = require('express');
const router = express.Router();
const {
  getProducts, getProduct, getSellerProducts, createProduct, updateProduct,
  deleteProduct, removeProductImage, addReview, searchProducts
} = require('../controllers/productController');
const { protect } = require('../middleware/auth');
const { protectAdmin } = require('../middleware/adminAuth');
const { uploadProduct } = require('../config/cloudinary');

// Seller or admin/superAdmin access
const protectSeller = [
  protect,
  (req, res, next) => {
    if (['seller', 'admin', 'superAdmin'].includes(req.user.role)) return next();
    return res.status(403).json({ success: false, message: 'Seller access required' });
  },
];

router.get('/search', searchProducts);
router.get('/seller/mine', protectSeller, getSellerProducts); // must be before /:slug
router.get('/', getProducts);
router.get('/:slug', getProduct);

// Seller + Admin: create and update products
router.post('/', protectSeller, uploadProduct.array('images', 5), createProduct);
router.put('/:id', protectSeller, uploadProduct.array('images', 5), updateProduct);

// Admin only: delete products, remove images
router.delete('/:id', protectAdmin, deleteProduct);
router.delete('/:id/image/:imageId', protectAdmin, removeProductImage);

// User routes
router.post('/:id/review', protect, addReview);

module.exports = router;
