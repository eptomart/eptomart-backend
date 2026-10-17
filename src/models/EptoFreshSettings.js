// Global Proteins (EptoFresh) settings — master switch. Singleton key 'global'.
const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  key:     { type: String, default: 'global', unique: true },
  enabled: { type: Boolean, default: true },   // master switch (ON by default = backward compatible)
  offMessage: { type: String, default: 'Eptomart Proteins is temporarily unavailable. Please check back soon.' },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });
schema.statics.get = async function () {
  let d = await this.findOne({ key: 'global' });
  if (!d) d = await this.create({ key: 'global' });
  return d;
};
module.exports = mongoose.model('EptoFreshSettings', schema);
