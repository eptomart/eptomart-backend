// ============================================
// ACTIVITY LOG CONTROLLER
// ============================================
const ActivityLog = require('../models/ActivityLog');

/**
 * @route   GET /api/activity
 * @desc    Get activity logs with pagination and filters
 * @access  SuperAdmin
 */
const getLogs = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 50,
      entity = '',
      actor = '',
      startDate = '',
      endDate = '',
    } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const query = {};

    if (entity) query.entity = entity;
    if (actor) query.actor = actor;

    // Date range filter
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        query.createdAt.$lte = end;
      }
    }

    const [logs, total] = await Promise.all([
      ActivityLog.find(query)
        .populate('actor', 'name email role')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      ActivityLog.countDocuments(query),
    ]);

    const totalPages = Math.ceil(total / parseInt(limit));

    res.json({
      success: true,
      logs,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages,
      },
    });
  } catch (err) {
    console.error('[ActivityLog] Error fetching logs:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch activity logs' });
  }
};

module.exports = { getLogs };
