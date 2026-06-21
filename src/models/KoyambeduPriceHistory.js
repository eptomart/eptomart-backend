// ============================================
// KOYAMBEDU PRICE HISTORY MODEL
// ============================================
const mongoose = require('mongoose');
const { Schema } = mongoose;

const koyambeduPriceHistorySchema = new Schema({
  product:       { type: Schema.Types.ObjectId, ref: 'KoyambeduProduct', required: true },
  seller:        { type: Schema.Types.ObjectId, ref: 'KoyambeduSeller' },
  productName:   { type: String },
  productCode:   { type: String },

  previousPrice: { type: Number, required: true },
  updatedPrice:  { type: Number, required: true },

  // Pricing breakdown at time of update
  basePrice:           Number,
  platformFeePercent:  Number,
  logisticsPercent:    Number,
  sellerMarginPercent: Number,

  updatedBy:     { type: Schema.Types.ObjectId, ref: 'User' },
  updatedByName: String,
  updatedByRole: { type: String, enum: ['sellerAdmin', 'superAdmin', 'admin'], default: 'sellerAdmin' },

  source:        { type: String, enum: ['manual', 'forecast_approved', 'bulk_update'], default: 'manual' },
  note:          String,
}, { timestamps: true });

koyambeduPriceHistorySchema.index({ product: 1, createdAt: -1 });
koyambeduPriceHistorySchema.index({ seller: 1, createdAt: -1 });
koyambeduPriceHistorySchema.index({ createdAt: -1 });

module.exports = mongoose.model('KoyambeduPriceHistory', koyambeduPriceHistorySchema);
