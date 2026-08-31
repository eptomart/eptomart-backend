// ============================================
// FRUIT BASKETS & HAMPERS — Order
// Separate, self-contained checkout flow (per product requirement — this
// vertical intentionally does NOT share a cart/checkout with any other
// Eptomart vertical). Razorpay create/verify pattern mirrors
// koyambeduController.js's placeOrder/createRazorpayOrder/verifyPayment
// exactly (see that file for the reference implementation).
// ============================================
const mongoose = require('mongoose');

const basketItemSchema = new mongoose.Schema({
  product:   { type: mongoose.Schema.Types.ObjectId, ref: 'FruitBasketProduct', required: true },
  name:      { type: String, required: true },   // snapshot at order time
  image:     { type: String, default: '' },       // snapshot at order time
  unitPrice: { type: Number, required: true },    // snapshot at order time
  quantity:  { type: Number, required: true, min: 1 },
  lineTotal: { type: Number, required: true },
}, { _id: false });

const timelineEventSchema = new mongoose.Schema({
  status: { type: String, required: true },
  note:   { type: String, default: '' },
  at:     { type: Date, default: Date.now },
  by:     { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  byName: { type: String },
}, { _id: false });

const fruitBasketOrderSchema = new mongoose.Schema({
  orderId: { type: String, unique: true, required: true }, // e.g. "FB-A1B2C3"
  buyer:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

  items: { type: [basketItemSchema], required: true, validate: v => v.length > 0 },

  deliveryAddress: {
    name:        { type: String, required: true },
    phone:       { type: String, required: true },
    addressLine: { type: String, required: true },
    city:        { type: String, default: '' },
    pincode:     { type: String, default: '' },
    label:       { type: String, default: '' }, // e.g. "Home", "Office"
    // Not required — geolocation can fail/be denied, in which case the order
    // still goes through using the pincode above and pricing.deliveryChargePending
    // below flags it for manual delivery-charge confirmation.
    lat:         { type: Number, default: null },
    lng:         { type: Number, default: null },
  },

  deliveryDate: { type: Date, required: true },
  deliverySlot: {
    key:       { type: String, required: true },
    label:     { type: String, required: true },
    startTime: { type: String },
    endTime:   { type: String },
  },

  pricing: {
    subtotal:       { type: Number, required: true },
    distanceKm:      { type: Number, default: null },
    deliveryCharge:  { type: Number, required: true },
    // true when the order was placed without live coordinates (geolocation
    // denied/unavailable) — deliveryCharge above is 0 until an admin
    // verifies the address and confirms/adjusts the real charge.
    deliveryChargePending: { type: Boolean, default: false },
    total:           { type: Number, required: true },
  },

  paymentStatus: { type: String, enum: ['pending', 'paid', 'failed'], default: 'pending' },
  // Set for the fixed demo/review account (User.isDemoAccount) — excluded from revenue reports.
  isDemoOrder: { type: Boolean, default: false },
  razorpayOrderId:   { type: String },
  razorpayPaymentId: { type: String },
  razorpaySignature: { type: String },

  orderStatus: {
    type: String,
    enum: ['placed', 'confirmed', 'preparing', 'out_for_delivery', 'delivered', 'cancelled'],
    default: 'placed',
  },
  cancelReason: { type: String, default: '' },

  timeline: { type: [timelineEventSchema], default: [] },

  notes: { type: String, default: '' }, // customer's optional gift note / special instructions
}, { timestamps: true });

fruitBasketOrderSchema.index({ buyer: 1, createdAt: -1 });
fruitBasketOrderSchema.index({ orderStatus: 1, deliveryDate: 1 });

module.exports = mongoose.model('FruitBasketOrder', fruitBasketOrderSchema);
