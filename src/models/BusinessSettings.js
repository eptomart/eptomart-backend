const mongoose = require('mongoose');

// Singleton settings document — always one record in the collection
const businessSettingsSchema = new mongoose.Schema({
  name:    { type: String, default: 'Eptomart' },
  tagline: { type: String, default: "India's fast, affordable online shopping destination" },
  address: { type: String, default: '22, Murali Krishna Nagar 1st Main Rd, Murali Krishna Nagar, Valasaravakkam, Chennai, Tamil Nadu – 600087' },
  phone:   { type: String, default: '+91 6369 129 995' },
  email:   { type: String, default: 'support@eptomart.com' },
  website: { type: String, default: 'www.eptomart.com' },
  gstNo:   { type: String, default: '' },
  state:   { type: String, default: 'Tamil Nadu' },
  city:    { type: String, default: 'Chennai' },
  pincode: { type: String, default: '600087' },

  // Koyambedu Daily home hero video (admin-configurable)
  koyambeduHeroVideo: {
    enabled: { type: Boolean, default: false },
    url:     { type: String, default: '' },   // mp4/webm URL (Cloudinary etc.)
    poster:  { type: String, default: '' },   // image shown before video loads
    caption: { type: String, default: 'Fresh from Koyambedu market — every morning' },
  },
}, { timestamps: true });

// Always return the single settings document, creating it if missing
businessSettingsSchema.statics.getSettings = async function () {
  let settings = await this.findOne();
  if (!settings) settings = await this.create({});
  return settings;
};

module.exports = mongoose.model('BusinessSettings', businessSettingsSchema);
