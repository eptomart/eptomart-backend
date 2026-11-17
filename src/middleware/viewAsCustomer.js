// Super Admin "View as customer".
// With header `x-view-as-user: <customerId>` a super admin is served exactly
// what that customer would get on the customer screens (cart, wallet, orders,
// checkout data, saved addresses). Applied inside `protect` (see auth.js) so
// every customer route works without being edited one by one.
//   • Header absent → nothing changes for anyone.
//   • Header from a non-super-admin → 403.
//   • Only customer URLs honour it (never admin / seller / other portals).
//   • Payment & order-placement endpoints are refused while viewing.
// Nothing here writes anything the customer can see (no notifications).
const User = require('../models/User');

const CUSTOMER_PATH = /^\/api\/(koyambedu\/(?!admin|seller|seller-admin)|auth\/(me$|add-address$|address\/)|coupon\/validate)/i;

// Payment / order placement — never allowed while viewing as someone else.
const PAYMENT_PATH = [
  { m: 'POST', re: /^\/api\/koyambedu\/orders\/?$/i },
  { m: 'POST', re: /^\/api\/koyambedu\/orders\/(create-razorpay|verify-payment|test-payment)\/?$/i },
  { m: 'POST', re: /^\/api\/koyambedu\/orders\/[^/]+\/amend\/(checkout|verify)\/?$/i },
  { m: 'POST', re: /^\/api\/koyambedu\/orders\/[^/]+\/address\/(confirm|verify)\/?$/i },
];

const pathOf = (req) => String(req.originalUrl || req.url || '').split('?')[0];
const isPayment = (req) => PAYMENT_PATH.some(p => p.m === String(req.method || '').toUpperCase() && p.re.test(pathOf(req)));

/** Returns null (continue) or { status, message }. Mutates req on success. */
async function applyViewAs(req) {
  const id = req.headers?.['x-view-as-user'];
  if (!id) return null;
  if (req.user?.role !== 'superAdmin') return { status: 403, message: 'Super Admin access required' };
  if (!CUSTOMER_PATH.test(pathOf(req))) return null;          // not a customer screen → ignore header
  if (!/^[a-f\d]{24}$/i.test(String(id))) return { status: 400, message: 'Invalid customer' };
  if (isPayment(req)) return { status: 403, message: 'Payment is disabled while viewing as a customer' };
  const target = await User.findById(id).select('-password');
  if (!target) return { status: 404, message: 'Customer not found' };
  if (['admin', 'superAdmin'].includes(target.role)) return { status: 400, message: 'Cannot view an admin account as a customer' };
  req.actingAdmin = req.user;
  req.user = target;
  return null;
}

async function viewAsCustomer(req, res, next) {
  try {
    const err = await applyViewAs(req);
    if (err) return res.status(err.status).json({ success: false, message: err.message });
    next();
  } catch (e) {
    console.error('[viewAsCustomer] error:', e.message);
    res.status(500).json({ success: false, message: 'Could not open customer view' });
  }
}

module.exports = viewAsCustomer;
module.exports.applyViewAs = applyViewAs;
module.exports.isPayment = isPayment;
