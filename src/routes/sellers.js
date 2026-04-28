const express  = require('express');
const router   = express.Router();
const { protect }           = require('../middleware/auth');
const { protectAdmin, protectSuperAdmin } = require('../middleware/adminAuth');
const sellerAuth            = require('../middleware/sellerAuth');
const {
  listSellers, createSeller, getSeller, updateSeller,
  setSellerStatus, deleteSeller, restoreSeller, getMyProfile, updateMyProfile, getSellerStats,
  getMyPickupAddresses, addPickupAddress, deletePickupAddress, setDefaultPickupAddress, getSellerPickupAddresses,
} = require('../controllers/sellerController');

// Seller self-service must come BEFORE /:id so /me/profile is not treated as an ID
router.get('/me/profile',   sellerAuth, getMyProfile);
router.put('/me/profile',   sellerAuth, updateMyProfile);
router.get('/me/stats',     sellerAuth, getSellerStats);

// Seller pickup addresses (self-service)
router.get('/me/pickup-addresses',                      sellerAuth, getMyPickupAddresses);
router.post('/me/pickup-addresses',                     sellerAuth, addPickupAddress);
router.delete('/me/pickup-addresses/:addrId',           sellerAuth, deletePickupAddress);
router.patch('/me/pickup-addresses/:addrId/set-default',sellerAuth, setDefaultPickupAddress);

// SuperAdmin only: create / delete / restore sellers
router.post('/',              ...protectSuperAdmin, createSeller);
router.delete('/:id',         ...protectSuperAdmin, deleteSeller);
router.patch('/:id/restore',  ...protectSuperAdmin, restoreSeller);

// Admin + SuperAdmin: list / view / update sellers
router.get('/',                         ...protectAdmin, listSellers);
router.get('/:id',                      ...protectAdmin, getSeller);
router.put('/:id',                      ...protectAdmin, updateSeller);
router.patch('/:id/status',             ...protectAdmin, setSellerStatus);
router.get('/:id/stats',                ...protectAdmin, getSellerStats);
router.get('/:id/pickup-addresses',     ...protectAdmin, getSellerPickupAddresses);

module.exports = router;
