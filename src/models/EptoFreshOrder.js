// ============================================
// EPTOFRESH ORDER MODEL
// Hyperlocal meat/poultry/seafood order
// Privacy: customer address/name NEVER exposed to seller
// ============================================
const mongoose = require('mongoose');
const { Schema } = mongoose;

const eptoFreshOrderSchema = new Schema({
  orderId: { type: String, unique: true },

  // Buyer — PRIVATE
  buyer: { type: Schema.Types.ObjectId, ref: 'User', required: true },

  // Buyer location at time of order
  buyerLocation: {
    lat:        Number,
    lng:        Number,
    city:       String,
    pincode:    String,
  },

  // Delivery address — PRIVATE (admin + buyer only, never seller)
  shippingAddress: {
    fullName:     String,
    phone:        String,
    addressLine1: String,
    addressLine2: String,
    city:         { type: String, default: 'Chennai' },
    state:        { type: String, default: 'Tamil Nadu' },
    pincode:      String,
    landmark:     String,
    lat:          Number,
    lng:          Number,
  },

  // Order items — seller sees: product name, qty, cut, weight variant ONLY
  items: [{
    product:      { type: Schema.Types.ObjectId, ref: 'EptoFreshProduct' },
    seller:       { type: Schema.Types.ObjectId, ref: 'EptoFreshSeller' },
    productName:  String,
    category:     String,
    cutType:      String,
    variant:      {
      weight: Number,
      label:  String,
      price:  Number,
    },
    quantity:     { type: Number, default: 1 },
    unitPrice:    Number,
    totalPrice:   Number,
    sellerPayout: { type: Number, default: 0 },
  }],

  // Seller — single seller per order (hyperlocal)
  seller: { type: Schema.Types.ObjectId, ref: 'EptoFreshSeller', required: true },

  // Distance from seller to buyer (calculated at order time)
  distanceKm: { type: Number, default: 0 },

  // Order lifecycle status
  orderStatus: {
    type: String,
    enum: [
      'payment_pending',   // awaiting payment
      'placed',            // paid, sent to seller
      'accepted',          // seller accepted
      'rejected',          // seller rejected
      'preparing',         // seller packing
      'packed',            // seller uploaded packed photos, awaiting admin approval
      'admin_approved',    // admin approved packed photos, triggering porter
      'porter_assigned',   // porter driver assigned
      'picked_up',         // driver picked up from seller
      'out_for_delivery',  // en route
      'delivered',         // OTP verified delivery confirmed
      'cancelled',
      'refund_initiated',
      'refunded',
    ],
    default: 'payment_pending',
  },

  // Timestamps for each status change
  statusHistory: [{
    status:    String,
    timestamp: { type: Date, default: Date.now },
    note:      String,
    updatedBy: { type: String, enum: ['system', 'seller', 'admin', 'customer', 'porter'] },
  }],

  // Seller action
  sellerAction: {
    accepted:   { type: Boolean },
    acceptedAt: Date,
    rejectedAt: Date,
    rejectReason: String,
  },

  // Packed product photos (seller uploads, admin approves)
  packedPhotos: [{
    url:        String,
    publicId:   String,
    uploadedAt: { type: Date, default: Date.now },
    approved:   { type: Boolean, default: false },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    approvedAt: Date,
  }],

  // Delivery OTP
  deliveryOtp: { type: String },
  deliveryOtpVerified: { type: Boolean, default: false },

  // Porter delivery
  porter: {
    requestId:        String,
    orderId:          String,
    status:           String,
    driverName:       String,
    driverPhone:      String,    // PRIVATE — admin only
    driverVehicle:    String,
    driverLat:        Number,
    driverLng:        Number,
    trackingUrl:      String,
    estimatedPickup:  Date,
    estimatedDelivery:Date,
    fareEstimate:     Number,
    actualFare:       Number,
    webhookEvents:    [{ event: String, timestamp: Date, data: Schema.Types.Mixed }],
  },

  // Payment
  paymentMethod: { type: String, enum: ['razorpay', 'cod', 'wallet'], default: 'razorpay' },
  paymentStatus: { type: String, enum: ['pending', 'paid', 'refunded', 'failed'], default: 'pending' },
  paymentDetails: {
    razorpayOrderId:   String,
    razorpayPaymentId: String,
    razorpaySignature: String,
    paidAt:            Date,
  },

  // Pricing
  pricing: {
    subtotal:        { type: Number, default: 0 },
    deliveryCharge:  { type: Number, default: 0 },
    deliveryDiscount:{ type: Number, default: 0 }, // if >=1049 or order > 1000 with discount
    walletApplied:   { type: Number, default: 0 },
    couponDiscount:  { type: Number, default: 0 },
    total:           { type: Number, default: 0 },
    platformFee:     { type: Number, default: 0 },
    gstOnFee:        { type: Number, default: 0 },
    sellerReceives:  { type: Number, default: 0 },
  },

  couponCode:    String,
  walletUsed:    { type: Boolean, default: false },

  // Payout record
  payout: {
    status:    { type: String, enum: ['pending', 'processing', 'settled', 'failed'], default: 'pending' },
    amount:    Number,
    settledAt: Date,
    reference: String,
  },

  // Admin overrides
  adminNotes:    String,
  cancelReason:  String,
  cancelledBy:   { type: String, enum: ['customer', 'seller', 'admin', 'system'] },
  cancelledAt:   Date,

  // Refund
  refund: {
    status:      { type: String, enum: ['not_applicable', 'initiated', 'completed', 'failed'] },
    amount:      Number,
    reason:      String,
    initiatedAt: Date,
    completedAt: Date,
  },

  // Complaint
  complaint: {
    filed:      { type: Boolean, default: false },
    reason:     String,
    status:     { type: String, enum: ['open', 'resolved', 'closed'] },
    filedAt:    Date,
    resolvedAt: Date,
    resolution: String,
  },

  // Ratings submitted
  rated:      { type: Boolean, default: false },
  ratedAt:    Date,

  placedAt:    { type: Date },
  deliveredAt: Date,

}, { timestamps: true });

// Auto-generate orderId
eptoFreshOrderSchema.pre('save', function (next) {
  if (!this.orderId) {
    const ts   = Date.now().toString(36).toUpperCase();
    const rand = Math.random().toString(36).substring(2, 5).toUpperCase();
    this.orderId = `EPF${ts}${rand}`;
  }
  if (!this.placedAt && this.orderStatus !== 'payment_pending') {
    this.placedAt = new Date();
  }
  next();
});

eptoFreshOrderSchema.index({ buyer: 1, createdAt: -1 });
eptoFreshOrderSchema.index({ seller: 1, createdAt: -1 });
eptoFreshOrderSchema.index({ orderId: 1 });
eptoFreshOrderSchema.index({ orderStatus: 1 });
eptoFreshOrderSchema.index({ paymentStatus: 1 });
eptoFreshOrderSchema.index({ 'porter.requestId': 1 });

module.exports = mongoose.model('EptoFreshOrder', eptoFreshOrderSchema);
