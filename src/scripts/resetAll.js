/**
 * FULL RESET SCRIPT — Clears all transactional data for a fresh start.
 *
 * DELETES:  Orders, Invoices, Analytics, Carts, Expenses, PushSubscriptions
 * KEEPS:    Products, Users, Sellers, Categories, BusinessSettings
 *
 * Run with: node src/scripts/resetAll.js
 */
require('dotenv').config();
const mongoose = require('mongoose');

async function reset() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✅ Connected to MongoDB\n');

  const db = mongoose.connection.db;

  const targets = [
    'orders',
    'invoices',
    'analytics',
    'carts',
    'expenses',
    'pushsubscriptions',
    'productapprovals',
    'otps',
  ];

  for (const col of targets) {
    try {
      const result = await db.collection(col).deleteMany({});
      console.log(`🗑️  ${col}: deleted ${result.deletedCount} records`);
    } catch (err) {
      console.log(`⚠️  ${col}: skipped (${err.message})`);
    }
  }

  // Reset product soldCount and ratings back to 0
  try {
    const r = await db.collection('products').updateMany(
      {},
      { $set: { soldCount: 0, likeCount: 0, repeatBuyerCount: 0, reviews: [], ratings: { average: 0, count: 0 } } }
    );
    console.log(`🔄  products: reset soldCount/reviews for ${r.modifiedCount} products`);
  } catch (err) {
    console.log(`⚠️  products reset: ${err.message}`);
  }

  // Reset seller settlement/sales stats
  try {
    const r = await db.collection('sellers').updateMany(
      {},
      { $set: { totalSales: 0, totalOrders: 0, 'settlement.pendingAmount': 0, 'settlement.heldAmount': 0, 'settlement.status': 'pending' } }
    );
    console.log(`🔄  sellers: reset stats for ${r.modifiedCount} sellers`);
  } catch (err) {
    console.log(`⚠️  sellers reset: ${err.message}`);
  }

  console.log('\n✅ Reset complete. Fresh start from today!');
  console.log('   Kept: products, users, sellers, categories, business settings');
  await mongoose.disconnect();
}

reset().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
