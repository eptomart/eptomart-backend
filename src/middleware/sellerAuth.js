const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Seller = require('../models/Seller');

const sellerAuth = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ success: false, message: 'No token provided' });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select('-password');
    if (!user || !user.isActive) {
      return res.status(401).json({ success: false, message: 'User not found or inactive' });
    }

    // Admin can access all seller routes
    if (user.role === 'admin') {
      req.user = user;
      return next();
    }

    if (user.role !== 'seller') {
      return res.status(403).json({ success: false, message: 'Seller access required' });
    }

    const seller = await Seller.findOne({ user: user._id });
    if (!seller) {
      return res.status(403).json({ success: false, message: 'Seller profile not found' });
    }
    if (seller.status !== 'active') {
      return res.status(403).json({
        success: false,
        message: `Seller account is ${seller.status}. Contact admin.`,
      });
    }

    req.user   = user;
    req.seller = seller;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid token' });
  }
};

module.exports = sellerAuth;
