// ============================================
// WISHLIST ROUTES
// ============================================
const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Product = require('../models/Product');
const { protect } = require('../middleware/auth');

// Get wishlist
router.get('/', protect, async (req, res) => {
  const user = await User.findById(req.user._id).populate('wishlist', 'name slug price discountPrice images ratings stock');
  res.json({ success: true, wishlist: user.wishlist || [] });
});

// Add to wishlist
router.post('/:productId', protect, async (req, res) => {
  const { productId } = req.params;
  const product = await Product.findById(productId);
  if (!product) return res.status(404).json({ success: false, message: 'Product not found' });

  const user = await User.findById(req.user._id);
  const alreadyIn = user.wishlist.includes(productId);

  if (alreadyIn) {
    // Toggle: remove if already in
    user.wishlist = user.wishlist.filter(id => id.toString() !== productId);
    await user.save();
    return res.json({ success: true, message: 'Removed from wishlist', inWishlist: false });
  }

  user.wishlist.push(productId);
  await user.save();
  res.json({ success: true, message: 'Added to wishlist! ❤️', inWishlist: true });
});

// Clear wishlist
router.delete('/', protect, async (req, res) => {
  await User.findByIdAndUpdate(req.user._id, { wishlist: [] });
  res.json({ success: true, message: 'Wishlist cleared' });
});

module.exports = router;
