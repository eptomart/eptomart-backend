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

  // ── Low Weight Order Promo (Koyambedu Daily) ─────────────────────────
  // Super Admin controlled. Surfaces an EXISTING coupon (created/managed via
  // the universal Coupons admin page — discount type/value live there, not
  // here) as a suggested promo popup on the checkout payment step when the
  // cart's total gross weight is below thresholdKg. This setting only picks
  // WHICH coupon code to surface and AT WHAT weight threshold — it never
  // auto-applies anything; the customer must tap "Apply" themselves via the
  // existing coupon-apply flow, same as manually typing a code.
  lowWeightPromo: {
    enabled:      { type: Boolean, default: false },
    couponCode:   { type: String, default: null },
    thresholdKg:  { type: Number, default: 12 },
    updatedBy:    { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedByName:{ type: String },
    updatedAt:    { type: Date },
  },

  // ── Minimum Order Value — NORMAL products (Koyambedu Daily) ─────────
  // Super Admin controlled. Replaces the old hardcoded ₹799 floor in
  // placeOrder. Kept separate from KoyambeduComboSettings.minOrderValue,
  // which governs carts containing a combo item instead — see that model
  // for the combo-side equivalent of both fields below.
  orderMinimum: {
    value: { type: Number, default: 799 },
    // Reward for reaching the minimum above: since the minimum is already
    // enforced before an order can be placed, every successful normal order
    // has "achieved" it — this just controls whether/how much platform fee
    // is then discounted for that order.
    platformFeeDiscount: {
      enabled: { type: Boolean, default: false },
      type:    { type: String, enum: ['flat', 'percent'], default: 'flat' }, // flat = ₹ off, percent = % off
      value:   { type: Number, default: 0 },
    },
    updatedBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedByName: { type: String },
    updatedAt:     { type: Date },
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

/** Get the current low-weight promo gate ({ enabled, couponCode, thresholdKg }), with safe defaults if unset. */
koyambeduSettingsSchema.statics.getLowWeightPromo = async function() {
  const doc = await this.findOne({ key: 'global' }).select('lowWeightPromo').lean();
  const lw = doc?.lowWeightPromo || {};
  return {
    enabled:     lw.enabled || false,
    couponCode:  lw.couponCode || null,
    thresholdKg: lw.thresholdKg || 12,
  };
};

/** Get the current normal-products minimum order config, with safe defaults if unset. */
koyambeduSettingsSchema.statics.getOrderMinimum = async function() {
  const doc = await this.findOne({ key: 'global' }).select('orderMinimum').lean();
  const om = doc?.orderMinimum || {};
  return {
    value: om.value ?? 799,
    platformFeeDiscount: {
      enabled: om.platformFeeDiscount?.enabled || false,
      type:    om.platformFeeDiscount?.type    || 'flat',
      value:   om.platformFeeDiscount?.value   ?? 0,
    },
  };
};

module.exports = mongoose.model('KoyambeduSettings', koyambeduSettingsSchema);
