// ============================================
// KOYAMBEDU ORDER MODEL — v2
// Supports full audit trail, partial declines,
// 3-stage invoicing, and centralized pricing.
// ============================================
const mongoose = require('mongoose');
const { Schema } = mongoose;

// ── Per-item schema ───────────────────────────
const orderItemSchema = new Schema({
  product:       { type: Schema.Types.ObjectId, ref: 'KoyambeduProduct' },
  seller:        { type: Schema.Types.ObjectId, ref: 'KoyambeduSeller' },
  name:          String,
  unit:          String,
  unitLabel:     String,

  // Quantities — orderedQty never changes after save
  orderedQty:    { type: Number, default: 0 },   // original qty at order time
  confirmedQty:  { type: Number, default: 0 },   // qty SA confirmed (starts = orderedQty)
  declinedQty:   { type: Number, default: 0 },   // orderedQty - confirmedQty

  // Alias kept for backward-compat reads
  quantity:      { type: Number, default: 0 },   // mirrors confirmedQty after SA review; orderedQty before

  deliveryType:  { type: String, enum: ['today','tomorrow'], default: 'tomorrow' },
  orderedPrice:  Number,   // unit price at order time (never changes)
  finalPrice:    Number,   // after any revision
  priceRevised:  { type: Boolean, default: false },
  sellerPayout:  { type: Number, default: 0 },

  // Item-level lifecycle
  itemStatus: {
    type: String,
    enum: ['pending', 'confirmed', 'declined', 'partial'],
    default: 'pending',
  },
  declinedReason: { type: String, default: 'unavailable' },

  // SA who actioned this item
  actionedBy:    { type: Schema.Types.ObjectId, ref: 'KoyambeduSellerAdmin' },
  actionedAt:    Date,
}, { _id: true });

// ── Immutable original-order snapshot ─────────
const itemsOrderedSchema = new Schema({
  product:      { type: Schema.Types.ObjectId, ref: 'KoyambeduProduct' },
  seller:       { type: Schema.Types.ObjectId, ref: 'KoyambeduSeller' },
  name:         String,
  unit:         String,
  orderedQty:   Number,
  unitPrice:    Number,
  lineTotal:    Number,
  sellerPayout: Number,
}, { _id: true });

// ── Timeline event ─────────────────────────────
const timelineSchema = new Schema({
  event:       { type: String, required: true }, // e.g. 'order_placed', 'item_declined'
  description: String,
  actor: {
    role:   String,   // 'customer' | 'seller_admin' | 'super_admin' | 'system'
    userId: { type: Schema.Types.ObjectId, ref: 'User' },
    name:   String,
  },
  meta:      { type: Schema.Types.Mixed },
  timestamp: { type: Date, default: Date.now },
}, { _id: false });

// ── Audit log entry ────────────────────────────
const auditLogSchema = new Schema({
  action:        String,  // 'item_declined' | 'qty_reduced' | 'refund_initiated' | 'order_cancelled' etc.
  actorRole:     String,
  actorId:       { type: Schema.Types.ObjectId, ref: 'User' },
  timestamp:     { type: Date, default: Date.now },
  previousValue: Schema.Types.Mixed,
  newValue:      Schema.Types.Mixed,
  amount:        Number,
  refundMethod:  String,  // 'wallet' | 'razorpay' | null
  notes:         String,
}, { _id: false });

// ── Main schema ────────────────────────────────
const koyambeduOrderSchema = new Schema({
  orderId: { type: String, unique: true },

  // Buyer — PRIVATE, never exposed to seller
  buyer:        { type: Schema.Types.ObjectId, ref: 'User', required: true },
  buyerLocation: {
    lat:        Number,
    lng:        Number,
    areaName:   String,
    city:       String,
    pincode:    String,
    distanceKm: Number,
  },
  shippingAddress: {
    fullName:     String,
    phone:        String,   // PRIVATE
    addressLine1: String,   // PRIVATE
    addressLine2: String,
    city:         { type: String, default: 'Chennai' },
    pincode:      String,
    landmark:     String,
  },

  // ── ORIGINAL ORDER SNAPSHOT (immutable after placeOrder) ──
  itemsOrdered: [itemsOrderedSchema],

  // ── WORKING ITEMS (SA can confirm/decline/reduce) ──
  items: [orderItemSchema],

  // Delivery
  deliveryType:        { type: String, enum: ['today','tomorrow','mixed'], default: 'tomorrow' },
  deliveryDate:        Date,
  deliverySlot:        { type: String, default: '09:00 AM – 11:59 AM' },
  deliverySlotKey:     { type: String, enum: ['slot1','slot2','slot3','slot4'], default: 'slot2' },
  deliveryPartner:     String,
  deliveryPersonPhone: String,  // PRIVATE — admin only

  // Procurement cycle
  orderTimestamp:  { type: Date, default: Date.now },
  procurementDate: Date,
  cutoffCycle:     String,

  // ── ORDER STATUS ───────────────────────────────
  orderStatus: {
    type: String,
    enum: [
      'placed',                  // payment received / COD placed
      'pending_confirmation',    // waiting for SA review
      'sa_review_submitted',     // SA submitted changes, waiting Super Admin approval
      'price_revision_pending',  // legacy: seller requested price change
      'confirmed',               // Super Admin approved, order confirmed
      'packing',
      'dispatched',
      'delivered',
      'cancelled',
      'refund_initiated',
    ],
    default: 'placed',
  },

  // ── SA REVIEW FLOW ────────────────────────────
  saReview: {
    status: {
      type: String,
      enum: ['pending', 'in_progress', 'submitted', 'approved', 'rejected'],
      default: 'pending',
    },
    reviewedBy:   { type: Schema.Types.ObjectId, ref: 'KoyambeduSellerAdmin' },
    reviewedAt:   Date,
    submittedAt:  Date,
    notes:        String,
    // Calculated refund amount at time of SA submission
    pendingRefundAmount: { type: Number, default: 0 },
    refundMethod:        { type: String, enum: ['wallet','razorpay','cod_deduction','none'], default: 'none' },
  },

  // ── SUPER ADMIN APPROVAL ──────────────────────
  adminApproval: {
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
    },
    approvedBy:  { type: Schema.Types.ObjectId, ref: 'User' },
    approvedAt:  Date,
    notes:       String,
  },

  // ── INVOICE METADATA ──────────────────────────
  invoices: {
    proforma: {
      number:      String,
      generatedAt: Date,
      isAvailable: { type: Boolean, default: false },
    },
    confirmation: {
      number:      String,
      generatedAt: Date,
      isAvailable: { type: Boolean, default: false },
    },
    tax: {
      number:      String,
      generatedAt: Date,
      isAvailable: { type: Boolean, default: false },
    },
  },

  // ── LEGACY PRICE REVISION (kept for old orders) ──
  priceRevision: {
    requested:    { type: Boolean, default: false },
    requestedAt:  Date,
    requestedBy:  { type: Schema.Types.ObjectId, ref: 'KoyambeduSeller' },
    revisedItems: [{
      productId:     Schema.Types.ObjectId,
      name:          String,
      originalPrice: Number,
      revisedPrice:  Number,
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

  // ── PRICING — single source of truth ──────────
  // pricing: original values set at order time (never mutated)
  pricing: {
    subtotal:         { type: Number, default: 0 },
    deliveryCharge:   { type: Number, default: 249 },
    deliveryDistance: { type: Number, default: 0 },
    platformFee:      { type: Number, default: 15 },
    packingLogisticsFee: { type: Number, default: 0 },
    serviceFee:       { type: Number, default: 0 },  // legacy
    discount:         { type: Number, default: 0 },
    couponCode:       String,
    total:            { type: Number, default: 0 },
    revisedTotal:     Number,
    refundAmount:     Number,
  },

  // calculatedPricing: always recomputed by orderCalculationService, stored for synchronization
  calculatedPricing: {
    originalOrderValue:   { type: Number, default: 0 }, // sum(orderedQty * unitPrice)
    declinedRefundAmount: { type: Number, default: 0 }, // sum(declinedQty * unitPrice)
    confirmedItemsTotal:  { type: Number, default: 0 }, // sum(confirmedQty * unitPrice) for non-declined
    platformFee:          { type: Number, default: 15 },
    packingLogisticsFee:  { type: Number, default: 0 },
    deliveryCharge:       { type: Number, default: 0 },
    gst:                  { type: Number, default: 0 }, // 0% for fresh produce
    walletAdjustment:     { type: Number, default: 0 }, // wallet credits applied
    couponDiscount:       { type: Number, default: 0 },
    finalPayableAmount:   { type: Number, default: 0 }, // confirmedItemsTotal + fees - adjustments
    lastCalculatedAt:     Date,
  },

  // Refund (full order)
  refund: {
    status:      { type: String, enum: ['not_applicable','initiated','completed','failed','manual_required'] },
    amount:      Number,
    reason:      String,
    initiatedAt: Date,
  },

  // Partial refunds (Razorpay)
  partialRefunds: [{
    amount:           { type: Number, required: true },
    reason:           String,
    razorpayRefundId: String,
    status:           { type: String, enum: ['initiated','completed','failed'], default: 'initiated' },
    initiatedAt:      { type: Date, default: Date.now },
    initiatedBy:      { type: Schema.Types.ObjectId, ref: 'User' },
  }],

  // Admin notes
  adminNotes:   String,
  cancelReason: String,

  // Internal cost tracking (admin only — never shown to customer)
  adminCosts: {
    actualDeliveryCost: { type: Number, default: 0 },
    miscExpenses:       { type: Number, default: 0 },
    costNote:           String,
    updatedAt:          Date,
    updatedBy:          { type: Schema.Types.ObjectId, ref: 'User' },
  },

  // ── TIMELINE & AUDIT ─────────────────────────
  timeline: [timelineSchema],
  auditLog:  [auditLogSchema],

  // Timestamps
  placedAt:    { type: Date, default: Date.now },
  confirmedAt: Date,
  dispatchedAt:Date,
  deliveredAt: Date,

}, { timestamps: true });

// Auto-generate orderId
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
koyambeduOrderSchema.index({ 'saReview.status': 1 });
koyambeduOrderSchema.index({ 'adminApproval.status': 1 });

module.exports = mongoose.model('KoyambeduOrder', koyambeduOrderSchema);
