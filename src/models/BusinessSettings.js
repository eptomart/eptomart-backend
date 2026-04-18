const mongoose = require('mongoose');

// Singleton settings document — always one record in the collection
const businessSettingsSchema = new mongoose.Schema({
  name:    { type: String, default: 'Eptomart' },
  tagline: { type: String, default: "India's fast, affordable online shopping destination" },
  address: { type: String, default: 'No.2, 3rd St, Janaki Nagar, Karthikeyan Nagar, Maduravoyal, Chennai, Tamil Nadu – 600095' },
  phone:   { type: String, default: '+91 6369 129 995' },
  email:   { type: String, default: 'support@eptomart.com' },
  website: { type: String, default: 'www.eptomart.com' },
  gstNo:   { type: String, default: '' },
  state:   { type: String, default: 'Tamil Nadu' },
  city:    { type: String, default: 'Chennai' },
  pincode: { type: String, default: '600095' },
}, { timestamps: true });

// Always return the single settings document, creating it if missing
businessSettingsSchema.statics.getSettings = async function () {
  let settings = await this.findOne();
  if (!settings) settings = await this.create({});
  return settings;
};

module.exports = mongoose.model('BusinessSettings', businessSettingsSchema);
