const express = require('express');
const router  = express.Router();
const { chat, generateDescription, getSellerInsights } = require('../controllers/aiController');
const { protect } = require('../middleware/auth');

// Public (rate-limited by IP inside controller)
router.post('/chat', chat);

// Seller-protected
router.post('/generate-description', protect, generateDescription);
router.get('/seller-insights',       protect, getSellerInsights);

module.exports = router;
