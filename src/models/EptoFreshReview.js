// ============================================
// EPTOFRESH REVIEW MODEL
// Product and store ratings
// ============================================
const mongoose = require('mongoose');
const { Schema } = mongoose;

const eptoFreshReviewSchema = new Schema({
  order:    { type: Schema.Types.ObjectId, ref: 'EptoFreshOrder', required: true },
  buyer:    { type: Schema.Types.ObjectId, ref: 'User', required: true },
  seller:   { type: Schema.Types.ObjectId, ref: 'EptoFreshSeller', required: true },
  product:  { type: Schema.Types.ObjectId, ref: 'EptoFreshProduct' },

  // Ratings
  productRating: { type: Number, min: 1, max: 5 },
  storeRating:   { type: Number, min: 1, max: 5 },
  deliveryRating:{ type: Number, min: 1, max: 5 },

  // Review text
  comment: { type: String, trim: true, maxlength: 500 },
  images:  [String],

  // Admin moderation
  isApproved:  { type: Boolean, default: true },
  isHidden:    { type: Boolean, default: false },

}, { timestamps: true });

eptoFreshReviewSchema.index({ seller: 1 });
eptoFreshReviewSchema.index({ product: 1 });
eptoFreshReviewSchema.index({ buyer: 1 });
eptoFreshReviewSchema.index({ order: 1 });

module.exports = mongoose.model('EptoFreshReview', eptoFreshReviewSchema);
