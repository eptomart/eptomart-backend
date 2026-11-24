// Koyambedu fee waiver (0–100 % off delivery / platform fee)
const test = require('node:test');
const assert = require('node:assert/strict');
const { fakeRes, chain } = require('../express/helpers');
const { effectivePercents, applyFeeDiscount } = require('../../src/utils/koyambeduFeeDiscount');
const Settings = require('../../src/models/KoyambeduSettings');
const User = require('../../src/models/User');
const dev = require('../../src/controllers/koyambeduDevSettingsController');

test('FW-01 100% delivery waiver → 0, real fee struck out', () => {
  const o = applyFeeDiscount({ deliveryCharge: 125, originalDeliveryCharge: null, platformFee: 75 }, { deliveryPercent: 100, platformPercent: 0 });
  assert.equal(o.deliveryCharge, 0); assert.equal(o.originalDeliveryCharge, 125); assert.equal(o.platformFee, 75); assert.equal(o.originalPlatformFee, undefined);
});
test('FW-02 partial platform waiver', () => {
  const o = applyFeeDiscount({ deliveryCharge: 125, platformFee: 75 }, { deliveryPercent: 0, platformPercent: 40 });
  assert.equal(o.platformFee, 45); assert.equal(o.originalPlatformFee, 75); assert.equal(o.deliveryCharge, 125);
});
test('FW-03 existing small-order list price stays as the struck-out figure', () => {
  const o = applyFeeDiscount({ deliveryCharge: 49, originalDeliveryCharge: 149, platformFee: 25, originalPlatformFee: 75 }, { deliveryPercent: 100, platformPercent: 100 });
  assert.equal(o.deliveryCharge, 0); assert.equal(o.originalDeliveryCharge, 149); assert.equal(o.platformFee, 0); assert.equal(o.originalPlatformFee, 75);
});
test('FW-04 percentages clamp to 0–100; bad values ignored', () => {
  const o = applyFeeDiscount({ deliveryCharge: 100, platformFee: 50 }, { deliveryPercent: 250, platformPercent: 'x' });
  assert.equal(o.deliveryCharge, 0); assert.equal(o.platformFee, 50);
});
test('FW-05 customer and global: higher wins', () => {
  assert.deepEqual(effectivePercents({ deliveryPercent: 20, platformPercent: 100 }, { deliveryPercent: 50, platformPercent: 0 }), { deliveryPercent: 50, platformPercent: 100 });
  assert.deepEqual(effectivePercents(null, undefined), { deliveryPercent: 0, platformPercent: 0 });
});
test('FW-06 platform:false leaves platform fee untouched (address-change re-pricing)', () => {
  const o = applyFeeDiscount({ deliveryCharge: 200, platformFee: 10 }, { deliveryPercent: 50, platformPercent: 100 }, { platform: false });
  assert.equal(o.deliveryCharge, 100); assert.equal(o.platformFee, 10);
});
test('FW-07 zero-fee stays zero, no fake strike-through', () => {
  const o = applyFeeDiscount({ deliveryCharge: 0, platformFee: 0 }, { deliveryPercent: 100, platformPercent: 100 });
  assert.equal(o.originalDeliveryCharge, undefined); assert.equal(o.originalPlatformFee, undefined);
});

test('FW-08 global update validates 0–100 and saves', async () => {
  let upd;
  Settings.findOneAndUpdate = async (q, u) => { upd = u; return {}; };
  Settings.getFeeDiscount = async () => ({ deliveryPercent: 100, platformPercent: 30 });
  const bad = fakeRes(); await dev.updateFeeDiscount({ user: { _id: 'a', name: 'SA' }, body: { deliveryPercent: 101 } }, bad);
  assert.equal(bad.statusCode, 400);
  const ok = fakeRes(); await dev.updateFeeDiscount({ user: { _id: 'a', name: 'SA' }, body: { deliveryPercent: 100, platformPercent: 30 } }, ok);
  assert.equal(ok.body.success, true); assert.equal(upd['feeDiscount.deliveryPercent'], 100); assert.equal(upd['feeDiscount.platformPercent'], 30);
});
test('FW-09 per-customer set / validate / not found', async () => {
  let set;
  User.findOneAndUpdate = (q, u) => { set = u; return chain(q._id === 'none' ? null : { _id: q._id }); };
  const r = fakeRes(); await dev.setCustomerFeeDiscount({ params: { userId: 'u1' }, body: { deliveryPercent: 100, platformPercent: 0 } }, r);
  assert.equal(r.body.success, true); assert.equal(set.$set['koyambeduFeeDiscount.deliveryPercent'], 100);
  const bad = fakeRes(); await dev.setCustomerFeeDiscount({ params: { userId: 'u1' }, body: { deliveryPercent: -5 } }, bad);
  assert.equal(bad.statusCode, 400);
  const nf = fakeRes(); await dev.setCustomerFeeDiscount({ params: { userId: 'none' }, body: {} }, nf);
  assert.equal(nf.statusCode, 404);
});

// ── customer-selectable offers ───────────────────────────────────────────
const { offerStatuses, resolveOffers } = require('../../src/utils/koyambeduFeeDiscount');
const CFG = { freeDelivery: { enabled: true, minOrder: 1500, percent: 100 }, freePlatform: { enabled: true, minOrder: 2500, percent: 50 } };

test('OF-01 only enabled offers listed; eligibility by cart value', () => {
  assert.equal(offerStatuses({ freeDelivery: { enabled: false } }, 9999).length, 0);
  const s = offerStatuses(CFG, 1800);
  assert.equal(s.find(o => o.key === 'delivery').eligible, true);
  const p = s.find(o => o.key === 'platform'); assert.equal(p.eligible, false); assert.equal(p.shortBy, 700);
});
test('OF-02 picked eligible offer sets the %', () => {
  const r = resolveOffers({ deliveryPercent: 0, platformPercent: 0 }, CFG, 3000, ['delivery', 'platform']);
  assert.deepEqual(r.pcts, { deliveryPercent: 100, platformPercent: 50 }); assert.deepEqual(r.applied, ['delivery', 'platform']);
});
test('OF-03 ineligible or disabled offer is rejected', () => {
  assert.throws(() => resolveOffers({}, CFG, 1000, ['delivery']), e => /Add ₹500 more/.test(e.message));
  assert.throws(() => resolveOffers({}, { freeDelivery: { enabled: false } }, 9999, ['delivery']), e => /not available/.test(e.message));
});
test('OF-04 higher of waiver and offer wins; unknown keys ignored', () => {
  const r = resolveOffers({ deliveryPercent: 100, platformPercent: 0 }, { freeDelivery: { enabled: true, minOrder: 0, percent: 40 } }, 10, ['delivery', 'bogus']);
  assert.equal(r.pcts.deliveryPercent, 100); assert.deepEqual(r.applied, ['delivery']);
});
test('OF-05 admin saves offers with validation', async () => {
  let u;
  Settings.findOneAndUpdate = async (q, upd) => { u = upd; return {}; };
  Settings.getOffers = async () => ({ lowWeightMinOrder: 400 });
  const ok = fakeRes(); await dev.updateOffers({ user: { name: 'SA' }, body: { lowWeightMinOrder: 400, freeDelivery: { enabled: true, minOrder: 1500, percent: 100 } } }, ok);
  assert.equal(ok.body.success, true); assert.equal(u['offers.lowWeightMinOrder'], 400); assert.equal(u['offers.freeDelivery.minOrder'], 1500);
  const bad = fakeRes(); await dev.updateOffers({ user: { name: 'SA' }, body: { freePlatform: { percent: 0 } } }, bad);
  assert.equal(bad.statusCode, 400);
  const neg = fakeRes(); await dev.updateOffers({ user: { name: 'SA' }, body: { lowWeightMinOrder: -1 } }, neg);
  assert.equal(neg.statusCode, 400);
});

test('OF-06 offer limited to maxKm of nearest hub', () => {
  const cfg = { freeDelivery: { enabled: true, minOrder: 0, percent: 100, maxKm: 25 } };
  assert.equal(offerStatuses(cfg, 100, 24.9).length, 1);
  assert.equal(offerStatuses(cfg, 100, 25).length, 1);
  assert.equal(offerStatuses(cfg, 100, 25.1).length, 0);
  assert.equal(offerStatuses({ freeDelivery: { enabled: true, minOrder: 0, maxKm: 0 } }, 100, 400).length, 1);
  assert.throws(() => resolveOffers({}, cfg, 100, ['delivery'], 30), e => /not available/.test(e.message));
  assert.deepEqual(resolveOffers({}, cfg, 100, ['delivery'], 10).applied, ['delivery']);
});

test('OF-07 hub-wise radius overrides the default; blank hub uses default', () => {
  const cfg = { freeDelivery: { enabled: true, minOrder: 0, percent: 100, maxKm: 25 } };
  assert.equal(offerStatuses(cfg, 1, 12, { freeDeliveryKm: 10 }).length, 0);   // hub says 10 km
  assert.equal(offerStatuses(cfg, 1, 12, { freeDeliveryKm: 15 }).length, 1);
  assert.equal(offerStatuses(cfg, 1, 30, { freeDeliveryKm: 40 }).length, 1);   // hub wider than default
  assert.equal(offerStatuses(cfg, 1, 30, { freeDeliveryKm: null }).length, 0); // default 25
  assert.equal(offerStatuses(cfg, 1, 30, { freeDeliveryKm: 0 }).length, 1);    // 0 = no limit at this hub
  assert.throws(() => resolveOffers({}, cfg, 1, ['delivery'], 12, { freeDeliveryKm: 10 }), e => /not available/.test(e.message));
});
