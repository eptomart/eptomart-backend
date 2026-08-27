// ============================================
// FRUIT BASKETS & HAMPERS — Global Settings (singleton)
// Mirrors the KoyambeduSettings pattern (see models/KoyambeduSettings.js):
// one document, upserted via key='global', Super-Admin controlled.
//
// Everything about this vertical that an admin needs to tune lives here:
//   - featureEnabled : master on/off switch for the whole vertical. When
//     false, the public shop/checkout routes refuse new orders and the
//     Home.jsx promo banner hides itself.
//   - sameDayDelivery: same-day order cutoff, same shape/semantics as
//     Koyambedu's so the checkout page logic can be copied verbatim.
//   - deliverySlots  : admin-defined delivery time windows, each toggle-able.
//   - delivery       : distance-tiered delivery charge — free within
//     freeRadiusKm, then chargePerBlock for every additional blockSizeKm
//     beyond that (e.g. free for 5km, then +₹40 per 5km after).
// ============================================
const mongoose = require('mongoose');

const fruitBasketSettingsSchema = new mongoose.Schema({
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

  // ── Distance-tiered delivery charge ───────────────────────────────────
  // Fulfilled from a single origin point (Eptomart's fruit-basket kitchen/
  // warehouse) — distance is computed via haversine against the customer's
  // pinned delivery coordinates, same mechanism as Koyambedu's fixed-market
  // origin (see haversineKm in koyambeduController.js).
  delivery: {
    originLat:      { type: Number, default: 13.0748 }, // defaults to Koyambedu market; admin can override
    originLng:      { type: Number, default: 80.2136 },
    originLabel:    { type: String, default: 'Eptomart Fruit Basket Kitchen' },
    freeRadiusKm:   { type: Number, default: 5 },   // free delivery within this radius
    blockSizeKm:    { type: Number, default: 5 },   // charge applies per this many km beyond the free radius
    chargePerBlock: { type: Number, default: 40 },  // ₹ charged per block beyond the free radius
    maxDeliveryKm:  { type: Number, default: 30 },  // beyond this, delivery is simply unavailable
    updatedBy:      { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedByName:  { type: String },
    updatedAt:      { type: Date },
  },
}, { timestamps: true });

/** Get the global settings doc (creates with defaults if missing). */
fruitBasketSettingsSchema.statics.getGlobal = async function() {
  let doc = await this.findOne({ key: 'global' });
  if (!doc) doc = await this.create({ key: 'global' });
  return doc;
};

/** Public-safe status — used by the checkout page and the Home.jsx banner. */
fruitBasketSettingsSchema.statics.getPublicStatus = async function() {
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
  };
};

/**
 * Compute the delivery charge for a given distance using the current tiers.
 * Free within freeRadiusKm; every additional (partial) blockSizeKm beyond
 * that costs chargePerBlock. Returns null if distanceKm exceeds maxDeliveryKm
 * (delivery unavailable).
 */
fruitBasketSettingsSchema.statics.computeDeliveryCharge = async function(distanceKm) {
  const doc = await this.getGlobal();
  const { freeRadiusKm = 5, blockSizeKm = 5, chargePerBlock = 40, maxDeliveryKm = 30 } = doc.delivery || {};
  if (distanceKm > maxDeliveryKm) return { available: false, charge: null };
  if (distanceKm <= freeRadiusKm) return { available: true, charge: 0 };
  const extraKm = distanceKm - freeRadiusKm;
  const blocks  = Math.ceil(extraKm / blockSizeKm);
  return { available: true, charge: blocks * chargePerBlock };
};

module.exports = mongoose.model('FruitBasketSettings', fruitBasketSettingsSchema);
