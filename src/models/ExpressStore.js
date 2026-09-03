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
  // Soft-delete flag — archived stores never appear anywhere
  isArchived: { type: Boolean, default: false },
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
