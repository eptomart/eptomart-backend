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
      const user = await User.findById(decoded.id).select('_id name role permissions isActive');
      if (!user || user.isActive === false) return res.status(401).json({ success: false, message: 'Invalid session' });

      // Super admin (or an admin with the Express permission) can open ANY
      // store's owner dashboard by sending x-express-store-id — they see and
      // can do exactly what that store's owner can.
      const actAs = req.headers['x-express-store-id'];
      const isExpressAdmin = user.role === 'superAdmin' || (user.role === 'admin' && (user.permissions || []).includes('express'));
      if (actAs && isExpressAdmin) {
        if (!/^[a-f\d]{24}$/i.test(String(actAs))) return res.status(400).json({ success: false, message: 'Invalid store id' });
        req.manager = { _id: user._id, name: `${user.name || 'Admin'} (Admin)`, store: actAs, role: 'owner', isAdmin: true, isActive: true };
        req.managerRole = 'owner';
        return next();
      }
      // A person may hold more than one store record (e.g. owner AND added as
      // manager) — always prefer the owner record, then manager, then accountant.
      const owned = await ExpressStoreManager.findOne({ user: user._id }).sort({ role: -1 }).select('-password');
      if (!owned) return res.status(403).json({ success: false, message: 'You are not a store owner' });
      if (!owned.isActive) return res.status(403).json({ success: false, message: 'Store access suspended. Contact Admin.' });
      req.manager = owned;
      req.managerRole = owned.role || 'owner';
      return next();
    }

    if (decoded.type !== 'expressManager') return res.status(401).json({ success: false, message: 'Invalid session' });

    const manager = await ExpressStoreManager.findById(decoded.id).select('-password');
    if (!manager) return res.status(401).json({ success: false, message: 'Account not found' });
    if (!manager.isActive) return res.status(401).json({ success: false, message: 'Account suspended. Contact Admin.' });

    req.manager = manager;
    req.managerRole = manager.role || 'owner';
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

// Role gate — use AFTER protectExpressManager. A record with no role is an owner.
const requireExpressRole = (...roles) => (req, res, next) => {
  const role = req.managerRole || req.manager?.role || 'owner';
  if (!roles.includes(role)) {
    return res.status(403).json({ success: false, message: `Your role (${role}) cannot do this` });
  }
  next();
};

module.exports = { protectExpressManager, protectExpressPOS, requireExpressRole };
