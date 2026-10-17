// ============================================
// EPTOMART EXPRESS — POS User Login
// Username + PIN login (short, counter-friendly), separate token namespace
// from customers/managers/admin (see middleware/expressAuth.js). The token
// embeds a `sessionAt` timestamp used to scope "my bills" to only what was
// created since this login (spec section 6).
// ============================================
const jwt = require('jsonwebtoken');
const ExpressPOSUser = require('../models/ExpressPOSUser');

const normalizePhone = (v) => String(v || '').replace(/\D/g, '').slice(-10);

const login = async (req, res) => {
  try {
    // Accepts the assigned mobile number OR the username, plus the PIN
    const identifier = String(req.body.identifier || req.body.phone || req.body.username || '').trim();
    const { pin } = req.body;
    if (!identifier || !pin) return res.status(400).json({ success: false, message: 'Mobile number and PIN are required' });

    const digits = normalizePhone(identifier);
    const looksLikePhone = /^\+?[\d\s-]{10,15}$/.test(identifier) && digits.length === 10;
    const query = looksLikePhone ? { $or: [{ phone: digits }, { username: identifier.toLowerCase() }] } : { username: identifier.toLowerCase() };
    const posUser = await ExpressPOSUser.findOne(query).select('+pin').populate('store', 'name code address city isActive');
    if (!posUser) return res.status(401).json({ success: false, message: 'Invalid mobile number or PIN' });
    if (!posUser.isActive) return res.status(403).json({ success: false, message: 'Your account has been suspended. Contact Admin.' });
    if (posUser.store && posUser.store.isActive === false) return res.status(403).json({ success: false, message: 'Your store is currently switched off. Contact Admin.' });

    const valid = await posUser.comparePin(pin);
    if (!valid) return res.status(401).json({ success: false, message: 'Invalid mobile number or PIN' });

    posUser.lastLogin = new Date();
    await posUser.save();

    const sessionAt = Date.now();
    const token = jwt.sign({ id: posUser._id, type: 'expressPOS', sessionAt }, process.env.JWT_SECRET, { expiresIn: '12h' });

    const safe = posUser.toObject(); delete safe.pin;
    res.json({ success: true, token, posUser: safe });
  } catch (err) {
    console.error('[expressPOSAuth.login]', err);
    res.status(500).json({ success: false, message: 'Login failed' });
  }
};

const me = async (req, res) => {
  const posUser = await ExpressPOSUser.findById(req.posUser._id).populate('store', 'name code address city isActive').select('-pin');
  res.json({ success: true, posUser });
};

module.exports = { login, me };
