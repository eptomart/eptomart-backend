const mongoose = require('mongoose');

const cartItemSchema = new mongoose.Schema({
  product:  { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  seller:   { type: mongoose.Schema.Types.ObjectId, ref: 'Seller' },
  quantity: { type: Number, required: true, min: 1, default: 1 },
  // Snapshot at time of add (so price changes don't silently affect cart)
  priceSnapshot: {
    price:       Number,
    gstRate:     Number,
    name:        String,
    image:       String,
    stock:       Number,
    codAvailable: Boolean,
  },
}, { _id: true, timestamps: true });

const cartSchema = new mongoose.Schema({
  user:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  items: [cartItemSchema],
}, { timestamps: true });

cartSchema.index({ user: 1 }, { unique: true });

module.exports = mongoose.model('Cart', cartSchema);
