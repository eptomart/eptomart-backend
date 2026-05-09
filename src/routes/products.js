const express = require('express');
const router = express.Router();
const {
  getProducts, getProduct, getSellerProducts, getAdminProducts, createProduct, updateProduct,
  deleteProduct, removeProductImage, addReview, searchProducts, cloneProduct, previewProduct,
  toggleProductActive, bulkUpdateStock, exportSellerStock, updateProductStock, bulkAssignSeller,
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

router.get('/search',     searchProducts);
router.get('/admin/all',  protectAdmin, getAdminProducts);   // must be before /:slug
router.get('/seller/mine', protectSeller, getSellerProducts); // must be before /:slug
router.get('/',           getProducts);
router.get('/:slug',      getProduct);

// Bulk stock update (seller + admin)
router.post('/bulk-stock',          protectSeller, bulkUpdateStock);
// Inline stock update — stock ONLY, never triggers approval (seller + admin)
router.patch('/:id/stock',          protectSeller, updateProductStock);
// Seller: export their own products as pre-filled CSV template
router.get('/seller/export-stock',  protectSeller, exportSellerStock);

// Seller + Admin: create and update products
router.post('/', protectSeller, uploadProduct.array('images', 5), createProduct);
router.put('/:id', protectSeller, uploadProduct.array('images', 5), updateProduct);

// Clone and preview (seller or admin)
router.post('/:id/clone',   protectSeller, cloneProduct);
router.get('/:id/preview',  protectSeller, previewProduct);

// Admin only: toggle active, bulk-assign to seller, remove images
router.patch('/:id/toggle-active',     protectAdmin,   toggleProductActive);
router.patch('/admin/bulk-assign',     protectAdmin,   bulkAssignSeller);
// Delete: sellers can delete their own drafts; admins can delete any
router.delete('/:id',                  protectSeller,  deleteProduct);
router.delete('/:id/image/:imageId',   protectSeller,  removeProductImage);

// Set an image as the main/default image (seller or admin)
router.patch('/:id/image/:imageId/set-default', protectSeller, async (req, res) => {
  try {
    const Product = require('../models/Product');
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ success: false, message: 'Product not found' });

    // Permission check: seller can only edit their own products
    if (req.user.role === 'seller') {
      const Seller = require('../models/Seller');
      const seller = await Seller.findOne({ user: req.user._id });
      if (!seller || product.seller.toString() !== seller._id.toString()) {
        return res.status(403).json({ success: false, message: 'Access denied' });
      }
    }

    // Set all isDefault false, then set target true
    product.images.forEach(img => { img.isDefault = false; });
    const target = product.images.id(req.params.imageId);
    if (!target) return res.status(404).json({ success: false, message: 'Image not found' });
    target.isDefault = true;

    await product.save();
    res.json({ success: true, images: product.images });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// User routes
router.post('/:id/review', protect, addReview);

module.exports = router;
