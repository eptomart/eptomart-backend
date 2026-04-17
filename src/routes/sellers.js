const express  = require('express');
const router   = express.Router();
const { protect }           = require('../middleware/auth');
const { protectAdmin, protectSuperAdmin } = require('../middleware/adminAuth');
const sellerAuth            = require('../middleware/sellerAuth');
const {
  listSellers, createSeller, getSeller, updateSeller,
  setSellerStatus, deleteSeller, getMyProfile, updateMyProfile, getSellerStats,
} = require('../controllers/sellerController');

// Seller self-service must come BEFORE /:id so /me/profile is not treated as an ID
router.get('/me/profile',   sellerAuth, getMyProfile);
router.put('/me/profile',   sellerAuth, updateMyProfile);
router.get('/me/stats',     sellerAuth, getSellerStats);

// SuperAdmin only: create / delete sellers
router.post('/',            ...protectSuperAdmin, createSeller);
router.delete('/:id',       ...protectSuperAdmin, deleteSeller);

// Admin + SuperAdmin: list / view / update sellers
router.get('/',             ...protectAdmin, listSellers);
router.get('/:id',          ...protectAdmin, getSeller);
router.put('/:id',          ...protectAdmin, updateSeller);
router.patch('/:id/status', ...protectAdmin, setSellerStatus);
router.get('/:id/stats',    ...protectAdmin, getSellerStats);

module.exports = router;
