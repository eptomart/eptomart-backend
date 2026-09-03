// ============================================
// KOYAMBEDU HOME TABS — Controller
// Master on/off switch for the "Bulk Harvest" and "News" tabs that sit
// alongside "Koyambedu Daily" on the /koyambedu tab switcher. See
// KoyambeduHomeTabsSettings.js for the schema and rationale.
// ============================================
const KoyambeduHomeTabsSettings = require('../models/KoyambeduHomeTabsSettings');

/** GET /koyambedu/home-tabs/status — PUBLIC, read by the customer-facing tab switcher */
const getPublicStatus = async (req, res) => {
  try {
    const status = await KoyambeduHomeTabsSettings.getPublicStatus();
    res.json({ success: true, ...status });
  } catch (err) {
    console.error('[koyambeduHomeTabs.getPublicStatus]', err);
    res.status(500).json({ success: false, message: 'Failed to load tab settings' });
  }
};

/** GET /koyambedu/home-tabs/admin/settings — SUPER ADMIN */
const adminGetSettings = async (req, res) => {
  try {
    const doc = await KoyambeduHomeTabsSettings.getGlobal();
    res.json({ success: true, settings: doc });
  } catch (err) {
    console.error('[koyambeduHomeTabs.adminGetSettings]', err);
    res.status(500).json({ success: false, message: 'Failed to load settings' });
  }
};

/** PATCH /koyambedu/home-tabs/admin/settings/bulk-harvest — SUPER ADMIN */
const adminToggleBulkHarvest = async (req, res) => {
  try {
    const { enabled } = req.body;
    const doc = await KoyambeduHomeTabsSettings.findOneAndUpdate(
      { key: 'global' },
      {
        bulkHarvestEnabled: !!enabled,
        bulkHarvestEnabledBy: req.user._id,
        bulkHarvestEnabledByName: req.user.name,
        bulkHarvestEnabledAt: new Date(),
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.json({ success: true, settings: doc });
  } catch (err) {
    console.error('[koyambeduHomeTabs.adminToggleBulkHarvest]', err);
    res.status(500).json({ success: false, message: 'Failed to update setting' });
  }
};

/** PATCH /koyambedu/home-tabs/admin/settings/news — SUPER ADMIN */
const adminToggleNews = async (req, res) => {
  try {
    const { enabled } = req.body;
    const doc = await KoyambeduHomeTabsSettings.findOneAndUpdate(
      { key: 'global' },
      {
        newsEnabled: !!enabled,
        newsEnabledBy: req.user._id,
        newsEnabledByName: req.user.name,
        newsEnabledAt: new Date(),
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.json({ success: true, settings: doc });
  } catch (err) {
    console.error('[koyambeduHomeTabs.adminToggleNews]', err);
    res.status(500).json({ success: false, message: 'Failed to update setting' });
  }
};

module.exports = { getPublicStatus, adminGetSettings, adminToggleBulkHarvest, adminToggleNews };
