const express = require('express');
const router  = express.Router();
const { protect }    = require('../middleware/auth');
const protectAdmin   = require('../middleware/adminAuth').protectAdmin;
const sellerAuth     = require('../middleware/sellerAuth');
const {
  listSellers, createSeller, getSeller, updateSeller,
  setSellerStatus, deleteSeller, getMyProfile, updateMyProfile, getSellerStats,
} = require('../controllers/sellerController');

// Admin routes
router.get('/',              protect, protectAdmin, listSellers);
router.post('/',             protect, protectAdmin, createSeller);
router.get('/:id',           protect, protectAdmin, getSeller);
router.put('/:id',           protect, protectAdmin, updateSeller);
router.patch('/:id/status',  protect, protectAdmin, setSellerStatus);
router.delete('/:id',        protect, protectAdmin, deleteSeller);
router.get('/:id/stats',     protect, protectAdmin, getSellerStats);

// Seller self-service routes
router.get('/me/profile',    sellerAuth, getMyProfile);
router.put('/me/profile',    sellerAuth, updateMyProfile);
router.get('/me/stats',      sellerAuth, getSellerStats);

module.exports = router;
