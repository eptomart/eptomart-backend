const BusinessSettings = require('../models/BusinessSettings');

// GET /api/settings  — public (needed for storefront footer, invoice preview)
const getSettings = async (req, res) => {
  const settings = await BusinessSettings.getSettings();
  res.json({ success: true, settings });
};

// PUT /api/settings  — superAdmin only
const updateSettings = async (req, res) => {
  const allowed = ['name', 'tagline', 'address', 'phone', 'email', 'website', 'gstNo', 'state', 'city', 'pincode'];
  let settings = await BusinessSettings.getSettings();
  allowed.forEach(k => { if (req.body[k] !== undefined) settings[k] = req.body[k]; });
  await settings.save();
  res.json({ success: true, settings });
};

module.exports = { getSettings, updateSettings };
