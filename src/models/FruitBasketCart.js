// ============================================
// FRUIT BASKETS & HAMPERS — CART MODEL
// One document per user. Mirrors the KoyambeduCart pattern so this
// vertical can plug into the common /cart page as its own tab, while
// its checkout, pricing and Razorpay flow (fruitBasketController.js)
// remain completely untouched.
// ============================================
const mongoose = require('mongoose');
const { Schema } = mongoose;

const fruitBasketCartSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },

  items: [{
    product:  { type: Schema.Types.ObjectId, ref: 'FruitBasketProduct', required: true },
    name:     String,
    price:    Number,           // snapshot of selling price at time of add
    compareAtPrice: Number,     // snapshot of MRP (for strikethrough display in common cart)
    image:    String,
    occasion: String,
    weightKg: Number,
    quantity: { type: Number, required: true, min: 1, default: 1 },
    addedAt:  { type: Date, default: Date.now },
  }],

  updatedAt: { type: Date, default: Date.now },
}, { timestamps: true });

fruitBasketCartSchema.index({ user: 1 });

module.exports = mongoose.model('FruitBasketCart', fruitBasketCartSchema);
