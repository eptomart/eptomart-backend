// ============================================
// EPTOMART EXPRESS — Order Model
// Mirrors the FruitBasketOrder pattern (its own standalone Razorpay
// create/verify flow — see fruitBasketController.js for the reference
// implementation this was modeled on). Completely isolated from every
// other vertical's order model/collection.
// ============================================
const mongoose = require('mongoose');
const { Schema } = mongoose;

const expressOrderSchema = new Schema({
  orderId: { type: String, required: true, unique: true },
  buyer: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  store: { type: Schema.Types.ObjectId, ref: 'ExpressStore', required: true },

  items: [{
    product:   { type: Schema.Types.ObjectId, ref: 'ExpressProduct', required: true },
    name:      String,
    unit:      String,
    unitPrice: Number,
    quantity:  Number,
    lineTotal: Number,
  }],

  deliveryAddress: {
    name: String,
    phone: String,
    addressLine: String,
    city: String,
    pincode: String,
    lat: Number,
    lng: Number,
  },

  pricing: {
    subtotal: { type: Number, default: 0 },
    total:    { type: Number, default: 0 },
  },

  totalWeightKg: { type: Number, default: 0 },

  paymentStatus: { type: String, enum: ['pending', 'paid', 'failed'], default: 'pending' },
  orderStatus: {
    type: String,
    enum: ['placed', 'confirmed', 'preparing', 'out_for_delivery', 'delivered', 'cancelled'],
    default: 'placed',
  },

  razorpayOrderId: String,
  razorpayPaymentId: String,
  razorpaySignature: String,
  isDemoOrder: { type: Boolean, default: false },

  cancelReason: String,
  notes: String,

  timeline: [{
    status: String,
    note: String,
    at: { type: Date, default: Date.now },
  }],
}, { timestamps: true });

expressOrderSchema.index({ buyer: 1, createdAt: -1 });
expressOrderSchema.index({ store: 1, orderStatus: 1 });

module.exports = mongoose.model('ExpressOrder', expressOrderSchema);
