// ============================================
// ADMIN AUTH MIDDLEWARE
// ============================================
const { protect } = require('./auth');

/**
 * Ensure user is admin
 * Must be used AFTER protect middleware
 */
const adminOnly = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'Not authenticated' });
  }

  if (req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Admin access required',
    });
  }

  next();
};

/**
 * Combined: protect + adminOnly
 */
const protectAdmin = [protect, adminOnly];

module.exports = { adminOnly, protectAdmin };
