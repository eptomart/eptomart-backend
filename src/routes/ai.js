const express = require('express');
const router  = express.Router();
const { chat, generateDescription, getSellerInsights } = require('../controllers/aiController');
const { protect } = require('../middleware/auth');

// Quick connectivity test — GET /api/ai/test
router.get('/test', async (req, res) => {
  const { callClaude } = require('../utils/claudeApi');
  try {
    const result = await callClaude({
      messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
      max_tokens: 10,
    });
    res.json({ success: true, reply: result.text, model: 'claude-haiku-4-5-20251001' });
  } catch (err) {
    res.status(503).json({ success: false, error: err.message });
  }
});

// Public (rate-limited by IP inside controller)
router.post('/chat', chat);

// Seller-protected
router.post('/generate-description', protect, generateDescription);
router.get('/seller-insights',       protect, getSellerInsights);

module.exports = router;
