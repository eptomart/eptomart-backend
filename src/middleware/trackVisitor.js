// ============================================
// VISITOR TRACKING MIDDLEWARE
// ============================================
const Analytics = require('../models/Analytics');
const { parseUserAgent, getClientIp } = require('../utils/generateOtp');
const { v4: uuidv4 } = require('uuid');

// Bot detection patterns
const BOT_PATTERNS = /bot|crawler|spider|googlebot|bingbot|slurp|duckduckbot|baidu|yandex|semrush|ahrefsbot/i;

const trackVisitor = async (req, res, next) => {
  // Only track GET requests to non-static routes
  if (req.method !== 'GET') return next();
  if (req.path === '/health') return next();

  try {
    const ip = getClientIp(req);
    const userAgent = req.headers['user-agent'] || '';
    const isBot = BOT_PATTERNS.test(userAgent);

    // Get or create session ID from header
    let sessionId = req.headers['x-session-id'];
    if (!sessionId) {
      sessionId = uuidv4();
      res.setHeader('x-session-id', sessionId);
    }

    const { browser, os, device } = parseUserAgent(userAgent);

    // Save async, don't block request
    Analytics.create({
      sessionId,
      ip,
      page: req.path,
      referrer: req.headers.referer || '',
      userAgent: userAgent.substring(0, 200),
      browser,
      os,
      device,
      isBot,
      userId: req.user?._id || null,
      timestamp: new Date(),
    }).catch(() => {}); // Silently fail - don't break the request

  } catch (_) {
    // Never break the main request due to analytics
  }

  next();
};

module.exports = { trackVisitor };
