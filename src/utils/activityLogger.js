// ============================================
// ACTIVITY LOGGER UTILITY — Fire-and-forget logging
// ============================================
const ActivityLog = require('../models/ActivityLog');

/**
 * Log an activity (non-blocking, fire-and-forget)
 * @param {Express.Request} req - Express request object
 * @param {String} action - Action string e.g. 'order.status_updated'
 * @param {String} entity - Entity type e.g. 'order'
 * @param {String} entityId - The ID of the affected document
 * @param {String} entityLabel - Human-readable label e.g. "Order #EPT12345"
 * @param {Object} details - Any extra data { from, to, note }
 */
const logActivity = (req, action, entity, entityId, entityLabel, details = {}) => {
  try {
    // Non-blocking: fire-and-forget with no await
    (async () => {
      try {
        const actor = req.user;
        if (!actor) return; // No user in request, skip logging

        await ActivityLog.create({
          actor: actor._id,
          actorName: actor.name || 'Unknown',
          actorRole: actor.role || 'user',
          action,
          entity,
          entityId: String(entityId),
          entityLabel,
          details,
          ip: req.ip || req.connection.remoteAddress || 'unknown',
        });
      } catch (err) {
        // Silently fail — logging must not block operations
        console.error('[ActivityLog] Failed to log activity:', err.message);
      }
    })();
  } catch (err) {
    // Outer try-catch for safety
    console.error('[ActivityLog] Unexpected error:', err.message);
  }
};

module.exports = { logActivity };
