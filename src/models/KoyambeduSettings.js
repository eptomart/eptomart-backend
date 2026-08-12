// ============================================
// KOYAMBEDU SETTINGS — Global singleton
// Stores market-wide settings like last price update time.
// Only one document exists (upserted via key='global').
// ============================================
const mongoose = require('mongoose');

const devAuditLogSchema = new mongoose.Schema({
  action:    { type: String, enum: ['enabled', 'disabled', 'expired'], required: true },
  by:        { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  byName:    { type: String },
  at:        { type: Date, default: Date.now },
  ip:        { type: String },
  expiresAt: { type: Date }, // only present on 'enabled' actions
}, { _id: false });

const koyambeduSettingsSchema = new mongoose.Schema({
  key: { type: String, default: 'global', unique: true },

  // Set every time any product price is updated (daily price / bulk update)
  lastProductUpdateTime: { type: Date },
  lastProductUpdateBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  lastProductUpdateByName: { type: String },

  // ── Development Payment Test Mode ──────────────────────────────────
  // Super Admin controlled — replaces ENABLE_TEST_PAYMENT_BUTTONS env var.
  paymentTestMode: {
    enabled:      { type: Boolean, default: false },
    enabledBy:    { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    enabledByName:{ type: String },
    enabledAt:    { type: Date },
    expiresAt:    { type: Date },   // null = no expiry (manual disable only)
    auditLog:     { type: [devAuditLogSchema], default: [] },
  },

  // ── Same-Day Delivery (Koyambedu Daily) ─────────────────────────────
  // Super Admin controlled global gate, checked in addition to (never in
  // place of) the existing per-date/per-slot KoyambeduDeliverySchedule
  // controls. `cutoffTime` replaces what was previously a hardcoded "9 AM"
  // in the checkout frontend. `enabled=false` fully turns off same-day
  // ordering platform-wide regardless of product flags or open slots.
  sameDayDelivery: {
    enabled:      { type: Boolean, default: true },
    cutoffTime:   { type: String, default: '09:00' }, // "HH:mm", 24-hour, IST
    updatedBy:    { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedByName:{ type: String },
    updatedAt:    { type: Date },
  },

}, { timestamps: true });

/** Upsert the global lastProductUpdateTime */
koyambeduSettingsSchema.statics.touchPriceUpdate = async function(userId, userName) {
  return this.findOneAndUpdate(
    { key: 'global' },
    { lastProductUpdateTime: new Date(), lastProductUpdateBy: userId, lastProductUpdateByName: userName },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
};

/** Get the global settings doc (creates if missing) */
koyambeduSettingsSchema.statics.getGlobal = async function() {
  let doc = await this.findOne({ key: 'global' });
  if (!doc) doc = await this.create({ key: 'global' });
  return doc;
};

/**
 * Check if payment test mode is currently active.
 * Automatically expires the mode if expiresAt has passed.
 * Returns { enabled, expiresAt, justExpired }
 */
koyambeduSettingsSchema.statics.checkPaymentTestMode = async function() {
  const doc = await this.findOne({ key: 'global' });
  if (!doc || !doc.paymentTestMode?.enabled) return { enabled: false };

  const ptm = doc.paymentTestMode;

  // Check expiry
  if (ptm.expiresAt && new Date() > ptm.expiresAt) {
    // Auto-expire
    await this.findOneAndUpdate(
      { key: 'global' },
      {
        'paymentTestMode.enabled':   false,
        'paymentTestMode.expiresAt': null,
        $push: {
          'paymentTestMode.auditLog': {
            action: 'expired', by: ptm.enabledBy, byName: ptm.enabledByName, at: new Date(),
          },
        },
      }
    );
    return { enabled: false, justExpired: true };
  }

  return { enabled: true, expiresAt: ptm.expiresAt };
};

/** Get the current same-day delivery gate ({ enabled, cutoffTime }), with safe defaults if unset. */
koyambeduSettingsSchema.statics.getSameDayDelivery = async function() {
  const doc = await this.findOne({ key: 'global' }).select('sameDayDelivery').lean();
  const sd = doc?.sameDayDelivery || {};
  return {
    enabled: sd.enabled !== undefined ? sd.enabled : true,
    cutoffTime: sd.cutoffTime || '09:00',
  };
};

module.exports = mongoose.model('KoyambeduSettings', koyambeduSettingsSchema);
