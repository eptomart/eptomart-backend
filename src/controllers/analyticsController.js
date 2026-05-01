// ============================================
// ANALYTICS CONTROLLER
// ============================================
const Analytics = require('../models/Analytics');

/**
 * @route   GET /api/analytics/overview
 * @desc    Get analytics overview
 * @access  Admin
 */
const getOverview = async (req, res) => {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const last7days = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const last30days = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [
    totalVisits,
    uniqueVisitors,
    todayVisits,
    todayUnique,
    topPages,
    deviceStats,
    browserStats,
    dailyTrend,
    topCountries,
    topCities,
    recentVisitors,
  ] = await Promise.all([
    Analytics.countDocuments({ isBot: false }),
    Analytics.distinct('ip', { isBot: false }),
    Analytics.countDocuments({ isBot: false, timestamp: { $gte: today } }),
    Analytics.distinct('ip', { isBot: false, timestamp: { $gte: today } }),
    Analytics.aggregate([
      { $match: { isBot: false, timestamp: { $gte: last30days } } },
      { $group: { _id: '$page', visits: { $sum: 1 } } },
      { $sort: { visits: -1 } },
      { $limit: 10 },
    ]),
    Analytics.aggregate([
      { $match: { isBot: false, timestamp: { $gte: last30days } } },
      { $group: { _id: '$device', count: { $sum: 1 } } },
    ]),
    Analytics.aggregate([
      { $match: { isBot: false, timestamp: { $gte: last30days } } },
      { $group: { _id: '$browser', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 5 },
    ]),
    Analytics.aggregate([
      { $match: { isBot: false, timestamp: { $gte: last7days } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } },
          visits: { $sum: 1 },
          uniqueIps: { $addToSet: '$ip' },
        }
      },
      { $project: { date: '$_id', visits: 1, unique: { $size: '$uniqueIps' } } },
      { $sort: { date: 1 } }
    ]),
    // Top countries (30 days)
    Analytics.aggregate([
      { $match: { isBot: false, timestamp: { $gte: last30days }, country: { $nin: ['', null, 'Local'] } } },
      { $group: { _id: '$country', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]),
    // Top cities (30 days)
    Analytics.aggregate([
      { $match: { isBot: false, timestamp: { $gte: last30days }, city: { $nin: ['', null, 'Local'] } } },
      { $group: { _id: '$city', country: { $first: '$country' }, count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]),
    // Recent unique visitors (last 50)
    Analytics.aggregate([
      { $match: { isBot: false, timestamp: { $gte: last7days } } },
      { $sort: { timestamp: -1 } },
      {
        $group: {
          _id: '$ip',
          lastSeen: { $first: '$timestamp' },
          country: { $first: '$country' },
          city:    { $first: '$city' },
          region:  { $first: '$region' },
          device:  { $first: '$device' },
          browser: { $first: '$browser' },
          page:    { $first: '$page' },
          visits:  { $sum: 1 },
        }
      },
      { $sort: { lastSeen: -1 } },
      { $limit: 50 },
    ]),
  ]);

  res.json({
    success: true,
    analytics: {
      totals: {
        visits: totalVisits,
        uniqueVisitors: uniqueVisitors.length,
        todayVisits,
        todayUnique: todayUnique.length,
      },
      topPages,
      deviceStats,
      browserStats,
      dailyTrend,
      topCountries,
      topCities,
      recentVisitors,
    },
  });
};

/**
 * @route   POST /api/analytics/track
 * @desc    Client-side page tracking
 * @access  Public
 */
const trackPage = async (req, res) => {
  // Tracking is done by middleware, but this endpoint
  // allows custom client-side events
  res.json({ success: true });
};

/**
 * @route   GET /api/analytics/visitors
 * @desc    Paginated visitor log with filters
 * @access  Admin
 * Query params:
 *   from, to  — ISO date range
 *   day       — single day (YYYY-MM-DD)
 *   country   — filter by country
 *   city      — filter by city
 *   page      — filter by URL path (partial match)
 *   device    — mobile | tablet | desktop
 *   isBot     — true | false
 *   ip        — exact IP filter
 *   limit     — default 50
 *   pg        — page number (default 1)
 */
const getVisitorsList = async (req, res) => {
  const {
    from, to, day, country, city, page: pageFilter, device, isBot,
    ip, limit = 50, pg = 1,
  } = req.query;

  const match = {};

  if (day) {
    const d    = new Date(day);
    const next = new Date(d); next.setDate(next.getDate() + 1);
    match.timestamp = { $gte: d, $lt: next };
  } else if (from || to) {
    match.timestamp = {};
    if (from) match.timestamp.$gte = new Date(from);
    if (to)   { const end = new Date(to); end.setHours(23, 59, 59, 999); match.timestamp.$lte = end; }
  }

  if (country) match.country = { $regex: country, $options: 'i' };
  if (city)    match.city    = { $regex: city,    $options: 'i' };
  if (pageFilter) match.page = { $regex: pageFilter, $options: 'i' };
  if (device)  match.device  = device;
  if (ip)      match.ip      = ip;
  if (isBot === 'true')  match.isBot = true;
  else if (isBot === 'false') match.isBot = false;

  const skip = (Number(pg) - 1) * Number(limit);

  const [visitors, total] = await Promise.all([
    Analytics.find(match)
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean(),
    Analytics.countDocuments(match),
  ]);

  // Aggregated stats for the current filter
  const [stats] = await Analytics.aggregate([
    { $match: match },
    { $group: {
        _id: null,
        uniqueIps:      { $addToSet: '$ip' },
        uniqueSessions: { $addToSet: '$sessionId' },
        bots:           { $sum: { $cond: ['$isBot', 1, 0] } },
    }},
  ]).catch(() => [{}]);

  // Top countries/cities for the current filter
  const [topCountries, topCities] = await Promise.all([
    Analytics.aggregate([
      { $match: { ...match, country: { $nin: ['', null, 'Local'] } } },
      { $group: { _id: '$country', count: { $sum: 1 } } },
      { $sort: { count: -1 } }, { $limit: 8 },
    ]).catch(() => []),
    Analytics.aggregate([
      { $match: { ...match, city: { $nin: ['', null, 'Local'] } } },
      { $group: { _id: '$city', country: { $first: '$country' }, count: { $sum: 1 } } },
      { $sort: { count: -1 } }, { $limit: 8 },
    ]).catch(() => []),
  ]);

  res.json({
    success: true,
    visitors,
    total,
    page:  Number(pg),
    pages: Math.ceil(total / Number(limit)),
    stats: {
      uniqueIps:      stats?.uniqueIps?.length      || 0,
      uniqueSessions: stats?.uniqueSessions?.length || 0,
      bots:           stats?.bots                   || 0,
      total,
    },
    topCountries,
    topCities,
  });
};

module.exports = { getOverview, trackPage, getVisitorsList };
