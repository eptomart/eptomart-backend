// ============================================
// KOYAMBEDU BULK HARVEST — Listing (ad board, no transaction)
// Admin-entered ads for large-scale harvest availability direct from
// farmers across India (e.g. "70 tons of sweet lime available at
// Anantapur"). This is a classifieds/lead-gen board, NOT a shoppable
// product — there is no cart, no price engine, no checkout tied to this
// model. The only customer action is tapping "Call Farmer", which is
// gated behind login (see koyambeduBulkHarvestController.revealContact).
//
// Crop/quantity/price/location are shown to every visitor (including
// guests and search engines) as the public teaser. farmerName/farmerPhone
// are only ever returned by the gated reveal endpoint.
// ============================================
const mongoose = require('mongoose');
const { Schema } = mongoose;

const koyambeduBulkHarvestListingSchema = new Schema({
  // ── Public teaser fields — always visible ──────────────────────────
  cropName:  { type: String, required: true, trim: true },
  variety:   { type: String, trim: true, default: '' },

  // A short, persuasive one-liner admin writes to make a buyer want to
  // tap in — e.g. "Premium sweet lime, hand-picked and ready to ship
  // today." Shown as the card's hook line, above the raw stats.
  headline:  { type: String, trim: true, default: '' },

  quantityAvailable: { type: Number, required: true },  // total, e.g. 70
  quantityUnit:      { type: String, default: 'tons' }, // tons, quintals, kg
  dailyRate:         { type: Number, default: null },   // e.g. 12 (tons/day), optional
  dailyRateUnit:      { type: String, default: 'tons/day' },

  location: {
    village:  { type: String, default: '' },
    district: { type: String, default: '' },
    state:    { type: String, required: true },
  },

  harvestWindow: {
    start: { type: Date, default: null },
    end:   { type: Date, default: null },
  },

  // Free-text so admin can write "₹28-30/kg", "Contact for price", etc. —
  // there's no fixed sellable price since this isn't a transaction.
  priceText: { type: String, default: 'Contact for price' },

  images: {
    type: [{ url: String, publicId: String }],
    validate: [arr => arr.length <= 5, 'Up to 5 images allowed'],
    default: [],
  },

  // ── Gated fields — only ever sent by the reveal endpoint, never by the
  // public list/detail endpoints ──────────────────────────────────────
  farmerName:  { type: String, required: true },
  farmerPhone: { type: String, required: true },

  status: { type: String, enum: ['active', 'inactive', 'expired'], default: 'active' },

  // ── Engagement counters, kept denormalized for the admin dashboard so
  // it doesn't need to aggregate the event log on every page load. The
  // event log (KoyambeduBulkHarvestEvent) remains the source of truth for
  // the per-lead table. ──────────────────────────────────────────────
  viewCount:  { type: Number, default: 0 },
  callCount:  { type: Number, default: 0 },

  createdBy:     { type: Schema.Types.ObjectId, ref: 'User' },
  createdByName: { type: String },
}, { timestamps: true });

koyambeduBulkHarvestListingSchema.index({ status: 1, createdAt: -1 });
koyambeduBulkHarvestListingSchema.index({ cropName: 'text', 'location.state': 'text', 'location.district': 'text' });

/** Shape returned to every visitor, logged-in or not — never includes farmer contact info. */
koyambeduBulkHarvestListingSchema.methods.toTeaser = function() {
  return {
    _id: this._id,
    cropName: this.cropName,
    variety: this.variety,
    headline: this.headline,
    quantityAvailable: this.quantityAvailable,
    quantityUnit: this.quantityUnit,
    dailyRate: this.dailyRate,
    dailyRateUnit: this.dailyRateUnit,
    location: this.location,
    harvestWindow: this.harvestWindow,
    priceText: this.priceText,
    images: this.images,
    status: this.status,
    createdAt: this.createdAt,
  };
};

module.exports = mongoose.model('KoyambeduBulkHarvestListing', koyambeduBulkHarvestListingSchema);
