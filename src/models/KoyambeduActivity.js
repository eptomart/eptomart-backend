// ============================================
// KOYAMBEDU DAILY — customer activity log
// What a logged-in customer DID in Koyambedu Daily that is not already
// stored elsewhere: pages / products viewed, searches, cart changes,
// payment-screen visits. Orders, wallet movements, requests and sign-ups are
// NOT duplicated here — the admin activity feed reads those straight from
// their own collections, so history is complete from day one.
// Auto-deleted after 180 days to keep the collection small.
// ============================================
const mongoose = require('mongoose');
const { Schema } = mongoose;

const TYPES = ['page_view', 'product_view', 'search', 'cart_set', 'cart_remove', 'cart_clear', 'checkout_view'];

const koyambeduActivitySchema = new Schema({
  user:        { type: Schema.Types.ObjectId, ref: 'User', required: true },
  type:        { type: String, enum: TYPES, required: true },
  product:     { type: Schema.Types.ObjectId, ref: 'KoyambeduProduct' },
  quantity:    Number,                 // cart_set: the quantity the customer set
  gradeKey:    String,
  deliveryType: String,
  query:       { type: String, maxlength: 120 },   // search text
  page:        { type: String, maxlength: 200 },   // path visited
  device:      String,                 // mobile | tablet | desktop
  sessionId:   String,
  createdAt:   { type: Date, default: Date.now },
}, { versionKey: false });

koyambeduActivitySchema.index({ user: 1, createdAt: -1 });
koyambeduActivitySchema.index({ createdAt: -1 });
koyambeduActivitySchema.index({ type: 1, createdAt: -1 });
koyambeduActivitySchema.index({ product: 1, createdAt: -1 });
koyambeduActivitySchema.index({ createdAt: 1 }, { expireAfterSeconds: 180 * 24 * 3600 });

module.exports = mongoose.model('KoyambeduActivity', koyambeduActivitySchema);
module.exports.TYPES = TYPES;
