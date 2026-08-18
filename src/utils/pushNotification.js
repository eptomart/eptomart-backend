// ============================================
// PUSH NOTIFICATION UTILITY
// Uses Web Push Protocol (Free - no 3rd party)
// Setup: npm install web-push
//
// Generate VAPID keys (run once):
// node -e "const wp=require('web-push');const keys=wp.generateVAPIDKeys();console.log(keys)"
// Add to .env:
//   VAPID_PUBLIC_KEY=...
//   VAPID_PRIVATE_KEY=...
//   VAPID_EMAIL=mailto:admin@eptomart.com
// ============================================

let webPush;
try {
  webPush = require('web-push');
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    webPush.setVapidDetails(
      process.env.VAPID_EMAIL || 'mailto:admin@eptomart.com',
      process.env.VAPID_PUBLIC_KEY,
      process.env.VAPID_PRIVATE_KEY
    );
  } else {
    console.log('ℹ️  Push notifications disabled — VAPID keys not set (optional feature)');
  }
} catch (err) {
  console.warn('⚠️ web-push error:', err.message);
}

const PushSubscription = require('../models/PushSubscription');
const Notification     = require('../models/Notification');

/**
 * Send push notification to a specific subscription
 */
const sendPush = async (subscription, payload) => {
  if (!webPush) return { success: false, error: 'web-push not configured' };

  try {
    await webPush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: subscription.keys,
      },
      JSON.stringify(payload)
    );
    return { success: true };
  } catch (error) {
    // 410 = subscription expired/unsubscribed
    if (error.statusCode === 410) {
      await PushSubscription.findByIdAndUpdate(subscription._id, { isActive: false });
    }
    return { success: false, error: error.message };
  }
};

/**
 * Send notification to a specific user (web push + in-app DB record)
 */
const notifyUser = async (userId, payload) => {
  if (!userId) return [];

  // 1. Persist in-app notification to DB
  try {
    await Notification.create({
      user:  userId,
      title: payload.title,
      body:  payload.body,
      url:   payload.url || '/',
      tag:   payload.tag  || null,
    });
  } catch (e) {
    console.warn('[Notify] DB save failed:', e.message);
  }

  // 2. Send web push (best effort)
  const subscriptions = await PushSubscription.find({ user: userId, isActive: true });
  const results = await Promise.all(subscriptions.map(sub => sendPush(sub, payload)));
  return results;
};

/**
 * Send notification to all active subscribers
 */
const notifyAll = async (payload) => {
  const subscriptions = await PushSubscription.find({ isActive: true }).limit(500);
  const results = await Promise.all(subscriptions.map(sub => sendPush(sub, payload)));
  return { sent: results.filter(r => r.success).length, total: results.length };
};

/**
 * Send notification to active subscribers belonging to a specific set of
 * user IDs (targeted/segmented broadcast — e.g. "Koyambedu Daily customers
 * in a given area", as opposed to notifyAll's site-wide blast).
 * Sent in chunks so a very large audience doesn't open thousands of
 * concurrent HTTPS requests at once.
 */
const notifyAudience = async (userIds, payload, { chunkSize = 200 } = {}) => {
  if (!userIds || !userIds.length) return { sent: 0, total: 0 };
  const subscriptions = await PushSubscription.find({
    user: { $in: userIds },
    isActive: true,
  });
  let sent = 0;
  for (let i = 0; i < subscriptions.length; i += chunkSize) {
    const batch = subscriptions.slice(i, i + chunkSize);
    const results = await Promise.all(batch.map(sub => sendPush(sub, payload)));
    sent += results.filter(r => r.success).length;
  }
  return { sent, total: subscriptions.length };
};

// ─── Pre-built Notification Templates ────────

const notifications = {
  orderPlaced: (orderId) => ({
    title: '✅ Order Confirmed!',
    body: `Your order #${orderId} has been placed successfully.`,
    icon: '/icons/icon-192x192.png',
    badge: '/icons/icon-72x72.png',
    url: '/orders',
    tag: `order-${orderId}`,
  }),

  orderShipped: (orderId) => ({
    title: '📦 Order Shipped!',
    body: `Your order #${orderId} is on its way!`,
    icon: '/icons/icon-192x192.png',
    url: '/orders',
    tag: `order-${orderId}`,
  }),

  orderDelivered: (orderId) => ({
    title: '🎉 Order Delivered!',
    body: `Your order #${orderId} has been delivered. Enjoy!`,
    icon: '/icons/icon-192x192.png',
    url: '/orders',
    tag: `order-${orderId}`,
  }),

  newDeal: (productName, discount) => ({
    title: `🔥 ${discount}% OFF Today Only!`,
    body: `Grab ${productName} at a huge discount. Limited stock!`,
    icon: '/icons/icon-192x192.png',
    url: '/shop',
    tag: 'deal',
  }),

  welcome: (name) => ({
    title: `Welcome to Eptomart, ${name}! 🛒`,
    body: 'Start shopping and enjoy free delivery on your first order!',
    icon: '/icons/icon-192x192.png',
    url: '/',
    tag: 'welcome',
  }),
};

module.exports = { sendPush, notifyUser, notifyAll, notifyAudience, notifications };
