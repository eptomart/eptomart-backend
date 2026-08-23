const express = require('express');
const router = express.Router();
const { unifiedSearch } = require('../controllers/searchController');

// GET /api/search?q=...  — unified, ecosystem-wide, near-match product search
router.get('/', unifiedSearch);

module.exports = router;
