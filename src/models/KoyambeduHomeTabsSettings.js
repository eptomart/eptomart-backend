// ============================================
// KOYAMBEDU HOME TABS — Global Settings (singleton)
// Controls which extra tabs show up next to "Koyambedu Daily" on the
// /koyambedu page's tab switcher — "Bulk Harvest" and "News". Koyambedu
// Daily itself is never gated by this doc; it always renders regardless
// of these flags, exactly as it does today (see KoyambeduHome.jsx).
//
// Mirrors the KoyambeduComboSettings singleton pattern exactly.
// ============================================
const mongoose = require('mongoose');

const koyambeduHomeTabsSettingsSchema = new mongoose.Schema({
  key: { type: String, default: 'global', unique: true },

  bulkHarvestEnabled:       { type: Boolean, default: false },
  bulkHarvestEnabledBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  bulkHarvestEnabledByName: { type: String },
  bulkHarvestEnabledAt:     { type: Date },

  newsEnabled:       { type: Boolean, default: false },
  newsEnabledBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  newsEnabledByName: { type: String },
  newsEnabledAt:     { type: Date },
}, { timestamps: true });

/** Get the global settings doc (creates with defaults if missing). */
koyambeduHomeTabsSettingsSchema.statics.getGlobal = async function() {
  let doc = await this.findOne({ key: 'global' });
  if (!doc) doc = await this.create({ key: 'global' });
  return doc;
};

/** Public-safe status — used by the /koyambedu tab switcher to decide which tabs to show. */
koyambeduHomeTabsSettingsSchema.statics.getPublicStatus = async function() {
  const doc = await this.getGlobal();
  return {
    bulkHarvestEnabled: !!doc.bulkHarvestEnabled,
    newsEnabled: !!doc.newsEnabled,
  };
};

module.exports = mongoose.model('KoyambeduHomeTabsSettings', koyambeduHomeTabsSettingsSchema);
