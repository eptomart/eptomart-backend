// Koyambedu packing slip / pack label printing — customer phone privacy.
const test = require('node:test');
const assert = require('node:assert/strict');
const { fakeRes, chain } = require('../express/helpers');
const Order = require('../../src/models/KoyambeduOrder');
const ctrl = require('../../src/controllers/koyambeduController');

const order = { _id: 'o1', orderId: 'KB1', placedAt: new Date(), orderStatus: 'confirmed', shippingAddress: { fullName: 'Priya', phone: '9876543210', addressLine1: '1 St' }, buyer: { name: 'P', phone: '9111111111' }, items: [{ name: 'Tomato', quantity: 2, unit: 'kg' }] };
const run = async (role) => {
  const c = chain([order]); c.skip = () => c; Order.find = () => c; Order.countDocuments = async () => 1;
  const res = fakeRes(); await ctrl.getOrdersForPrinting({ query: {}, user: { role } }, res); return res.body;
};

test('PR-01 super admin receives the phone number', async () => {
  const b = await run('superAdmin'); assert.equal(b.orders[0].customerPhone, '9876543210');
});
test('PR-02 admin / anyone else gets NO phone number', async () => {
  for (const role of ['admin', 'seller', undefined]) {
    const b = await run(role); assert.equal(b.orders[0].customerPhone, '');
    assert.ok(!JSON.stringify(b).includes('9876543210') && !JSON.stringify(b).includes('9111111111'));
  }
});
test('PR-03 the printer code never prints a phone', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../../../eptomart-frontend/src/utils/thermalPrinter.js'), 'utf8');
  assert.ok(!/Phone:/.test(src) && !/customerPhone\)/.test(src.replace(/\/\/.*$/gm, '')), 'thermalPrinter.js must not print a phone number');
});
