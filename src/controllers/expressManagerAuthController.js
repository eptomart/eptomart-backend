// ============================================
// EPTOMART EXPRESS — Store Manager Login
// Simple phone + password login, separate token namespace from the main
// app (see middleware/expressAuth.js for why). No OTP flow — Store
// Managers are provisioned by Admin with a password directly, same as how
// admin/seller accounts work elsewhere in the codebase.
// ============================================
const jwt = require('jsonwebtoken');
const ExpressStoreManager = require('../models/ExpressStoreManager');

const signManagerToken = (managerId) =>
  jwt.sign({ id: managerId, type: 'expressManager' }, process.env.JWT_SECRET, { expiresIn: '30d' });

const login = async (req, res) => {
  try {
    const { phone, password } = req.body;
    if (!phone || !password) return res.status(400).json({ success: false, message: 'Phone and password are required' });

    const manager = await ExpressStoreManager.findOne({ phone }).select('+password').populate('store', 'name code isActive');
    if (!manager) return res.status(401).json({ success: false, message: 'Invalid phone or password' });
    if (!manager.isActive) return res.status(403).json({ success: false, message: 'Your account has been suspended. Contact Admin.' });

    const valid = await manager.comparePassword(password);
    if (!valid) return res.status(401).json({ success: false, message: 'Invalid phone or password' });

    manager.lastLogin = new Date();
    await manager.save();

    const token = signManagerToken(manager._id);
    const safe = manager.toObject(); delete safe.password;
    res.json({ success: true, token, manager: safe });
  } catch (err) {
    console.error('[expressManagerAuth.login]', err);
    res.status(500).json({ success: false, message: 'Login failed' });
  }
};

const me = async (req, res) => {
  const manager = await ExpressStoreManager.findById(req.manager._id).populate('store', 'name code isActive').select('-password');
  res.json({ success: true, manager });
};

module.exports = { login, me };
