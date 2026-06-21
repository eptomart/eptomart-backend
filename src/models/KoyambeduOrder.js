// ============================================
// KOYAMBEDU ORDER MODEL
// ============================================
const mongoose = require('mongoose');
const { Schema } = mongoose;

const koyambeduOrderSchema = new Schema({
  orderId: {
    type:   String,
    unique: true,
    // Auto-generated: KBD + timestamp
  },

  // Buyer — PRIVATE, never exposed to seller
  buyer:           { type: Schema.Types.ObjectId, ref: 'User', required: true },

  // Buyer GPS location (captured at checkout — private, admin only)
  buyerLocation: {
    lat:        Number,
    lng:        Number,
    areaName:   String, // locality/area name — safe to show seller (no house no.)
    city:       String,
    pincode:    String,
    distanceKm: Number, // distance from Koyambedu market at time of order
  },

  shippingAddress: {
    fullName:     String,
    phone:        String,  // PRIVATE
    addressLine1: String,  // PRIVATE
    addressLine2: String,
    city:         { type: String, default: 'Chennai' },
    pincode:      String,
    landmark:     String,
  },

  // Order items — seller sees: name, qty, unit, deliveryType, payout estimate ONLY
  items: [{
    product:       { type: Schema.Types.ObjectId, ref: 'KoyambeduProduct' },
    seller:        { type: Schema.Types.ObjectId, ref: 'KoyambeduSeller' },
    name:          String,
    unit:          String,
    unitLabel:     String,
    quantity:      Number,
    deliveryType:  { type: String, enum: ['today','tomorrow'], default: 'tomorrow' },
    orderedPrice:  Number,   // price at time of order
    finalPrice:    Number,   // price after revision (if any)
    priceRevised:  { type: Boolean, default: false },
    sellerPayout:  { type: Number, default: 0 },  // after commission
  }],

  // Delivery
  deliveryType:   { type: String, enum: ['today','tomorrow','mixed'], default: 'tomorrow' },
  deliveryDate:   Date,
  deliverySlot:    { type: String, default: 'Slot 1: 9 AM – 12 PM' },
  deliverySlotKey: { type: String, enum: ['slot1','slot2','slot3'], default: 'slot1' },
  deliveryPartner: { type: String },
  deliveryPersonPhone: { type: String }, // PRIVATE — only admin

  // Cutoff & procurement cycle
  orderTimestamp:  { type: Date, default: Date.now },
  procurementDate: { type: Date },   // which day's procurement cycle
  cutoffCycle:     { type: String }, // "2026-06-22" ISO date of procurement day

  // Status lifecycle
  orderStatus: {
    type: String,
    enum: [
      'placed',                // payment received
      'pending_confirmation',  // awaiting seller stock confirmation
      'price_revision_pending',// seller requested price change, awaiting buyer approval
      'confirmed',             // all confirmed, ready to pack
      'packing',               // seller packing
      'dispatched',            // out for delivery
      'delivered',             // delivered
      'cancelled',             // cancelled
      'refund_initiated',
    ],
    default: 'placed',
  },

  // Price revision flow
  priceRevision: {
    requested:   { type: Boolean, default: false },
    requestedAt: Date,
    requestedBy: { type: Schema.Types.ObjectId, ref: 'KoyambeduSeller' },
    revisedItems: [{
      productId:    Schema.Types.ObjectId,
      name:         String,
      originalPrice:Number,
      revisedPrice: Number,
    }],
    revisedTotal:  Number,
    buyerResponse: { type: String, enum: ['pending','approved','rejected'], default: 'pending' },
    respondedAt:   Date,
  },

  // Payment
  paymentMethod: { type: String, enum: ['razorpay','cod','upi'], default: 'razorpay' },
  paymentStatus: { type: String, enum: ['pending','paid','refunded','failed'], default: 'pending' },
  paymentDetails: {
    razorpayOrderId:   String,
    razorpayPaymentId: String,
    razorpaySignature: String,
    upiRef:            String,
    paidAt:            Date,
  },

  // Pricing
  pricing: {
    subtotal:     { type: Number, default: 0 },
    deliveryCharge:{ type: Number, default: 40 },
    serviceFee:   { type: Number, default: 10 },
    total:        { type: Number, default: 0 },
    revisedTotal: Number,  // if price revision occurred
    refundAmount: Number,
  },

  // Refund
  refund: {
    status:   { type: String, enum: ['not_applicable','initiated','completed','failed','manual_required'] },
    amount:   Number,
    reason:   String,
    initiatedAt: Date,
  },

  // Admin notes
  adminNotes: String,
  cancelReason: String,

  // Timestamps
  placedAt:    { type: Date, default: Date.now },
  confirmedAt: Date,
  dispatchedAt:Date,
  deliveredAt: Date,

}, { timestamps: true });

// Auto-generate orderId before save
koyambeduOrderSchema.pre('save', function(next) {
  if (!this.orderId) {
    const ts   = Date.now().toString(36).toUpperCase();
    const rand = Math.random().toString(36).substring(2, 5).toUpperCase();
    this.orderId = `KBD${ts}${rand}`;
  }
  next();
});

koyambeduOrderSchema.index({ buyer: 1, createdAt: -1 });
koyambeduOrderSchema.index({ orderId: 1 });
koyambeduOrderSchema.index({ orderStatus: 1 });
koyambeduOrderSchema.index({ 'items.seller': 1 });
koyambeduOrderSchema.index({ paymentStatus: 1 });

module.exports = mongoose.model('KoyambeduOrder', koyambeduOrderSchema);
