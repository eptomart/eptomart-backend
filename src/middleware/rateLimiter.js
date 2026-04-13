// ============================================
// RATE LIMITER MIDDLEWARE
// ============================================
const rateLimit = require('express-rate-limit');

// General API rate limiter
const rateLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX) || 100,
  message: {
    success: false,
    message: 'Too many requests from this IP. Please try again later.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Strict limiter for auth endpoints (prevent OTP spam)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Max 10 OTP requests per 15 mins
  message: {
    success: false,
    message: 'Too many login attempts. Please wait 15 minutes.',
  },
});

// Very strict for OTP send
const otpSendLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  message: {
    success: false,
    message: 'Too many OTP requests. Please try again after an hour.',
  },
});

module.exports = { rateLimiter, authLimiter, otpSendLimiter };
