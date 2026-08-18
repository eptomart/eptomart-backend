// ============================================
// KOYAMBEDU OFFER BROADCAST LOG
// One document per push-notification offer sent by a Super Admin to
// Koyambedu Daily customers (or all app subscribers). Purely a log/history
// record — the actual push delivery goes through the existing web-push
// pipeline (PushSubscription model + utils/pushNotification.js). Does not
// affect any other notification feature.
// ============================================
const mongoose = require('mongoose');
const { Schema } = mongoose;

const koyambeduOfferBroadcastSchema = new Schema({
  title: { type: String, required: true },
  body:  { type: String, required: true },
  url:   { type: String, default: '/koyambedu' },

  // Audience — mirrors the segments offered in the admin UI (Zomato/Swiggy-style targeting)
  segment: {
    type: String,
    enum: ['all_koyambedu', 'active', 'lapsed', 'all_subscribers'],
    required: true,
  },
  areaFilter: { type: String, default: '' }, // optional area/pincode/city text filter on top of segment

  audienceCount: { type: Number, default: 0 }, // matching users before subscription lookup
  sentCount:     { type: Number, default: 0 }, // pushes actually delivered
  failedCount:   { type: Number, default: 0 },

  sentBy:     { type: Schema.Types.ObjectId, ref: 'User' },
  sentByName: { type: String },
}, { timestamps: true });

module.exports = mongoose.model('KoyambeduOfferBroadcast', koyambeduOfferBroadcastSchema);
