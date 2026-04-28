/**
 * FULL STATS & REVENUE RESET SCRIPT
 * Use this when switching from test/sandbox to live payments.
 *
 * DELETES:  Orders, Invoices, Analytics, Carts, Expenses, PushSubscriptions, OTPs
 * RESETS:   Product soldCount + restores stock consumed by test orders
 * RESETS:   Seller totalSales, totalOrders, settlement amounts
 * KEEPS:    Products, Users, Sellers, Categories, BusinessSettings, ProductApprovals
 *
 * Run: node src/scripts/resetAll.js
 */
require('dotenv').config();
const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('❌  MONGODB_URI not set in .env');
  process.exit(1);
}

async function reset() {
  console.log('🔌  Connecting to MongoDB…');
  await mongoose.connect(MONGODB_URI);
  console.log('✅  Connected\n');

  const db = mongoose.connection.db;

  // ── Step 1: Restore stock from all test orders ────────
  console.log('🔄  Step 1 — Restoring product stock from test orders…');
  try {
    const orders = await db.collection('orders').find({}).toArray();
    let stockRestoreCount = 0;

    for (const order of orders) {
      for (const item of (order.items || [])) {
        if (!item.product || !item.quantity) continue;
        await db.collection('products').updateOne(
          { _id: item.product },
          { $inc: { stock: item.quantity } }
        );
        stockRestoreCount++;
      }
    }
    console.log(`   Stock restored across ${stockRestoreCount} line-items from ${orders.length} orders`);
  } catch (err) {
    console.log(`   ⚠️  Stock restore skipped: ${err.message}`);
  }

  // ── Step 2: Delete transactional collections ──────────
  console.log('\n🗑️  Step 2 — Deleting transactional data…');
  const targets = [
    { col: 'orders',            label: 'Orders'            },
    { col: 'invoices',          label: 'Invoices'          },
    { col: 'analytics',         label: 'Analytics / Visits' },
    { col: 'carts',             label: 'Carts'             },
    { col: 'expenses',          label: 'Expenses'          },
    { col: 'pushsubscriptions', label: 'Push Subscriptions' },
    { col: 'otps',              label: 'OTPs'              },
  ];

  for (const { col, label } of targets) {
    try {
      const result = await db.collection(col).deleteMany({});
      console.log(`   ✅  ${label}: ${result.deletedCount} deleted`);
    } catch (err) {
      console.log(`   ⚠️  ${label}: skipped (${err.message})`);
    }
  }

  // ── Step 3: Reset product metrics ─────────────────────
  console.log('\n🔄  Step 3 — Resetting product metrics…');
  try {
    const r = await db.collection('products').updateMany(
      {},
      {
        $set: {
          soldCount:          0,
          likeCount:          0,
          repeatBuyerCount:   0,
          reviews:            [],
          'ratings.average':  0,
          'ratings.count':    0,
        },
      }
    );
    console.log(`   ✅  ${r.modifiedCount} products reset (soldCount, reviews, ratings)`);
  } catch (err) {
    console.log(`   ⚠️  Product reset: ${err.message}`);
  }

  // ── Step 4: Reset seller stats ────────────────────────
  console.log('\n🔄  Step 4 — Resetting seller stats…');
  try {
    const r = await db.collection('sellers').updateMany(
      {},
      {
        $set: {
          totalSales:                  0,
          totalOrders:                 0,
          'settlement.pendingAmount':  0,
          'settlement.heldAmount':     0,
          'settlement.status':         'pending',
          'settlement.lastSettledAt':  null,
        },
      }
    );
    console.log(`   ✅  ${r.modifiedCount} sellers reset`);
  } catch (err) {
    console.log(`   ⚠️  Seller reset: ${err.message}`);
  }

  // ── Step 5: Reset user order flags (if any) ───────────
  console.log('\n🔄  Step 5 — Resetting user order-related fields…');
  try {
    const r = await db.collection('users').updateMany(
      {},
      { $set: { loginHistory: [] } }
    );
    console.log(`   ✅  Login history cleared for ${r.modifiedCount} users`);
  } catch (err) {
    console.log(`   ⚠️  User reset: ${err.message}`);
  }

  // ── Summary ───────────────────────────────────────────
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('✅  Reset complete — platform is clean for LIVE payments');
  console.log('');
  console.log('   Kept intact:');
  console.log('   • Products (with stock restored)');
  console.log('   • Users & Sellers');
  console.log('   • Categories & Business Settings');
  console.log('   • Product Approvals');
  console.log('');
  console.log('   Cleared:');
  console.log('   • All orders & invoices');
  console.log('   • All analytics & visitor data');
  console.log('   • All carts, OTPs, push subscriptions');
  console.log('   • Seller revenue / settlement totals');
  console.log('   • Product soldCount & reviews');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  await mongoose.disconnect();
  console.log('🔌  Disconnected.\n');
}

reset().catch(err => {
  console.error('❌  Script failed:', err.message);
  process.exit(1);
});
