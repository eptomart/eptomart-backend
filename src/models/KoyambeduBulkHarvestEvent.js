// ============================================
// KOYAMBEDU BULK HARVEST — Event log (lead tracking)
// One row per meaningful visitor action on a listing:
//   'view'  — logged once per user per listing when they open the detail
//             page (guests are not logged, since there's no user to
//             attribute the lead to).
//   'call'  — logged every time a logged-in user taps "Call Farmer" and
//             the phone number is revealed. This is the real lead signal
//             admin cares about — see adminDashboard's lead table.
// ============================================
const mongoose = require('mongoose');
const { Schema } = mongoose;

const koyambeduBulkHarvestEventSchema = new Schema({
  listing: { type: Schema.Types.ObjectId, ref: 'KoyambeduBulkHarvestListing', required: true },
  user:    { type: Schema.Types.ObjectId, ref: 'User', required: true },
  action:  { type: String, enum: ['view', 'call'], required: true },
}, { timestamps: true });

koyambeduBulkHarvestEventSchema.index({ listing: 1, action: 1, createdAt: -1 });
koyambeduBulkHarvestEventSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('KoyambeduBulkHarvestEvent', koyambeduBulkHarvestEventSchema);
