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

module.exports = { getOverview, trackPage };
