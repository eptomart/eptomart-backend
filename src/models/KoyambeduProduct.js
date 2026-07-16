// ============================================
// KOYAMBEDU PRODUCT MODEL
// ============================================
const mongoose = require('mongoose');
const { Schema } = mongoose;

const koyambeduProductSchema = new Schema({
  seller:   { type: Schema.Types.ObjectId, ref: 'KoyambeduSeller', required: true },
  category: { type: Schema.Types.ObjectId, ref: 'KoyambeduCategory', required: true },

  // Names (bilingual)
  name:       { type: String, required: true, trim: true },
  nameTamil:  { type: String, trim: true },
  description:{ type: String, trim: true },

  // Unit configuration
  unit:       { type: String, enum: ['kg','g','piece','bunch','dozen','litre','pack','leaf','box','bag','crate'], default: 'kg' },

  // Quantity constraints (buyer-facing)
  minQty:     { type: Number, default: 0.5 },
  maxQty:     { type: Number, default: 50 },
  qtyStep:    { type: Number, default: 0.5 },

  // Product Code (auto-generated, editable)
  productCode: { type: String, trim: true, uppercase: true },

  // ── Charge percentages (product-level, apply to all variants) ──────────────
  procurementChargePercent: { type: Number, default: 0 },   // % of basePrice (admin/SA set per product)
  platformChargePercent:    { type: Number, default: 0 },   // % of basePrice (set per product, no automatic default)
  logisticsChargePercent:   { type: Number, default: 0 },   // % of basePrice (set per product, no automatic default)

  // ── Variant Pricing (up to 4 tiers) ────────────────────────────────────────
  // finalPrice = basePrice × (1 + (procurement + platform + logistics) / 100)
  // Daily Price Update: user enters base price for HIGHEST qty variant only.
  // System auto-calculates all smaller variants using variantDiffPercent.
  variants: [{
    basePrice:  { type: Number, required: true },
    fromQty:    { type: Number, required: true },
    toQty:      { type: Number, default: null }, // null = open-ended last tier
    finalPrice: { type: Number, default: 0 },   // auto-computed
  }],

  // Variant difference %: % by which each smaller variant's base price is reduced
  // relative to the next larger variant. Used by variantPricingService.
  // e.g. 2.5 means: 10kg base = 30kg base × (1 - 2.5/100)
  variantDiffPercent: { type: Number, default: 2 },

  // ── Grade System (Premium / Mixed Grade / Economy Grade) ────────────────────
  // When gradesEnabled=true each grade has its own independent variants & pricing.
  // The root-level variants[] above are kept for backward-compat but are IGNORED
  // in favour of each grade's own variants[] when gradesEnabled=true.
  gradesEnabled: { type: Boolean, default: false },
  grades: [{
    gradeKey:   { type: String, enum: ['premium','mixed','economy'], required: true },
    gradeName:  { type: String, default: '' },  // display label e.g. "Premium"
    isActive:   { type: Boolean, default: true },
    variants: [{
      basePrice:  { type: Number, required: true },
      fromQty:    { type: Number, required: true },
      toQty:      { type: Number, default: null },
      finalPrice: { type: Number, default: 0 },
    }],
    variantDiffPercent: { type: Number, default: 2 },
    // Snapshot of lowest unit price (updated on each daily-price run; used for listing sort/display)
    lowestUnitPrice: { type: Number, default: 0 },
  }],

  // Legacy single-price fields (kept for backward compat + derived from variants)
  basePrice:            { type: Number, default: 0 },
  platformFeePercent:   { type: Number, default: 10 },
  logisticsPercent:     { type: Number, default: 10 },
  sellerMarginPercent:  { type: Number, default: 15 },
  finalPrice:           { type: Number, default: 0 },

  // Forecast price (admin sets, approve to make it today's price)
  forecastPrice:        { type: Number, default: 0 },
  forecastApproved:     { type: Boolean, default: false },
  forecastApprovedAt:   Date,
  forecastApprovedBy:   { type: Schema.Types.ObjectId, ref: 'User' },

  // Pricing — market-linked (kept for backward compat)
  marketPriceMin:  { type: Number, default: 0 },
  marketPriceMax:  { type: Number, default: 0 },
  currentPrice:    { type: Number, required: true },
  priceUpdatedAt:  { type: Date, default: Date.now },

  // Stock
  stockQty:         { type: Number, default: 0 },
  stockUnit:        { type: String, default: 'kg' },
  stockUpdatedAt:   Date,

  // Freshness info
  freshArrivalTime: { type: String },  // e.g. "4:30 AM"
  freshArrivalDate: { type: Date },
  freshnessDuration:{ type: Number, default: 24 }, // hours

  // Delivery availability
  isSameDay:       { type: Boolean, default: true },
  isNextDay:       { type: Boolean, default: true },
  sameDayCutoff:   { type: String, default: '10:00' },

  // ── Approval workflow (SA changes require superadmin sign-off) ────────────
  // New products created by SA start as 'pending'; superadmin approves → 'approved'.
  // Customer-facing APIs only return 'approved' products.
  approvalStatus:  { type: String, enum: ['pending','approved','rejected'], default: 'approved' },
  approvalNote:    { type: String },               // rejection reason
  approvedBy:      { type: Schema.Types.ObjectId, ref: 'User' },
  approvedAt:      Date,

  // When SA edits a product the raw payload is parked here; superadmin then
  // applies (approve) or discards (reject) it without touching the live record.
  pendingEdit:     { type: Schema.Types.Mixed },
  pendingEditBy:   { type: Schema.Types.ObjectId, ref: 'User' },
  pendingEditAt:   Date,

  // Status & visibility
  isActive:        { type: Boolean, default: true },
  isAvailable:     { type: Boolean, default: true },  // seller toggles daily stock

  // Badges
  badges: [{
    type: String,
    enum: ['fresh_arrival','low_stock','best_seller','seasonal','organic','festival_special','bulk_deal'],
  }],

  // Tags for search
  tags: [{ type: String, lowercase: true }],

  // Images
  images: [{
    url:       String,
    publicId:  String,
    isPrimary: { type: Boolean, default: false },
  }],

  // Weight (used for delivery charge calculation)
  // weightKg = weight per 1 unit in kg
  // kg products: default 1, g products: default 0.001, piece/bunch/etc: seller sets this
  weightKg: { type: Number, default: 1 },

  // Smart features
  isBulkAvailable:   { type: Boolean, default: false },
  bulkMinQty:        Number,
  bulkPricePerUnit:  Number,
  isRecurringAllowed:{ type: Boolean, default: false },

  // Stats
  totalOrders: { type: Number, default: 0 },
  totalQtySold:{ type: Number, default: 0 },
  avgRating:   { type: Number, default: 0, min: 0, max: 5 },
  ratingCount: { type: Number, default: 0 },

}, { timestamps: true });

koyambeduProductSchema.index({ seller: 1, isActive: 1 });
koyambeduProductSchema.index({ category: 1, isActive: 1, isAvailable: 1 });
koyambeduProductSchema.index({ name: 'text', nameTamil: 'text', tags: 'text' });
koyambeduProductSchema.index({ currentPrice: 1 });
// Case-insensitive unique product name across the entire Koyambedu Daily catalog.
// IMPORTANT: Run a deduplication script before enabling this index in production
// if existing duplicate names are present. Controller checks also enforce this.
koyambeduProductSchema.index(
  { name: 1 },
  { unique: true, collation: { locale: 'en', strength: 2 }, name: 'unique_koyambedu_product_name' }
);

module.exports = mongoose.model('KoyambeduProduct', koyambeduProductSchema);
