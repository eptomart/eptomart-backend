// ============================================
// EPTOMART EXPRESS — POS User Login
// Username + PIN login (short, counter-friendly), separate token namespace
// from customers/managers/admin (see middleware/expressAuth.js). The token
// embeds a `sessionAt` timestamp used to scope "my bills" to only what was
// created since this login (spec section 6).
// ============================================
const jwt = require('jsonwebtoken');
const ExpressPOSUser = require('../models/ExpressPOSUser');

const login = async (req, res) => {
  try {
    const { username, pin } = req.body;
    if (!username || !pin) return res.status(400).json({ success: false, message: 'Username and PIN are required' });

    const posUser = await ExpressPOSUser.findOne({ username: username.toLowerCase() }).select('+pin').populate('store', 'name code isActive');
    if (!posUser) return res.status(401).json({ success: false, message: 'Invalid username or PIN' });
    if (!posUser.isActive) return res.status(403).json({ success: false, message: 'Your account has been suspended. Contact Admin.' });

    const valid = await posUser.comparePin(pin);
    if (!valid) return res.status(401).json({ success: false, message: 'Invalid username or PIN' });

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
  const posUser = await ExpressPOSUser.findById(req.posUser._id).populate('store', 'name code isActive').select('-pin');
  res.json({ success: true, posUser });
};

module.exports = { login, me };
