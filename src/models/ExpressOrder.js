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
    subtotal:       { type: Number, default: 0 },
    deliveryFee:    { type: Number, default: 0 },
    // Flat global platform fee charged to the customer at checkout (see
    // ExpressMarginConfig.platformFeeAmount) — snapshotted here so a later
    // change to the global setting never rewrites what this customer was
    // actually charged.
    platformFee:    { type: Number, default: 0 },
    couponCode:     { type: String, default: null },
    couponDiscount: { type: Number, default: 0 },
    total:          { type: Number, default: 0 },
    // ── Profit/P&L fields (section: bill-wise + overall store profit) ──
    // itemsProcurementCost is a snapshot of what this order's items cost
    // Express to procure, computed at order time from each ExpressProduct's
    // procurementBaseCost — never recomputed later even if that cost
    // changes, so historical P&L stays accurate. transportCharge and
    // packingCharge are entered by the admin per order/bill (this order's
    // actual delivery-partner and packing cost), not auto-calculated.
    // razorpayFee is Razorpay's own cut, auto-computed from the standard
    // ~2% + GST rate on online (non-demo, non-COD) payments only.
    itemsProcurementCost: { type: Number, default: 0 },
    transportCharge:      { type: Number, default: null },
    packingCharge:         { type: Number, default: null },
    razorpayFee:           { type: Number, default: 0 },
  },

  totalWeightKg: { type: Number, default: 0 },

  // Which delivery window the customer picked at checkout — same-day slots
  // (only future ones are offered) or a next-day slot. Optional/nullable so
  // existing orders placed before this field existed remain valid.
  deliverySlot: {
    date:  { type: String, default: null }, // 'YYYY-MM-DD'
    label: { type: String, default: null }, // e.g. '4:00 PM - 6:00 PM'
    isNextDay: { type: Boolean, default: false },
  },

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

  // Section 15 — delivery expense recorded by the Store Manager per order
  deliveryExpense: {
    partner: String,
    amount: { type: Number, default: null },
    recordedByName: String,
    recordedAt: Date,
  },

  timeline: [{
    status: String,
    note: String,
    at: { type: Date, default: Date.now },
  }],
}, { timestamps: true });

expressOrderSchema.index({ buyer: 1, createdAt: -1 });
expressOrderSchema.index({ store: 1, orderStatus: 1 });

module.exports = mongoose.model('ExpressOrder', expressOrderSchema);
