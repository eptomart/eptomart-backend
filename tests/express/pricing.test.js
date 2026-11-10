// Express pricing / delivery maths (pure functions).
const test = require('node:test');
const assert = require('node:assert/strict');
const p = require('../../src/services/expressPricingService');

const cfg = { platformChargePct: 20, salesmanChargePct: 20, packingChargePct: 20, logisticsCostPerKg: 0 };

test('PR-01 default stack: cost 100 → 160 (20+20+20 %)', () => {
  assert.equal(p.computeSellingPrice({ unit: 'kg', procurementBaseCost: 100 }, cfg).sellingPricePerUnit, 160);
});
test('PR-02 custom margin REPLACES the whole stack (cost 100, 10 % → 110)', () => {
  assert.equal(p.computeSellingPrice({ unit: 'kg', procurementBaseCost: 100, customMarginPct: 10 }, cfg).sellingPricePerUnit, 110);
});
test('PR-03 logistics cost per kg is added to cost before margins', () => {
  const r = p.computeSellingPrice({ unit: 'kg', procurementBaseCost: 100 }, { ...cfg, logisticsCostPerKg: 10 });
  assert.equal(r.baseCostPerUnit, 110);
  assert.equal(r.sellingPricePerUnit, 176);
});
test('PR-04 price is always a whole rupee', () => {
  const r = p.computeSellingPrice({ unit: 'kg', procurementBaseCost: 33.33 }, cfg);
  assert.equal(Number.isInteger(r.sellingPricePerUnit), true);
});
test('PR-05 bunch unit converts via unitsPerKg for logistics', () => {
  const r = p.computeSellingPrice({ unit: 'bunch', unitsPerKg: 10, procurementBaseCost: 10 }, { ...cfg, logisticsCostPerKg: 10 });
  assert.equal(r.logisticsCostPerUnit, 1);
});
test('PR-06 unit with no unitsPerKg adds no logistics', () => {
  assert.equal(p.toKgEquivalent({ unit: 'piece' }, 5), 0);
});
test('PR-07 gram → kg equivalent', () => assert.equal(p.toKgEquivalent({ unit: 'gram' }, 500), 0.5));
test('PR-08 delivery fee: below minimum charged, at/above minimum free', () => {
  const fee = { minOrderForFreeDelivery: 300, deliveryFeeBelowMinimum: 40 };
  assert.equal(p.computeDeliveryFee(299, fee), 40);
  assert.equal(p.computeDeliveryFee(300, fee), 0);
  assert.equal(p.computeDeliveryFee(1000, fee), 0);
});
test('PR-09 distance surcharge: free radius, partial step rounds up, disabled when no charge', () => {
  const fee = { distanceChargePerStep: 10, freeDeliveryDistanceKm: 5, distanceStepKm: 2 };
  assert.equal(p.computeDistanceSurcharge(4, fee), 0);
  assert.equal(p.computeDistanceSurcharge(5, fee), 0);
  assert.equal(p.computeDistanceSurcharge(6, fee), 10);
  assert.equal(p.computeDistanceSurcharge(7.5, fee), 20);
  assert.equal(p.computeDistanceSurcharge(20, { ...fee, distanceChargePerStep: 0 }), 0);
});
test('PR-10 ETA picks first tier that fits; falls back to the largest; null if none', () => {
  const m = { deliveryTimeTiers: [{ maxDistanceKm: 10, etaMinutes: 60 }, { maxDistanceKm: 3, etaMinutes: 30 }] };
  assert.equal(p.computeDeliveryEta(2, m), 30);
  assert.equal(p.computeDeliveryEta(5, m), 60);
  assert.equal(p.computeDeliveryEta(50, m), 60);
  assert.equal(p.computeDeliveryEta(2, {}), null);
});
test('PR-11 haversine distance sanity (Chennai Central → Koyambedu ≈ 8–10 km), missing point = Infinity', () => {
  const d = p.distanceKm({ lat: 13.0827, lng: 80.2707 }, { lat: 13.0694, lng: 80.1948 });
  assert.ok(d > 6 && d < 12, `got ${d}`);
  assert.equal(p.distanceKm(null, { lat: 1, lng: 1 }), Infinity);
});
test('PR-12 logistics cost per kg = total shipment cost / total kg; 0 when no kg', () => {
  assert.equal(p.computeLogisticsCostPerKg([{ cost: 1800 }, { cost: 600 }, { cost: 400 }], 800), 3.5);
  assert.equal(p.computeLogisticsCostPerKg([{ cost: 100 }], 0), 0);
});
