// ============================================
// KOYAMBEDU NEWS — Post
// Admin-authored news items about vegetables/fruits (price trends, crop
// advisories, market updates), each citing a source and optionally
// admin-verified once the source has been checked. One image per post.
// Purely informational — no cart/checkout/pricing logic touches this.
// ============================================
const mongoose = require('mongoose');
const { Schema } = mongoose;

const koyambeduNewsPostSchema = new Schema({
  title:   { type: String, required: true, trim: true },
  summary: { type: String, required: true, trim: true },

  image: {
    url:      { type: String, default: null },
    publicId: { type: String, default: null },
  },

  sourceName: { type: String, required: true, trim: true }, // e.g. "Tamil Nadu Agri Marketing Board"
  sourceUrl:  { type: String, default: '' },                // optional link to the source

  verified:       { type: Boolean, default: false },
  verifiedBy:     { type: Schema.Types.ObjectId, ref: 'User' },
  verifiedByName: { type: String },
  verifiedAt:     { type: Date },

  status: { type: String, enum: ['active', 'inactive'], default: 'active' },

  createdBy:     { type: Schema.Types.ObjectId, ref: 'User' },
  createdByName: { type: String },
}, { timestamps: true });

koyambeduNewsPostSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('KoyambeduNewsPost', koyambeduNewsPostSchema);
