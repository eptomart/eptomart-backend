// ============================================
// JWT TOKEN UTILITIES
// ============================================
const jwt = require('jsonwebtoken');

/**
 * Generate JWT token for a user
 */
const generateToken = (userId, role = 'user') => {
  return jwt.sign(
    { id: userId, role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRE || '30d' }  // 30-day persistent sessions
  );
};

/**
 * Send JWT as HTTP-only cookie + JSON response
 */
const sendTokenResponse = (user, statusCode, res, message = 'Success', extraData = {}) => {
  const token = generateToken(user._id, user.role);

  const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days — matches JWT expiry
  };

  res.status(statusCode)
    .cookie('token', token, cookieOptions)
    .json({
      success: true,
      message,
      token, // Also send in body for mobile apps
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        avatar: user.avatar,
        isVerified: user.isVerified,
        addresses: user.addresses || [],
      },
      ...extraData,
    });
};

module.exports = { generateToken, sendTokenResponse };
