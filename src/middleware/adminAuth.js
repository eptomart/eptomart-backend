// ============================================
// ADMIN AUTH MIDDLEWARE — Role-Based Access Control
// Roles:  superAdmin > admin > seller > user
//
// superAdmin: full system access, can create sellers/admins
// admin:      view & confirm orders, coordinate with sellers ONLY
//             (no analytics, no product management, no user management)
// ============================================
const { protect } = require('./auth');

/**
 * Admin or SuperAdmin — both can enter the admin panel
 * Regular admin is further restricted per-route or per-controller
 */
const adminOnly = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'Not authenticated' });
  }
  if (!['admin', 'superAdmin'].includes(req.user.role)) {
    return res.status(403).json({ success: false, message: 'Admin access required' });
  }
  next();
};

/**
 * Super Admin only — full system access
 */
const superAdminOnly = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'Not authenticated' });
  }
  if (req.user.role !== 'superAdmin') {
    return res.status(403).json({ success: false, message: 'Super Admin access required' });
  }
  next();
};

/**
 * Combined shorthand: protect + adminOnly
 */
const protectAdmin      = [protect, adminOnly];
const protectSuperAdmin = [protect, superAdminOnly];

module.exports = { adminOnly, superAdminOnly, protectAdmin, protectSuperAdmin };
