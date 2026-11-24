// ============================================
// KOYAMBEDU SAVED (NAMED) CART
// A customer can keep several carts — "Home", "Shop", "Mom's house" … — each
// optionally tagged to one of their saved addresses (which carries its pin).
// The cart currently in use is loaded into the single working KoyambeduCart
// document, so cart / checkout / orders need no changes; switching carts just
// swaps items in and out of it. Items here mirror the working-cart item shape.
// Super admin can create carts for a customer (createdByAdmin).
// ============================================
const mongoose = require('mongoose');
const { Schema } = mongoose;

const schema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 40 },
  addressId: { type: String, default: '' },          // one of user.addresses[]._id
  items: { type: [Schema.Types.Mixed], default: [] },
  createdByAdmin: { type: Schema.Types.ObjectId, ref: 'User' },
  lastUsedAt: { type: Date, default: Date.now },
}, { timestamps: true });

schema.index({ user: 1, name: 1 });

module.exports = mongoose.model('KoyambeduSavedCart', schema);
