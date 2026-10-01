// ============================================
// EPTOMART EXPRESS — Promotional Hero Banner Model
// Admin-created banners shown at the top of the Express storefront (flash
// sales with start/end timings, lowest-price promotions, or any custom
// announcement). Completely separate from Koyambedu Daily's combo/flash
// sale banner and from Home.jsx's static Express promo card — this powers
// a dynamic, admin-managed carousel INSIDE the Express shop itself.
// Scheduling (startAt/endAt) lets the admin create a flash-sale banner
// ahead of time and have it appear/disappear automatically, without
// needing to toggle isActive by hand at the exact minute.
// ============================================
const mongoose = require('mongoose');

const expressBannerSchema = new mongoose.Schema({
  title:    { type: String, required: [true, 'Title is required'], trim: true },
  subtitle: { type: String, trim: true, default: '' },

  // Purely a display/category tag the admin picks — does not change any
  // pricing or product-selection logic; 'flash-sale' and 'lowest-price' get
  // a distinct default look (see FE), 'custom' is a blank slate.
  type: { type: String, enum: ['flash-sale', 'lowest-price', 'custom'], default: 'custom' },

  // Visuals — a photo (Cloudinary URL) if the admin uploads one, otherwise
  // a gradient pair of hex colors is used as the background (always has a
  // sane default so a banner never renders with no background at all).
  image: { type: String, default: null },
  gradientFrom: { type: String, default: '#4338ca' },
  gradientTo:   { type: String, default: '#7c3aed' },

  // Where tapping the banner takes the customer. Defaults to the Express
  // shop itself; a specific product/category can be targeted later without
  // a schema change by just putting that URL/path here.
  linkTo: { type: String, default: '/express/shop' },
  ctaText: { type: String, default: 'Shop Now' },

  // Scheduling — null means "no bound on that side". A flash-sale banner
  // typically sets both; an evergreen banner (e.g. a standing lowest-price
  // promise) can leave both null and just use isActive to show/hide it.
  startAt: { type: Date, default: null },
  endAt:   { type: Date, default: null },

  isActive:  { type: Boolean, default: true },
  sortOrder: { type: Number, default: 0 }, // lower shows first

  createdBy: { type: String, default: null }, // admin name, for audit
}, { timestamps: true });

expressBannerSchema.index({ isActive: 1, sortOrder: 1 });

module.exports = mongoose.model('ExpressBanner', expressBannerSchema);
