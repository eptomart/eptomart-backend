// ============================================
// EPTOMART EXPRESS — Store Model
// Completely separate from Koyambedu Daily / EptoFresh / Uzhavar / Fruit
// Baskets. A physical retail store location that fulfils Eptomart Express
// (same-day delivery) orders for customers nearest to it.
// ============================================
const mongoose = require('mongoose');

const expressStoreSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Store name is required'],
    trim: true,
  },
  code: {
    // Short unique slug, e.g. VALASARAVAKKAM, KOYAMBEDU, MEDAVAKKAM
    type: String,
    required: true,
    unique: true,
    uppercase: true,
    trim: true,
  },
  address: { type: String, trim: true },
  city: { type: String, trim: true, default: 'Chennai' },
  pincode: { type: String, trim: true },
  location: {
    // Store's own pinned coordinates — used for nearest-store distance calc
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
  },
  // Store Manager assigned to run this store (one per store)
  storeManager: { type: mongoose.Schema.Types.ObjectId, ref: 'ExpressStoreManager', default: null },
  // Master ON/OFF — when off, store is excluded from nearest-store routing
  // and from receiving new Express orders. Toggled by Store Manager or Admin.
  isActive: { type: Boolean, default: true },
  // Separate ON/OFF for the customer-facing ONLINE shop only — independent
  // of isActive above. Lets admin keep a store open for in-person/POS
  // business while hiding it from the Express app's store list and online
  // catalogue (or the reverse). Does not affect POS, the manager dashboard,
  // or inventory in any way.
  onlineShopEnabled: { type: Boolean, default: true },
  // Temporary "hold" — for when the store is swamped with existing orders
  // and needs a short pause on new ones, without going fully inactive or
  // disappearing from the online shop. Customers still see the store (so it
  // doesn't vanish confusingly) but see a "we'll be back shortly" banner and
  // cannot add items to cart or check out until this is turned off again.
  isPaused: { type: Boolean, default: false },
  pauseMessage: { type: String, trim: true, default: null },
  // Soft-delete flag — archived stores never appear anywhere
  isArchived: { type: Boolean, default: false },
  // Per-store delivery slot configuration. Each store can enable/disable
  // individual same-day time windows independently (e.g. a smaller store
  // might only staff 9am-6pm), and can separately opt in to offering a
  // next-day delivery option alongside same-day. Windows carry their own
  // startHour/endHour/label so admin can edit the wording per store too,
  // without touching any other store's configuration.
  deliverySlots: {
    windows: {
      type: [{
        startHour: { type: Number, required: true, min: 0, max: 23 },
        endHour:   { type: Number, required: true, min: 1, max: 24 },
        label:     { type: String, required: true, trim: true },
        enabled:   { type: Boolean, default: true },
      }],
      default: () => ([
        { startHour: 9,  endHour: 12, label: '9:00 AM - 12:00 PM', enabled: true },
        { startHour: 12, endHour: 15, label: '12:00 PM - 3:00 PM', enabled: true },
        { startHour: 15, endHour: 18, label: '3:00 PM - 6:00 PM', enabled: true },
        { startHour: 18, endHour: 21, label: '6:00 PM - 9:00 PM', enabled: true },
      ]),
    },
    // When true, the checkout page also offers every enabled window for
    // tomorrow (not just today's remaining windows) for customers who'd
    // rather schedule ahead than wait for same-day delivery.
    nextDayEnabled: { type: Boolean, default: false },
  },
  // Who last flipped isActive, and when — for the audit trail (section 22)
  lastStatusChange: {
    by: { type: String, default: null },        // 'admin' | 'store_manager'
    byName: { type: String, default: null },
    at: { type: Date, default: null },
  },
  notes: { type: String, trim: true },
}, { timestamps: true });

expressStoreSchema.index({ isActive: 1, isArchived: 1 });
expressStoreSchema.index({ 'location.lat': 1, 'location.lng': 1 });

module.exports = mongoose.model('ExpressStore', expressStoreSchema);
