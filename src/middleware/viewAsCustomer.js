// Super Admin "View as customer". Place AFTER `protect`, on selected customer
// routes only (cart, wallet, my-orders). With header `x-view-as-user: <id>` a
// super admin is served exactly what that customer would get. Anyone else
// sending the header is refused. Without the header: no effect at all.
const User = require('../models/User');

module.exports = async function viewAsCustomer(req, res, next) {
  const id = req.headers['x-view-as-user'];
  if (!id) return next();
  try {
    if (req.user?.role !== 'superAdmin') {
      return res.status(403).json({ success: false, message: 'Super Admin access required' });
    }
    if (!/^[a-f\d]{24}$/i.test(String(id))) {
      return res.status(400).json({ success: false, message: 'Invalid customer' });
    }
    const target = await User.findById(id).select('-password');
    if (!target) return res.status(404).json({ success: false, message: 'Customer not found' });
    if (['admin', 'superAdmin'].includes(target.role)) {
      return res.status(400).json({ success: false, message: 'Cannot view an admin account as a customer' });
    }
    req.actingAdmin = req.user;
    req.user = target;
    next();
  } catch (err) {
    console.error('[viewAsCustomer] error:', err.message);
    res.status(500).json({ success: false, message: 'Could not open customer view' });
  }
};
