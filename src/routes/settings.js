const express = require('express');
const router  = express.Router();
const { getSettings, updateSettings } = require('../controllers/settingsController');
const { protectSuperAdmin } = require('../middleware/adminAuth');

router.get('/',  getSettings);                    // public — storefront + invoice preview
router.put('/',  ...protectSuperAdmin, updateSettings); // superAdmin only

module.exports = router;
