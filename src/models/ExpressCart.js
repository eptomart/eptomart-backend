// ============================================
// EPTOMART EXPRESS — Cart Model
// One document per user, tied to a single store at a time (a customer only
// ever shops one nearest-store catalogue). Mirrors the FruitBasketCart
// pattern used elsewhere in the codebase.
// ============================================
const mongoose = require('mongoose');
const { Schema } = mongoose;

const expressCartSchema = new Schema({
  user:  { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  store: { type: Schema.Types.ObjectId, ref: 'ExpressStore', required: true },

  items: [{
    product:  { type: Schema.Types.ObjectId, ref: 'ExpressProduct', required: true },
    name:     String,
    unit:     String,
    price:    Number, // snapshot of computed selling price per unit at time of add
    quantity: { type: Number, required: true, min: 1, default: 1 },
    addedAt:  { type: Date, default: Date.now },
  }],
}, { timestamps: true });

expressCartSchema.index({ user: 1 });

module.exports = mongoose.model('ExpressCart', expressCartSchema);
