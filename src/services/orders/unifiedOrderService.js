// ============================================
// UNIFIED ORDER SERVICE
// One read layer over every vertical's orders.
// Verticals are discovered from the registry —
// adding a vertical requires only a registry
// entry + an adapter file, nothing else.
// ============================================
'use strict';

const { VERTICALS, listVerticals } = require('../../config/verticals');

const ADAPTERS = {
  eptomart:  require('./adapters/eptomartAdapter'),
  koyambedu: require('./adapters/koyambeduAdapter'),
  eptofresh: require('./adapters/eptofreshAdapter'),
  uzhavar:   require('./adapters/uzhavarAdapter'),
};

function getAdapter(verticalKey) {
  return ADAPTERS[verticalKey] || null;
}

/**
 * Merged, chronologically sorted order cards across verticals.
 * @param {ObjectId} userId
 * @param {Object} opts { vertical: 'all'|key, page, limit }
 */
async function listOrders(userId, { vertical = 'all', page = 1, limit = 20 } = {}) {
  page  = Math.max(1, parseInt(page) || 1);
  limit = Math.min(50, Math.max(1, parseInt(limit) || 20));

  const keys = vertical === 'all'
    ? Object.keys(ADAPTERS).filter(k => VERTICALS[k])
    : [vertical];

  if (vertical !== 'all' && !ADAPTERS[vertical]) {
    const err = new Error(`Unknown vertical: ${vertical}`);
    err.status = 400;
    throw err;
  }

  // Fetch enough from each vertical to fill the requested page, then merge.
  const fetchLimit = page * limit;
  const results = await Promise.allSettled(
    keys.map(k => ADAPTERS[k].fetchList(userId, { limit: fetchLimit })
      .then(docs => docs.map(d => ADAPTERS[k].toCard(d)))),
  );

  const failed = [];
  let cards = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') cards = cards.concat(r.value);
    else {
      failed.push(keys[i]);
      console.error(`unifiedOrderService.listOrders [${keys[i]}]:`, r.reason?.message);
    }
  });

  cards.sort((a, b) => new Date(b.placedAt || 0) - new Date(a.placedAt || 0));

  const start = (page - 1) * limit;
  const pageCards = cards.slice(start, start + limit);
  // hasMore is a heuristic: true if we filled the page and any vertical returned fetchLimit docs
  const hasMore = cards.length > start + limit;

  return { orders: pageCards, page, limit, hasMore, failedVerticals: failed };
}

/**
 * Full canonical detail DTO for one order.
 */
async function getOrderDetail(userId, verticalKey, id) {
  const adapter = getAdapter(verticalKey);
  if (!adapter) {
    const err = new Error(`Unknown vertical: ${verticalKey}`);
    err.status = 400;
    throw err;
  }

  const doc = await adapter.fetchOne(userId, id);
  if (!doc) {
    const err = new Error('Order not found');
    err.status = 404;
    throw err;
  }

  let walletHistory = [];
  if (typeof adapter.fetchWalletHistory === 'function') {
    try {
      walletHistory = await adapter.fetchWalletHistory(userId, doc);
    } catch (e) {
      console.error(`fetchWalletHistory [${verticalKey}]:`, e.message);
    }
  }

  return adapter.toDetail(doc, { walletHistory });
}

/** Tab configuration for the unified My Orders page. */
function getVerticalTabs() {
  return listVerticals();
}

module.exports = { listOrders, getOrderDetail, getVerticalTabs, getAdapter };
