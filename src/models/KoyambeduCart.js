// ============================================
// KOYAMBEDU CART MODEL
// ============================================
const mongoose = require('mongoose');
const { Schema } = mongoose;

const koyambeduCartSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },

  items: [{
    product:      { type: Schema.Types.ObjectId, ref: 'KoyambeduProduct', required: true },
    seller:       { type: Schema.Types.ObjectId, ref: 'KoyambeduSeller' },
    name:         String,
    unitPrice:    Number,
    unit:         String,
    unitLabel:    String,
    quantity:     { type: Number, required: true, min: 0 },
    deliveryType: { type: String, enum: ['today','tomorrow'], default: 'tomorrow' },
    // Grade system — null/undefined for non-graded products (backward compat)
    gradeKey:     { type: String, enum: ['premium','mixed','economy'], default: null },
    gradeName:    { type: String, default: null },
    addedAt:      { type: Date, default: Date.now },
  }],

  // Items taken out of the cart automatically because the product / seller
  // was unavailable at the time. Kept here (not deleted) so they come back on
  // their own when the product is available again. Cleared when an order is
  // placed or the cart is emptied. Each entry mirrors an item + parkedAt/reason.
  parked: { type: [Schema.Types.Mixed], default: [] },

  updatedAt: { type: Date, default: Date.now },
}, { timestamps: true });

koyambeduCartSchema.index({ user: 1 });

module.exports = mongoose.model('KoyambeduCart', koyambeduCartSchema);
