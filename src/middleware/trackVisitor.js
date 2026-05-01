// ============================================
// VISITOR TRACKING MIDDLEWARE
// + IP Geolocation via ip-api.com (free, no key, 45 req/min)
// ============================================
const https = require('https');
const http  = require('http');
const Analytics = require('../models/Analytics');
const { parseUserAgent, getClientIp } = require('../utils/generateOtp');
const { v4: uuidv4 } = require('uuid');

// Bot detection patterns
const BOT_PATTERNS = /bot|crawler|spider|googlebot|bingbot|slurp|duckduckbot|baidu|yandex|semrush|ahrefsbot/i;

// ── Simple in-memory geo cache (IP → geo) ─────────────────────────────────
// Avoids hitting ip-api.com for the same IP on every request.
// Entries expire after 24 hours. Max 2000 entries (LRU-style trim).
const geoCache = new Map(); // ip → { country, city, region, expiresAt }
const GEO_TTL  = 24 * 60 * 60 * 1000; // 24 h
const GEO_MAX  = 2000;
const PRIVATE_IP = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1|localhost)/;

function getGeo(ip) {
  if (!ip || PRIVATE_IP.test(ip)) {
    return Promise.resolve({ country: 'Local', city: 'Local', region: 'Local' });
  }
  const cached = geoCache.get(ip);
  if (cached && cached.expiresAt > Date.now()) {
    return Promise.resolve(cached);
  }
  return new Promise(resolve => {
    const timeout = setTimeout(() => resolve({}), 3000); // 3 s timeout
    http.get(`http://ip-api.com/json/${ip}?fields=status,country,regionName,city`, (res) => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        clearTimeout(timeout);
        try {
          const d = JSON.parse(raw);
          if (d.status === 'success') {
            const geo = { country: d.country || '', city: d.city || '', region: d.regionName || '', expiresAt: Date.now() + GEO_TTL };
            if (geoCache.size >= GEO_MAX) {
              // Trim oldest 10 %
              const keys = [...geoCache.keys()].slice(0, Math.floor(GEO_MAX * 0.1));
              keys.forEach(k => geoCache.delete(k));
            }
            geoCache.set(ip, geo);
            resolve(geo);
          } else {
            resolve({});
          }
        } catch (_) { resolve({}); }
      });
    }).on('error', () => { clearTimeout(timeout); resolve({}); });
  });
}

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

    // Geo lookup + save — fully async, never blocks the request
    getGeo(ip).then(geo => {
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
        country: geo.country || '',
        city:    geo.city    || '',
        region:  geo.region  || '',
        timestamp: new Date(),
      }).catch(() => {});
    }).catch(() => {});

  } catch (_) {
    // Never break the main request due to analytics
  }

  next();
};

module.exports = { trackVisitor };
