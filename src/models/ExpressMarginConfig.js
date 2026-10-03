// ============================================
// EPTOMART EXPRESS — Margin Config Model (singleton)
// Global default charges applied on top of procurement + logistics cost.
// Product-specific overrides live on ExpressProduct.customMarginPct instead
// (kept there, not duplicated here, so there's one source of truth per
// product). This document only ever has a single row.
// ============================================
const mongoose = require('mongoose');

const expressMarginConfigSchema = new mongoose.Schema({
  // Singleton lock key — always 'default', unique index enforces one row
  key: { type: String, default: 'default', unique: true },

  // Section 19 — master ON/OFF switch for the whole Express vertical
  isEnabled: { type: Boolean, default: false },

  // Section 2 — logistics cost per kg, recomputed whenever admin re-enters
  // the latest shipment costs across stores. Stored so it doesn't need to
  // be recalculated on every price lookup.
  logisticsCostPerKg: { type: Number, default: 0, min: 0 },
  logisticsInputs: {
    storeCosts: [{ store: { type: mongoose.Schema.Types.ObjectId, ref: 'ExpressStore' }, cost: Number }],
    totalProcurementKg: { type: Number, default: 0 },
    updatedAt: { type: Date, default: null },
  },

  // Section 3 — default margin stack (percentages), Admin-configurable
  platformChargePct: { type: Number, default: 20, min: 0 },
  salesmanChargePct: { type: Number, default: 20, min: 0 },
  packingChargePct:  { type: Number, default: 20, min: 0 },

  // Section 10 — large-order threshold + whether to hard-block or just warn
  largeOrderThresholdKg: { type: Number, default: 12 },
  largeOrderAction: { type: String, enum: ['warn', 'block'], default: 'warn' },

  // Section 9 — max delivery distance before redirecting to Koyambedu Daily
  maxDeliveryDistanceKm: { type: Number, default: 12 },

  // Delivery fee rules — all admin-configurable. Within freeDeliveryRadiusKm
  // of the store, delivery is always free regardless of order value. Beyond
  // that radius (but still within maxDeliveryDistanceKm), delivery stays
  // free if the order subtotal is at least minOrderForFreeDelivery;
  // otherwise deliveryFeeBelowMinimum is charged as a flat fee.
  freeDeliveryRadiusKm:    { type: Number, default: 3, min: 0 },
  minOrderForFreeDelivery: { type: Number, default: 199, min: 0 },
  deliveryFeeBelowMinimum: { type: Number, default: 29, min: 0 },

  // Flat platform fee charged to the customer at checkout, shown as its own
  // line item alongside the delivery fee — admin-configurable, set to 0 to
  // disable it entirely for every store (it's global, not per-store).
  platformFeeAmount: { type: Number, default: 75, min: 0 },

  // Shown to the customer when they're beyond maxDeliveryDistanceKm instead
  // of a dead-end error — a phone/WhatsApp number they can call for a
  // custom (manually arranged) order. Null/empty hides the call-to-action.
  customOrderPhone: { type: String, trim: true, default: null },

  // Admin-configurable delivery TIME estimate tiers, by distance from the
  // store — fully dynamic, not hardcoded. Each tier means "if the customer
  // is within maxDistanceKm of the store, quote etaMinutes". Tiers are
  // evaluated in ascending maxDistanceKm order, first match wins (see
  // expressPricingService.computeDeliveryEta); a customer beyond every
  // tier's maxDistanceKm gets the last (largest) tier's etaMinutes rather
  // than no estimate at all. Example default: <=4km->30min, <=10km->45min,
  // beyond that (up to maxDeliveryDistanceKm)->60min.
  deliveryTimeTiers: {
    type: [{ maxDistanceKm: { type: Number, required: true, min: 0 }, etaMinutes: { type: Number, required: true, min: 1 } }],
    default: [
      { maxDistanceKm: 4,  etaMinutes: 30 },
      { maxDistanceKm: 10, etaMinutes: 45 },
      { maxDistanceKm: 12, etaMinutes: 60 },
    ],
  },

  updatedBy: { type: String, default: null }, // admin name/email, for audit
}, { timestamps: true });

module.exports = mongoose.model('ExpressMarginConfig', expressMarginConfigSchema);
