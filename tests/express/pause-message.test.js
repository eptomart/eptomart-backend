// Express — per-store "back soon" hold: default message, editing message, customer-facing text.
const test = require('node:test');
const assert = require('node:assert/strict');
const { fakeRes } = require('./helpers');
const Store = require('../../src/models/ExpressStore');
const Audit = require('../../src/models/ExpressAuditLog');
const admin = require('../../src/controllers/expressAdminController');

const mk = (o = {}) => { const s = { _id: 's1', isPaused: false, pauseMessage: null, ...o, async save() { s.saved = true; } }; return s; };
const run = async (store, body) => {
  Store.findById = async () => store; Audit.create = async () => ({});
  const res = fakeRes(); await admin.togglePauseStore({ params: { storeId: 's1' }, body, user: { name: 'A' } }, res); return res;
};

test('PM-01 hold with no reason → default "back soon" message that points to Koyambedu wholesale', async () => {
  const s = mk(); await run(s, {});
  assert.equal(s.isPaused, true);
  assert.match(s.pauseMessage, /back soon/i);
  assert.match(s.pauseMessage, /Koyambedu Daily Wholesale/);
});
test('PM-02 hold with own reason → kept as typed (trimmed, max 300)', async () => {
  const s = mk(); await run(s, { message: '  Stock count, back at 4  ' });
  assert.equal(s.pauseMessage, 'Stock count, back at 4');
  const s2 = mk(); await run(s2, { message: 'x'.repeat(500) });
  assert.equal(s2.pauseMessage.length, 300);
});
test('PM-03 edit message while on hold does not reopen the store', async () => {
  const s = mk({ isPaused: true, pauseMessage: 'old' }); await run(s, { update: true, message: 'New text' });
  assert.equal(s.isPaused, true); assert.equal(s.pauseMessage, 'New text');
});
test('PM-04 edit with blank message falls back to the default', async () => {
  const s = mk({ isPaused: true, pauseMessage: 'old' }); await run(s, { update: true, message: '' });
  assert.match(s.pauseMessage, /back soon/i);
});
test('PM-05 reopening clears the message', async () => {
  const s = mk({ isPaused: true, pauseMessage: 'x' }); await run(s, {});
  assert.equal(s.isPaused, false); assert.equal(s.pauseMessage, null);
});
test('PM-06 unknown store → 404', async () => {
  const res = await run(null, {}); assert.equal(res.statusCode, 404);
});
