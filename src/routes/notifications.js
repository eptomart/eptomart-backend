// ============================================
// PUSH NOTIFICATION ROUTES
// ============================================
const express = require('express');
const router = express.Router();
const PushSubscription = require('../models/PushSubscription');
const { notifyUser, notifyAll, notifications } = require('../utils/pushNotification');
const { protect } = require('../middleware/auth');
const { protectAdmin } = require('../middleware/adminAuth');

/**
 * @route   POST /api/notifications/subscribe
 * @desc    Save push subscription
 * @access  Public (works for guests too)
 */
router.post('/subscribe', async (req, res) => {
  const { subscription } = req.body;
  if (!subscription?.endpoint) {
    return res.status(400).json({ success: false, message: 'Invalid subscription' });
  }

  // Upsert: update if exists, create if not
  await PushSubscription.findOneAndUpdate(
    { endpoint: subscription.endpoint },
    {
      endpoint: subscription.endpoint,
      keys: subscription.keys,
      user: req.user?._id || null,
      userAgent: req.headers['user-agent']?.substring(0, 200),
      isActive: true,
      lastUsed: new Date(),
    },
    { upsert: true, new: true }
  );

  res.json({ success: true, message: 'Subscribed to notifications' });
});

/**
 * @route   DELETE /api/notifications/unsubscribe
 * @desc    Remove push subscription
 * @access  Public
 */
router.delete('/unsubscribe', async (req, res) => {
  const { endpoint } = req.body;
  await PushSubscription.findOneAndUpdate({ endpoint }, { isActive: false });
  res.json({ success: true, message: 'Unsubscribed' });
});

/**
 * @route   GET /api/notifications/vapid-key
 * @desc    Get VAPID public key for client subscription
 * @access  Public
 */
router.get('/vapid-key', (req, res) => {
  res.json({
    success: true,
    publicKey: process.env.VAPID_PUBLIC_KEY || null,
  });
});

/**
 * @route   GET /api/notifications/stats
 * @desc    Get subscriber stats for admin
 * @access  Admin
 */
router.get('/stats', protectAdmin, async (req, res) => {
  const [totalSubscribers, activeSubscribers] = await Promise.all([
    PushSubscription.countDocuments(),
    PushSubscription.countDocuments({ isActive: true }),
  ]);

  // Count notifications broadcast today (approximation via a simple counter or just return 0 if not tracked)
  res.json({
    success: true,
    totalSubscribers,
    activeSubscribers,
    sentToday: 0, // Can be enhanced with a BroadcastLog model later
  });
});

/**
 * @route   POST /api/notifications/send-to-user
 * @desc    Admin sends notification to a specific user
 * @access  Admin
 */
router.post('/send-to-user', protectAdmin, async (req, res) => {
  const { userId, title, body, url } = req.body;
  const results = await notifyUser(userId, { title, body, icon: '/icons/icon-192x192.png', url: url || '/', tag: 'admin' });
  res.json({ success: true, results });
});

/**
 * @route   POST /api/notifications/broadcast
 * @desc    Admin broadcasts to all subscribers
 * @access  Admin
 */
router.post('/broadcast', protectAdmin, async (req, res) => {
  const { title, body, url } = req.body;
  const result = await notifyAll({ title, body, icon: '/icons/icon-192x192.png', url: url || '/', tag: 'broadcast' });
  res.json({ success: true, ...result });
});

module.exports = router;
