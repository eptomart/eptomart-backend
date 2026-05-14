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
  unit:       { type: String, enum: ['kg','g','piece','bunch','dozen','litre','pack','leaf'], default: 'kg' },
  unitLabel:  { type: String, default: 'kg' },  // display label e.g. "500g", "1 bunch"

  // Quantity constraints (buyer-facing)
  minQty:     { type: Number, default: 0.5 },
  maxQty:     { type: Number, default: 50 },
  qtyStep:    { type: Number, default: 0.5 },

  // Pricing — market-linked
  marketPriceMin:  { type: Number, default: 0 },  // estimated daily range
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

module.exports = mongoose.model('KoyambeduProduct', koyambeduProductSchema);
