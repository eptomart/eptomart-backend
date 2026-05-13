// ============================================
// ORDER MODEL
// ============================================
const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema({
  product:     { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  name:        String,
  image:       String,
  price:       { type: Number, required: true },
  quantity:    { type: Number, required: true, min: 1 },
  variantLabel: String,
  // Per-item fulfilment status (for multi-item / multi-seller orders)
  itemStatus: {
    type:    String,
    enum:    ['pending', 'packed', 'shipped', 'delivered', 'cancelled'],
    default: 'pending',
  },
}, { _id: true });

const orderSchema = new mongoose.Schema({
  orderId: {
    type: String,
    unique: true,
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  items: [orderItemSchema],
  shippingAddress: {
    fullName: { type: String, required: true },
    phone: { type: String, required: true },
    addressLine1: { type: String, required: true },
    addressLine2: String,
    city: { type: String, required: true },
    state: { type: String, required: true },
    pincode: { type: String, required: true },
  },
  pricing: {
    subtotal: { type: Number, required: true },
    discount: { type: Number, default: 0 },
    shipping: { type: Number, default: 0 },
    tax: { type: Number, default: 0 },
    total: { type: Number, required: true },
  },
  paymentMethod: {
    type: String,
    enum: ['cod', 'upi', 'razorpay', 'cashfree', 'stripe'],
    required: true,
  },
  paymentStatus: {
    type: String,
    enum: ['pending', 'paid', 'partially_paid', 'failed', 'refunded'],
    default: 'pending',
  },
  paymentDetails: {
    transactionId: String,
    gatewayOrderId: String,
    paidAt: Date,
    upiRef: String,
  },
  orderStatus: {
    type: String,
    enum: ['placed', 'confirmed', 'processing', 'shipped', 'partially_delivered', 'delivered', 'cancelled', 'returned'],
    default: 'placed',
  },
  statusHistory: [{
    status: String,
    timestamp: { type: Date, default: Date.now },
    note: String,
    updatedBy: String,
  }],
  trackingNumber: String,
  deliveryPartner: String,
  estimatedDelivery: Date,
  notes: String,
  adminNotes: String,

  // Invoice reference
  invoice: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice' },

  // Refund tracking
  refund: {
    status:       { type: String, enum: ['not_applicable', 'pending', 'initiated', 'processed', 'failed', 'manual_required'], default: 'not_applicable' },
    method:       String,   // 'razorpay' | 'upi_manual' | 'cod_none'
    razorpayRefundId: String,
    amount:       Number,
    initiatedAt:  Date,
    processedAt:  Date,
    note:         String,
  },

  // Seller-chosen pickup address (set when seller confirms order)
  sellerPickup: {
    addressId:          String,   // subdoc _id or 'main'
    label:              String,   // e.g. "Main Warehouse"
    street:             String,
    city:               String,
    state:              String,
    pincode:            String,
    phone:              String,
    sellerId:           { type: mongoose.Schema.Types.ObjectId, ref: 'Seller' },
    sellerName:         String,
    // Admin acknowledgment
    adminAcknowledged:  { type: Boolean, default: false },
    acknowledgedAt:     Date,
    acknowledgedBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },

  // Shiprocket shipment tracking
  shiprocket: {
    orderId:             String,   // Shiprocket's order ID
    shipmentId:          String,   // Shiprocket shipment ID
    awb:                 String,   // Airway Bill number
    courier:             String,   // Courier name (e.g. "Delhivery")
    trackingUrl:         String,   // Customer tracking URL
    labelUrl:            String,   // Shipping label PDF URL
    status:              String,   // Latest Shiprocket status string
    shippingCharge:      { type: Number, default: 0 }, // API/auto-detected charge
    adminShippingCharge: { type: Number, default: null }, // Admin-entered actual charge (overrides API value in payout)
    bill: {
      url:        String,   // Cloudinary URL of Shiprocket bill PDF/image
      publicId:   String,   // Cloudinary public ID for deletion
      uploadedAt: Date,
      uploadedBy: { type: require('mongoose').Schema.Types.ObjectId, ref: 'User' },
    },
    createdAt:           Date,
  },

  // GST breakdown
  gstBreakdown: {
    subtotalExGst: Number,
    cgstTotal:     Number,
    sgstTotal:     Number,
    igstTotal:     Number,
    gstTotal:      Number,
    gstType:       { type: String, enum: ['intra', 'inter'] },
    sellerState:   String,
    customerState: String,
  },

  // ── Packaging verification (seller uploads 4 photos before AWB) ────
  packaging: {
    status: {
      type:    String,
      enum:    ['not_submitted', 'pending_review', 'approved', 'rejected'],
      default: 'not_submitted',
    },
    images: [{
      url:        { type: String, required: true },
      publicId:   String,
      side:       { type: String, enum: ['front', 'back', 'left', 'right'], default: null },
      uploadedAt: { type: Date, default: Date.now },
    }],
    submittedAt:    Date,
    reviewedAt:     Date,
    reviewedBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    rejectedReason: String,
  },

  // Payout tracking for this order (set when status → delivered)
  payout: {
    status:        { type: String, enum: ['pending', 'calculated', 'processing', 'paid', 'on_hold'], default: 'pending' },
    grossAmount:   Number,   // seller item total (GST-inclusive)
    gstAmount:     Number,   // GST portion (goes to govt, NOT seller)
    baseAmount:    Number,   // grossAmount - gstAmount (seller's actual revenue base)
    platformFee:   Number,   // Eptomart commission (% of baseAmount)
    shippingCost:  Number,   // Actual Shiprocket charge for this shipment
    packingCharge: Number,   // Deduction for packing materials (₹)
    customDeduction: Number, // Any other deduction (₹)
    customDeductionNote: String, // Reason for custom deduction
    netPayout:     Number,   // = baseAmount - platformFee - shippingCost - packingCharge - customDeduction
    platformFeeRate: Number, // % rate used
    isNewSellerBonus: { type: Boolean, default: false }, // True if first 20 orders, platform fee waived
    applyPlatformFee: { type: Boolean, default: true }, // Admin override flag
    finalizedBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // Admin who finalized payout
    finalizedAt:   Date,
    calculatedAt:  Date,
    paidAt:        Date,
    note:          String,
  },

  // Seller breakdown for multi-vendor
  sellerBreakdown: [{
    seller:      { type: mongoose.Schema.Types.ObjectId, ref: 'Seller' },
    sellerName:  String,
    subtotal:    Number,
    gstTotal:    Number,
    total:       Number,
    status:      { type: String, enum: ['pending','processing','shipped','delivered'], default: 'pending' },
    trackingId:  String,
  }],
}, {
  timestamps: true,
});

// ─── Auto-generate Order ID ───────────────────
orderSchema.pre('save', async function (next) {
  if (!this.orderId) {
    const date = new Date();
    const prefix = 'EPT';
    const timestamp = date.getTime().toString().slice(-8);
    this.orderId = `${prefix}${timestamp}`;
  }

  // Add status to history when it changes
  if (this.isModified('orderStatus')) {
    this.statusHistory.push({ status: this.orderStatus });
  }

  next();
});

orderSchema.index({ user: 1, createdAt: -1 });
// orderId index created automatically via unique: true
orderSchema.index({ orderStatus: 1 });
orderSchema.index({ paymentStatus: 1 });
orderSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Order', orderSchema);
