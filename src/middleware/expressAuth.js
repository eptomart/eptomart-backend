// ============================================
// EPTOMART EXPRESS — Manager/POS Auth Middleware
// Deliberately separate from the main app's `protect` middleware (auth.js)
// — Express staff tokens carry a `type` claim ('expressManager' or
// 'expressPOS') that the main app's User-based middleware never sets, so a
// token minted here can never be mistaken for (or reused as) a customer,
// seller, or admin session, and vice versa.
// ============================================
const jwt = require('jsonwebtoken');
const ExpressStoreManager = require('../models/ExpressStoreManager');
const ExpressPOSUser = require('../models/ExpressPOSUser');
const User = require('../models/User');

const protectExpressManager = async (req, res, next) => {
  const token = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.split(' ')[1]
    : null;
  if (!token) return res.status(401).json({ success: false, message: 'Access denied. Please log in.' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Normal Eptomart login (token has no `type`): allowed only if this user
    // has been assigned as a store's owner by admin.
    if (!decoded.type) {
      const user = await User.findById(decoded.id).select('_id isActive');
      if (!user || user.isActive === false) return res.status(401).json({ success: false, message: 'Invalid session' });
      const owned = await ExpressStoreManager.findOne({ user: user._id }).select('-password');
      if (!owned) return res.status(403).json({ success: false, message: 'You are not a store owner' });
      if (!owned.isActive) return res.status(403).json({ success: false, message: 'Store access suspended. Contact Admin.' });
      req.manager = owned;
      return next();
    }

    if (decoded.type !== 'expressManager') return res.status(401).json({ success: false, message: 'Invalid session' });

    const manager = await ExpressStoreManager.findById(decoded.id).select('-password');
    if (!manager) return res.status(401).json({ success: false, message: 'Account not found' });
    if (!manager.isActive) return res.status(401).json({ success: false, message: 'Account suspended. Contact Admin.' });

    req.manager = manager;
    next();
  } catch (_) {
    return res.status(401).json({ success: false, message: 'Invalid or expired session' });
  }
};

const protectExpressPOS = async (req, res, next) => {
  const token = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.split(' ')[1]
    : null;
  if (!token) return res.status(401).json({ success: false, message: 'Access denied. Please log in.' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.type !== 'expressPOS') return res.status(401).json({ success: false, message: 'Invalid session' });

    const posUser = await ExpressPOSUser.findById(decoded.id).select('-pin');
    if (!posUser) return res.status(401).json({ success: false, message: 'Account not found' });
    if (!posUser.isActive) return res.status(401).json({ success: false, message: 'Account suspended. Contact Admin.' });

    req.posUser = posUser;
    // Session boundary — bills created before this login are invisible to
    // the POS user (spec section 6: "only see bills created during their
    // current session"), even though the underlying data isn't deleted.
    req.posSessionAt = decoded.sessionAt ? new Date(decoded.sessionAt) : new Date(0);
    next();
  } catch (_) {
    return res.status(401).json({ success: false, message: 'Invalid or expired session' });
  }
};

module.exports = { protectExpressManager, protectExpressPOS };
