const express = require('express');
const router  = express.Router();
const {
  getSettings, updateSettings, contactUs, getEnquiries, updateEnquiry, productInquiry,
} = require('../controllers/settingsController');
const { protectSuperAdmin } = require('../middleware/adminAuth');
const { protect }           = require('../middleware/auth');
const { protectAdmin }      = require('../middleware/adminAuth');

// ── Public ────────────────────────────────────────────────
router.get('/',           getSettings);          // storefront + invoice preview
router.post('/contact',          contactUs);       // Contact Us form
router.post('/product-inquiry',  productInquiry);  // Search not found — notify admin + buyer

// ── Admin: enquiry management ─────────────────────────────
router.get('/enquiries',         ...protectAdmin, getEnquiries);
router.patch('/enquiries/:id',   ...protectAdmin, updateEnquiry);

// ── SuperAdmin: business settings ─────────────────────────
router.put('/', ...protectSuperAdmin, updateSettings);

module.exports = router;
