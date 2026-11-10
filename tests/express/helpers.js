// Shared test helpers (no database needed — Mongoose model statics are stubbed).
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
const jwt = require('jsonwebtoken');

// Fake Express res that records status + json body.
function fakeRes() {
  const r = { statusCode: 200, body: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}
// Mongoose-style chain: .select()/.populate()/.sort()/.limit()/.lean() all resolve to `value`.
function chain(value) {
  const c = { then: (res, rej) => Promise.resolve(value).then(res, rej), catch: (f) => Promise.resolve(value).catch(f) };
  for (const m of ['select', 'populate', 'sort', 'limit', 'lean']) c[m] = () => c;
  return c;
}
const sign = (payload) => jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1h' });
module.exports = { fakeRes, chain, sign };
