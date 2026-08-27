// ============================================
// KOYAMBEDU COMBOS / FLASH SALE — Settings Controller
//
// Combos are NOT a standalone vertical (see KoyambeduComboSettings.js header
// for the full rationale) — combo products are normal KoyambeduProduct docs
// (isCombo: true) sold through the existing shop/cart/checkout/order flow in
// koyambeduController.js. This controller ONLY exposes the combo-specific
// settings (feature toggle, same-day cutoff, delivery slots, distance-tiered
// delivery pricing, minimum order value) that KoyambeduCheckout.jsx consults
// when (a) the feature is on and (b) the cart contains a combo item.
//
// Nothing here creates/edits combo PRODUCTS — those are created through the
// existing Koyambedu product-create endpoints (adminCreateProduct /
// sellerAdminCreateProduct) with isCombo=true + comboContents, exactly like
// any other product, just with two extra fields.
// ============================================
const KoyambeduComboSettings = require('../models/KoyambeduComboSettings');

// ══════════════════════════════════════════════
// PUBLIC — Settings / status
// ══════════════════════════════════════════════

/** GET /koyambedu/combos/status — public, no auth. Home.jsx banner + shop + checkout use this. */
const getPublicStatus = async (req, res) => {
  try {
    const status = await KoyambeduComboSettings.getPublicStatus();
    res.json({ success: true, ...status });
  } catch (err) {
    console.error('[KoyambeduCombo] getPublicStatus error:', err);
    // Fail safe: treat as disabled rather than erroring out the home/checkout page —
    // this guarantees the normal Koyambedu Daily flow is what customers fall back to.
    res.json({ success: true, featureEnabled: false, sameDayDelivery: { enabled: false, cutoffTime: '14:00' }, deliverySlots: [], delivery: {}, minOrderValue: 0 });
  }
};

// ══════════════════════════════════════════════
// SUPER ADMIN — Settings
// ══════════════════════════════════════════════

const adminGetSettings = async (req, res) => {
  try {
    const doc = await KoyambeduComboSettings.getGlobal();
    res.json({ success: true, settings: doc });
  } catch (err) {
    console.error('[KoyambeduCombo] adminGetSettings error:', err);
    res.status(500).json({ success: false, message: 'Failed to load combo settings' });
  }
};

/** PATCH /koyambedu/combos/admin/settings/feature — body: { enabled } */
const adminToggleFeature = async (req, res) => {
  try {
    const { enabled } = req.body;
    const doc = await KoyambeduComboSettings.findOneAndUpdate(
      { key: 'global' },
      {
        featureEnabled: !!enabled,
        featureEnabledBy: req.user._id, featureEnabledByName: req.user.name, featureEnabledAt: new Date(),
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.json({ success: true, settings: doc });
  } catch (err) {
    console.error('[KoyambeduCombo] adminToggleFeature error:', err);
    res.status(500).json({ success: false, message: 'Failed to update feature toggle' });
  }
};

/** PUT /koyambedu/combos/admin/settings/same-day-delivery — body: { enabled?, cutoffTime? } */
const adminUpdateSameDayDelivery = async (req, res) => {
  try {
    const { enabled, cutoffTime } = req.body;
    const update = {
      'sameDayDelivery.updatedBy': req.user._id,
      'sameDayDelivery.updatedByName': req.user.name,
      'sameDayDelivery.updatedAt': new Date(),
    };
    if (enabled !== undefined) update['sameDayDelivery.enabled'] = !!enabled;
    if (cutoffTime !== undefined) {
      if (!/^\d{2}:\d{2}$/.test(cutoffTime)) return res.status(400).json({ success: false, message: 'cutoffTime must be HH:mm' });
      update['sameDayDelivery.cutoffTime'] = cutoffTime;
    }
    const doc = await KoyambeduComboSettings.findOneAndUpdate(
      { key: 'global' }, update, { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.json({ success: true, sameDayDelivery: doc.sameDayDelivery });
  } catch (err) {
    console.error('[KoyambeduCombo] adminUpdateSameDayDelivery error:', err);
    res.status(500).json({ success: false, message: 'Failed to update same-day delivery settings' });
  }
};

/** PUT /koyambedu/combos/admin/settings/delivery-slots — body: { slots: [{key,label,startTime,endTime,enabled}] } */
const adminUpdateDeliverySlots = async (req, res) => {
  try {
    const { slots } = req.body;
    if (!Array.isArray(slots)) return res.status(400).json({ success: false, message: 'slots must be an array' });
    for (const s of slots) {
      if (!s.key || !s.label || !s.startTime || !s.endTime) {
        return res.status(400).json({ success: false, message: 'Each slot needs key, label, startTime, endTime' });
      }
    }
    const doc = await KoyambeduComboSettings.findOneAndUpdate(
      { key: 'global' }, { deliverySlots: slots }, { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.json({ success: true, deliverySlots: doc.deliverySlots });
  } catch (err) {
    console.error('[KoyambeduCombo] adminUpdateDeliverySlots error:', err);
    res.status(500).json({ success: false, message: 'Failed to update delivery slots' });
  }
};

/** PUT /koyambedu/combos/admin/settings/delivery-charges
 *  body: { originLat?, originLng?, originLabel?, freeRadiusKm?, blockSizeKm?, chargePerBlock?, maxDeliveryKm? } */
const adminUpdateDeliveryCharges = async (req, res) => {
  try {
    const allowed = ['originLat', 'originLng', 'originLabel', 'freeRadiusKm', 'blockSizeKm', 'chargePerBlock', 'maxDeliveryKm'];
    const update = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) update[`delivery.${key}`] = req.body[key];
    }
    update['delivery.updatedBy']     = req.user._id;
    update['delivery.updatedByName'] = req.user.name;
    update['delivery.updatedAt']     = new Date();
    const doc = await KoyambeduComboSettings.findOneAndUpdate(
      { key: 'global' }, update, { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.json({ success: true, delivery: doc.delivery });
  } catch (err) {
    console.error('[KoyambeduCombo] adminUpdateDeliveryCharges error:', err);
    res.status(500).json({ success: false, message: 'Failed to update delivery charges' });
  }
};

/** PUT /koyambedu/combos/admin/settings/min-order — body: { value } */
const adminUpdateMinOrderValue = async (req, res) => {
  try {
    const { value } = req.body;
    if (value === undefined || isNaN(Number(value)) || Number(value) < 0) {
      return res.status(400).json({ success: false, message: 'value must be a non-negative number' });
    }
    const doc = await KoyambeduComboSettings.findOneAndUpdate(
      { key: 'global' },
      {
        'minOrderValue.value': Number(value),
        'minOrderValue.updatedBy': req.user._id,
        'minOrderValue.updatedByName': req.user.name,
        'minOrderValue.updatedAt': new Date(),
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.json({ success: true, minOrderValue: doc.minOrderValue });
  } catch (err) {
    console.error('[KoyambeduCombo] adminUpdateMinOrderValue error:', err);
    res.status(500).json({ success: false, message: 'Failed to update minimum order value' });
  }
};

/** PUT /koyambedu/combos/admin/settings/platform-fee-discount
 *  body: { enabled?, type?: 'flat'|'percent', value? }
 *  Reward for meeting minOrderValue above, applied to combo carts only —
 *  see KoyambeduSettings.orderMinimum.platformFeeDiscount for the
 *  independent normal-cart equivalent. */
const adminUpdatePlatformFeeDiscount = async (req, res) => {
  try {
    const { enabled, type, value } = req.body;
    const update = {
      'platformFeeDiscount.updatedBy':     req.user._id,
      'platformFeeDiscount.updatedByName': req.user.name,
      'platformFeeDiscount.updatedAt':     new Date(),
    };
    if (enabled !== undefined) update['platformFeeDiscount.enabled'] = !!enabled;
    if (type !== undefined) {
      if (!['flat', 'percent'].includes(type)) return res.status(400).json({ success: false, message: "type must be 'flat' or 'percent'" });
      update['platformFeeDiscount.type'] = type;
    }
    if (value !== undefined) {
      const v = Number(value);
      if (!(v >= 0)) return res.status(400).json({ success: false, message: 'value must be a non-negative number' });
      update['platformFeeDiscount.value'] = v;
    }
    const doc = await KoyambeduComboSettings.findOneAndUpdate(
      { key: 'global' }, update, { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.json({ success: true, platformFeeDiscount: doc.platformFeeDiscount });
  } catch (err) {
    console.error('[KoyambeduCombo] adminUpdatePlatformFeeDiscount error:', err);
    res.status(500).json({ success: false, message: 'Failed to update platform fee discount' });
  }
};

module.exports = {
  // Public
  getPublicStatus,
  // Super Admin — settings
  adminGetSettings, adminToggleFeature, adminUpdateSameDayDelivery,
  adminUpdateDeliverySlots, adminUpdateDeliveryCharges, adminUpdateMinOrderValue,
  adminUpdatePlatformFeeDiscount,
};
