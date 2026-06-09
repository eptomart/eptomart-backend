// ============================================
// EPTOFRESH CART MODEL
// One cart per user — single seller per cart (hyperlocal constraint)
// ============================================
const mongoose = require('mongoose');
const { Schema } = mongoose;

const eptoFreshCartSchema = new Schema({
  user:   { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  seller: { type: Schema.Types.ObjectId, ref: 'EptoFreshSeller' }, // locked to one seller

  items: [{
    product:  { type: Schema.Types.ObjectId, ref: 'EptoFreshProduct', required: true },
    variantId:{ type: Schema.Types.ObjectId },  // _id of variant
    weight:   Number,
    label:    String,
    price:    Number,
    quantity: { type: Number, default: 1, min: 1 },
    cutType:  String,
    name:     String,
    image:    String,
  }],

  // Snapshot of seller distance at cart creation
  distanceKm: Number,

}, { timestamps: true });

eptoFreshCartSchema.index({ user: 1 });

module.exports = mongoose.model('EptoFreshCart', eptoFreshCartSchema);
