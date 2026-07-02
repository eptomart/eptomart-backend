// ============================================
// UZHAVAR ORDER MODEL
// ============================================
const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema({
  product:       { type: mongoose.Schema.Types.ObjectId, ref: 'FarmerProduct' },
  name:          String,
  nameTa:        String,
  unit:          String,
  quantity:      Number,
  pricePerUnit:  Number,
  lineTotal:     Number,
}, { _id: false });

const uzhavarOrderSchema = new mongoose.Schema({
  orderNumber: { type: String, unique: true },

  buyer:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  farmer: { type: mongoose.Schema.Types.ObjectId, ref: 'Farmer', required: true },

  items: [orderItemSchema],

  // ── ORIGINAL ORDER SNAPSHOT — immutable after placement (Stage B) ──
  itemsOrdered: [{
    product:    { type: mongoose.Schema.Types.ObjectId, ref: 'FarmerProduct' },
    name:       String,
    unit:       String,
    orderedQty: Number,
    unitPrice:  Number,
    lineTotal:  Number,
  }],

  // ── Internal audit log (Stage B — append-only) ──
  auditLog: [{
    action:        String,
    actorRole:     String,
    actorId:       { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    timestamp:     { type: Date, default: Date.now },
    previousValue: mongoose.Schema.Types.Mixed,
    newValue:      mongoose.Schema.Types.Mixed,
    amount:        Number,
    refundMethod:  String,
    notes:         String,
  }],

  // Booking type
  bookingType:   { type: String, enum: ['instant', 'scheduled'], default: 'instant' },
  scheduledDate: Date,
  scheduledSlot: { type: String, enum: ['morning', 'afternoon', 'evening'] },

  // Delivery address
  deliveryAddress: {
    name:        String,
    phone:       String, // masked from farmer
    addressLine: String,
    landmark:    String,
    pincode:     String,
    city:        String,
    gpsLocation: { type: { type: String, default: 'Point' }, coordinates: [Number] },
  },

  // Booking fee (platform charge)
  bookingFee: {
    base:  { type: Number, default: 21 },
    gst:   { type: Number, default: 3.78 },  // 18% of 21
    total: { type: Number, default: 24.78 },
  },

  // Product subtotal
  subtotal:   Number,
  grandTotal: Number, // subtotal + bookingFee.total

  // Amount buyer pays farmer directly at delivery (= subtotal, NOT collected online)
  balancePayableToFarmer: Number,

  // Payment
  paymentMethod:   { type: String, enum: ['razorpay', 'subscription'], default: 'razorpay' },
  razorpayOrderId: String,
  razorpayPaymentId: String,
  paymentStatus:   { type: String, enum: ['pending', 'paid', 'failed', 'refunded'], default: 'pending' },
  subscriptionId:  { type: mongoose.Schema.Types.ObjectId, ref: 'UzhavarSubscription' },

  // Order lifecycle
  status: {
    type: String,
    enum: [
      'payment_pending',   // before payment
      'pending_farmer',    // paid, waiting farmer accept
      'farmer_accepted',   // farmer accepted, waiting buyer confirm
      'buyer_confirmed',   // buyer confirmed → in progress
      'out_for_delivery',
      'delivered',
      'cancelled',
      'auto_cancelled',    // buyer didn't confirm in 15 min
    ],
    default: 'payment_pending',
  },

  // Timestamps for flow
  farmerAcceptedAt:  Date,
  buyerConfirmDeadline: Date, // farmerAcceptedAt + 15 min
  buyerConfirmedAt:  Date,
  deliveredAt:       Date,
  cancelledAt:       Date,
  cancellationReason: String,
  cancelledBy:       { type: String, enum: ['buyer', 'farmer', 'system', 'admin'] },

  // Ratings
  rating: {
    freshness: { type: Number, min: 1, max: 5 },
    quality:   { type: Number, min: 1, max: 5 },
    delivery:  { type: Number, min: 1, max: 5 },
    behaviour: { type: Number, min: 1, max: 5 },
    comment:   String,
    ratedAt:   Date,
  },

  // Invoice
  invoiceGenerated: { type: Boolean, default: false },
  invoiceUrl:       String,

  // Notification flags
  adminNotified: { type: Boolean, default: false },
}, { timestamps: true });

// Auto-generate order number
uzhavarOrderSchema.pre('save', async function(next) {
  if (!this.orderNumber) {
    const count = await mongoose.model('UzhavarOrder').countDocuments();
    this.orderNumber = `UF${Date.now().toString().slice(-6)}${(count + 1).toString().padStart(3, '0')}`;
  }
  // Snapshot original order once (Stage B — immutable itemsOrdered)
  if ((!this.itemsOrdered || this.itemsOrdered.length === 0) && this.items?.length) {
    this.itemsOrdered = this.items.map(it => ({
      product:    it.product,
      name:       it.name,
      unit:       it.unit,
      orderedQty: it.quantity,
      unitPrice:  it.pricePerUnit,
      lineTotal:  it.lineTotal ?? (it.pricePerUnit || 0) * (it.quantity || 0),
    }));
  }
  next();
});

uzhavarOrderSchema.index({ buyer: 1, createdAt: -1 });
uzhavarOrderSchema.index({ farmer: 1, status: 1 });
uzhavarOrderSchema.index({ status: 1, buyerConfirmDeadline: 1 });

module.exports = mongoose.model('UzhavarOrder', uzhavarOrderSchema);
