// ============================================
// KOYAMBEDU COMBOS / FLASH SALE — Global Settings (singleton)
// Mirrors FruitBasketSettings.js exactly (see that file for full rationale).
//
// IMPORTANT — Combos are NOT a standalone vertical. Combo products
// (KoyambeduProduct.isCombo = true) are sold through the SAME shop, cart
// and checkout as every other Koyambedu Daily product. This settings doc
// only controls the combo-SPECIFIC same-day cutoff/slots/delivery-pricing/
// minimum-order behaviour, and that behaviour only kicks in on the
// checkout page when BOTH of these are true:
//   1. featureEnabled is true (this toggle)
//   2. the buyer's cart actually contains at least one isCombo product
// Otherwise the checkout falls back 100% to normal Koyambedu Daily slots,
// cutoff and delivery charges — nothing here ever overrides anything when
// the toggle is off or there's no combo in the cart.
//
//   - featureEnabled : master on/off switch for the whole Combos feature.
//   - sameDayDelivery: same-day order cutoff for combo items specifically.
//   - deliverySlots  : admin-defined delivery time windows for combo orders.
//   - delivery       : distance-tiered delivery charge, same shape as
//     FruitBasketSettings/Koyambedu — free within freeRadiusKm, then
//     chargePerBlock for every additional blockSizeKm beyond that.
//   - minOrderValue  : minimum cart value (₹) required when a combo is
//     present and the feature is on (0 = no minimum).
// ============================================
const mongoose = require('mongoose');

const koyambeduComboSettingsSchema = new mongoose.Schema({
  key: { type: String, default: 'global', unique: true },

  // ── Master feature toggle ────────────────────────────────────────────
  featureEnabled:       { type: Boolean, default: false },
  featureEnabledBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  featureEnabledByName: { type: String },
  featureEnabledAt:     { type: Date },

  // ── Same-day order cutoff (identical shape to KoyambeduSettings) ─────
  sameDayDelivery: {
    enabled:       { type: Boolean, default: true },
    cutoffTime:    { type: String, default: '14:00' }, // "HH:mm", 24-hour, IST
    updatedBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedByName: { type: String },
    updatedAt:     { type: Date },
  },

  // ── Delivery slots — admin-defined, each independently enable/disable ─
  deliverySlots: {
    type: [{
      key:       { type: String, required: true },  // stable id, e.g. "slot1"
      label:     { type: String, required: true },   // "9 AM – 12 PM"
      startTime: { type: String, required: true },   // "09:00"
      endTime:   { type: String, required: true },   // "12:00"
      enabled:   { type: Boolean, default: true },
    }],
    default: [
      { key: 'slot1', label: '9 AM – 12 PM', startTime: '09:00', endTime: '12:00', enabled: true },
      { key: 'slot2', label: '12 PM – 3 PM', startTime: '12:00', endTime: '15:00', enabled: true },
      { key: 'slot3', label: '3 PM – 6 PM',  startTime: '15:00', endTime: '18:00', enabled: true },
      { key: 'slot4', label: '6 PM – 9 PM',  startTime: '18:00', endTime: '21:00', enabled: true },
    ],
  },

  // ── Distance-tiered delivery charge (only applied when combo logic is
  // active — see file header). Same mechanism as FruitBasketSettings/
  // Koyambedu's fixed-market origin (haversineKm in koyambeduController.js).
  delivery: {
    originLat:      { type: Number, default: 13.0748 }, // defaults to Koyambedu market; admin can override
    originLng:      { type: Number, default: 80.2136 },
    originLabel:    { type: String, default: 'Koyambedu Market' },
    freeRadiusKm:   { type: Number, default: 5 },   // free delivery within this radius
    blockSizeKm:    { type: Number, default: 5 },   // charge applies per this many km beyond the free radius
    chargePerBlock: { type: Number, default: 40 },  // ₹ charged per block beyond the free radius
    maxDeliveryKm:  { type: Number, default: 30 },  // beyond this, delivery is simply unavailable
    updatedBy:      { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedByName:  { type: String },
    updatedAt:      { type: Date },
  },

  // ── Minimum order value when a combo item is present & feature is on ──
  minOrderValue: {
    value:         { type: Number, default: 0 }, // ₹, 0 = no minimum
    updatedBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedByName: { type: String },
    updatedAt:     { type: Date },
  },
}, { timestamps: true });

/** Get the global settings doc (creates with defaults if missing). */
koyambeduComboSettingsSchema.statics.getGlobal = async function() {
  let doc = await this.findOne({ key: 'global' });
  if (!doc) doc = await this.create({ key: 'global' });
  return doc;
};

/** Public-safe status — used by KoyambeduCheckout.jsx, KoyambeduShop.jsx and the Home.jsx banner. */
koyambeduComboSettingsSchema.statics.getPublicStatus = async function() {
  const doc = await this.getGlobal();
  return {
    featureEnabled: !!doc.featureEnabled,
    sameDayDelivery: {
      enabled: doc.sameDayDelivery?.enabled !== undefined ? doc.sameDayDelivery.enabled : true,
      cutoffTime: doc.sameDayDelivery?.cutoffTime || '14:00',
    },
    deliverySlots: (doc.deliverySlots || []).filter(s => s.enabled),
    delivery: {
      freeRadiusKm:   doc.delivery?.freeRadiusKm ?? 5,
      blockSizeKm:    doc.delivery?.blockSizeKm ?? 5,
      chargePerBlock: doc.delivery?.chargePerBlock ?? 40,
      maxDeliveryKm:  doc.delivery?.maxDeliveryKm ?? 30,
    },
    minOrderValue: doc.minOrderValue?.value ?? 0,
  };
};

/**
 * Compute the delivery charge for a given distance using the current tiers.
 * Free within freeRadiusKm; every additional (partial) blockSizeKm beyond
 * that costs chargePerBlock. Returns null if distanceKm exceeds maxDeliveryKm
 * (delivery unavailable).
 */
koyambeduComboSettingsSchema.statics.computeDeliveryCharge = async function(distanceKm) {
  const doc = await this.getGlobal();
  const { freeRadiusKm = 5, blockSizeKm = 5, chargePerBlock = 40, maxDeliveryKm = 30 } = doc.delivery || {};
  if (distanceKm > maxDeliveryKm) return { available: false, charge: null };
  if (distanceKm <= freeRadiusKm) return { available: true, charge: 0 };
  const extraKm = distanceKm - freeRadiusKm;
  const blocks  = Math.ceil(extraKm / blockSizeKm);
  return { available: true, charge: blocks * chargePerBlock };
};

module.exports = mongoose.model('KoyambeduComboSettings', koyambeduComboSettingsSchema);
