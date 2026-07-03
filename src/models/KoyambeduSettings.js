// ============================================
// KOYAMBEDU SETTINGS — Global singleton
// Stores market-wide settings like last price update time.
// Only one document exists (upserted via key='global').
// ============================================
const mongoose = require('mongoose');

const koyambeduSettingsSchema = new mongoose.Schema({
  key: { type: String, default: 'global', unique: true },

  // Set every time any product price is updated (daily price / bulk update)
  lastProductUpdateTime: { type: Date },
  lastProductUpdateBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  lastProductUpdateByName: { type: String },

}, { timestamps: true });

/** Upsert the global lastProductUpdateTime */
koyambeduSettingsSchema.statics.touchPriceUpdate = async function(userId, userName) {
  return this.findOneAndUpdate(
    { key: 'global' },
    { lastProductUpdateTime: new Date(), lastProductUpdateBy: userId, lastProductUpdateByName: userName },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
};

/** Get the global settings doc (creates if missing) */
koyambeduSettingsSchema.statics.getGlobal = async function() {
  let doc = await this.findOne({ key: 'global' });
  if (!doc) doc = await this.create({ key: 'global' });
  return doc;
};

module.exports = mongoose.model('KoyambeduSettings', koyambeduSettingsSchema);
