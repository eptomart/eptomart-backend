// ============================================
// KOYAMBEDU DEV SETTINGS CONTROLLER
// Manages development/testing feature flags for Koyambedu Daily.
// All mutating endpoints are SuperAdmin-only.
// The public status endpoint returns minimal data (enabled + expiresAt only).
//
// Endpoints:
//   GET  /koyambedu/dev-settings/payment-test-mode          — public status (for checkout)
//   GET  /koyambedu/admin/dev-settings/payment-test-mode    — full status + audit log (SA only)
//   PUT  /koyambedu/admin/dev-settings/payment-test-mode/enable  — enable (SA only)
//   PUT  /koyambedu/admin/dev-settings/payment-test-mode/disable — disable (SA only)
// ============================================
const KoyambeduSettings = require('../models/KoyambeduSettings');

// Valid expiry options in minutes (null = no expiry)
const EXPIRY_OPTIONS = {
  '30m':  30,
  '1h':   60,
  '2h':   120,
  'eod':  null,   // end of day — computed dynamically
  'never': null,  // manual disable only
};

const _endOfDay = () => {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
};

// ── PUBLIC ───────────────────────────────────────────────────────────

/**
 * GET /koyambedu/dev-settings/payment-test-mode
 * Returns { enabled: bool, expiresAt: Date|null }
 * Used by checkout to decide whether to show test payment buttons.
 * No auth required — but we only expose the minimum needed.
 */
const getPaymentTestModePublic = async (req, res) => {
  try {
    const status = await KoyambeduSettings.checkPaymentTestMode();
    res.json({
      success: true,
      enabled:   status.enabled,
      expiresAt: status.expiresAt || null,
    });
  } catch (err) {
    console.error('[DevSettings] getPaymentTestModePublic error:', err.message);
    // Fail safe — disable on error so test buttons never unexpectedly show
    res.json({ success: true, enabled: false, expiresAt: null });
  }
};

// ── SUPER ADMIN ──────────────────────────────────────────────────────

/**
 * GET /koyambedu/admin/dev-settings/payment-test-mode
 * Returns full status including audit log. SuperAdmin only.
 */
const getPaymentTestModeAdmin = async (req, res) => {
  try {
    const status = await KoyambeduSettings.checkPaymentTestMode();
    const doc    = await KoyambeduSettings.findOne({ key: 'global' });
    const ptm    = doc?.paymentTestMode || {};

    res.json({
      success: true,
      enabled:       status.enabled,
      expiresAt:     ptm.expiresAt     || null,
      enabledBy:     ptm.enabledByName || null,
      enabledAt:     ptm.enabledAt     || null,
      auditLog:      (ptm.auditLog || []).slice().reverse(), // newest first
    });
  } catch (err) {
    console.error('[DevSettings] getPaymentTestModeAdmin error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to fetch dev settings' });
  }
};

/**
 * PUT /koyambedu/admin/dev-settings/payment-test-mode/enable
 * Body: { expiresIn: '30m' | '1h' | '2h' | 'eod' | 'never' }
 * SuperAdmin only.
 */
const enablePaymentTestMode = async (req, res) => {
  try {
    const { expiresIn = 'never' } = req.body;

    let expiresAt = null;
    if (expiresIn === 'eod') {
      expiresAt = _endOfDay();
    } else if (expiresIn && EXPIRY_OPTIONS[expiresIn] != null) {
      expiresAt = new Date(Date.now() + EXPIRY_OPTIONS[expiresIn] * 60 * 1000);
    }

    const auditEntry = {
      action:    'enabled',
      by:        req.user._id,
      byName:    req.user.name || req.user.email,
      at:        new Date(),
      ip:        req.ip || req.headers['x-forwarded-for'] || 'unknown',
      expiresAt: expiresAt || undefined,
    };

    await KoyambeduSettings.findOneAndUpdate(
      { key: 'global' },
      {
        'paymentTestMode.enabled':       true,
        'paymentTestMode.enabledBy':     req.user._id,
        'paymentTestMode.enabledByName': req.user.name || req.user.email,
        'paymentTestMode.enabledAt':     new Date(),
        'paymentTestMode.expiresAt':     expiresAt,
        $push: { 'paymentTestMode.auditLog': auditEntry },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    console.log(`[DevSettings] Payment test mode ENABLED by ${req.user.email} (expires: ${expiresAt || 'never'})`);

    res.json({
      success:   true,
      message:   'Payment test mode enabled',
      enabled:   true,
      expiresAt: expiresAt || null,
    });
  } catch (err) {
    console.error('[DevSettings] enablePaymentTestMode error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to enable payment test mode' });
  }
};

/**
 * PUT /koyambedu/admin/dev-settings/payment-test-mode/disable
 * SuperAdmin only.
 */
const disablePaymentTestMode = async (req, res) => {
  try {
    const auditEntry = {
      action: 'disabled',
      by:     req.user._id,
      byName: req.user.name || req.user.email,
      at:     new Date(),
      ip:     req.ip || req.headers['x-forwarded-for'] || 'unknown',
    };

    await KoyambeduSettings.findOneAndUpdate(
      { key: 'global' },
      {
        'paymentTestMode.enabled':   false,
        'paymentTestMode.expiresAt': null,
        $push: { 'paymentTestMode.auditLog': auditEntry },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    console.log(`[DevSettings] Payment test mode DISABLED by ${req.user.email}`);

    res.json({ success: true, message: 'Payment test mode disabled', enabled: false });
  } catch (err) {
    console.error('[DevSettings] disablePaymentTestMode error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to disable payment test mode' });
  }
};

// ══════════════════════════════════════════════════════════════════
// SAME-DAY DELIVERY — global cutoff time + on/off gate
// Super Admin controlled. This is checked IN ADDITION TO (never instead of)
// the existing per-date/per-slot KoyambeduDeliverySchedule controls — those
// keep working exactly as before. This just replaces what used to be a
// hardcoded "9 AM" in the checkout frontend with an admin-editable value,
// and adds a single platform-wide same-day on/off switch.
//
// Endpoints:
//   GET /koyambedu/dev-settings/same-day-delivery        — public status (checkout reads this)
//   GET /koyambedu/admin/dev-settings/same-day-delivery   — full status (SA only)
//   PUT /koyambedu/admin/dev-settings/same-day-delivery   — update (SA only), body: { enabled?, cutoffTime? }
// ══════════════════════════════════════════════════════════════════

/**
 * GET /koyambedu/dev-settings/same-day-delivery
 * Returns { enabled: bool, cutoffTime: "HH:mm" }. No auth required — the
 * checkout page needs this before the customer logs in / picks a slot.
 */
const getSameDayDeliveryPublic = async (req, res) => {
  try {
    const sd = await KoyambeduSettings.getSameDayDelivery();
    res.json({ success: true, ...sd });
  } catch (err) {
    console.error('[DevSettings] getSameDayDeliveryPublic error:', err.message);
    // Fail safe — keep existing behaviour (same-day on, 9 AM cutoff) on error
    res.json({ success: true, enabled: true, cutoffTime: '09:00' });
  }
};

/**
 * GET /koyambedu/admin/dev-settings/same-day-delivery
 * SuperAdmin only — includes who last changed it.
 */
const getSameDayDeliveryAdmin = async (req, res) => {
  try {
    const doc = await KoyambeduSettings.findOne({ key: 'global' });
    const sd  = doc?.sameDayDelivery || {};
    res.json({
      success: true,
      enabled: sd.enabled !== undefined ? sd.enabled : true,
      cutoffTime: sd.cutoffTime || '09:00',
      updatedByName: sd.updatedByName || null,
      updatedAt: sd.updatedAt || null,
    });
  } catch (err) {
    console.error('[DevSettings] getSameDayDeliveryAdmin error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to fetch same-day delivery settings' });
  }
};

/**
 * PUT /koyambedu/admin/dev-settings/same-day-delivery
 * Body: { enabled?: boolean, cutoffTime?: "HH:mm" }. SuperAdmin only.
 */
const updateSameDayDelivery = async (req, res) => {
  try {
    const { enabled, cutoffTime } = req.body;
    const update = {
      'sameDayDelivery.updatedBy': req.user._id,
      'sameDayDelivery.updatedByName': req.user.name || req.user.email,
      'sameDayDelivery.updatedAt': new Date(),
    };
    if (enabled !== undefined) update['sameDayDelivery.enabled'] = !!enabled;
    if (cutoffTime !== undefined) {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(cutoffTime)) {
        return res.status(400).json({ success: false, message: 'cutoffTime must be in HH:mm 24-hour format' });
      }
      update['sameDayDelivery.cutoffTime'] = cutoffTime;
    }

    const doc = await KoyambeduSettings.findOneAndUpdate(
      { key: 'global' }, update, { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    console.log(`[DevSettings] Same-day delivery updated by ${req.user.email}:`, doc.sameDayDelivery);
    res.json({ success: true, ...(await KoyambeduSettings.getSameDayDelivery()) });
  } catch (err) {
    console.error('[DevSettings] updateSameDayDelivery error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to update same-day delivery settings' });
  }
};

module.exports = {
  getPaymentTestModePublic,
  getPaymentTestModeAdmin,
  enablePaymentTestMode,
  disablePaymentTestMode,
  getSameDayDeliveryPublic,
  getSameDayDeliveryAdmin,
  updateSameDayDelivery,
};
