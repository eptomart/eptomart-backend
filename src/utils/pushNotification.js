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
  webPush.setVapidDetails(
    process.env.VAPID_EMAIL || 'mailto:admin@eptomart.com',
    process.env.VAPID_PUBLIC_KEY || '',
    process.env.VAPID_PRIVATE_KEY || ''
  );
} catch {
  console.warn('⚠️ web-push not installed. Run: npm install web-push');
}

const PushSubscription = require('../models/PushSubscription');

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
 * Send notification to a specific user
 */
const notifyUser = async (userId, payload) => {
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

module.exports = { sendPush, notifyUser, notifyAll, notifications };
