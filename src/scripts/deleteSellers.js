/**
 * DELETE ALL SELLERS EXCEPT "Mary enterprises"
 *
 * This script:
 *  1. Lists all sellers to preview what will be deleted
 *  2. Deletes sellers whose businessName does NOT match "Mary enterprises" (case-insensitive)
 *  3. Deletes the associated user accounts (role:'seller') for removed sellers
 *  4. Deletes products belonging to removed sellers
 *  5. Removes product approvals for those products
 *
 * Run: node src/scripts/deleteSellers.js
 */
require('dotenv').config();
const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('❌  MONGODB_URI not set in .env');
  process.exit(1);
}

const KEEP_NAME = 'Mary enterprises'; // exact match (case-insensitive)

async function run() {
  console.log('🔌  Connecting to MongoDB…');
  await mongoose.connect(MONGODB_URI);
  console.log('✅  Connected\n');

  const db = mongoose.connection.db;

  // ── 1. Find sellers to delete ─────────────────────────────
  const allSellers = await db.collection('sellers').find({}).toArray();
  console.log(`📋  Total sellers in DB: ${allSellers.length}`);

  const toKeep   = allSellers.filter(s => s.businessName?.toLowerCase() === KEEP_NAME.toLowerCase());
  const toDelete = allSellers.filter(s => s.businessName?.toLowerCase() !== KEEP_NAME.toLowerCase());

  if (toKeep.length === 0) {
    console.warn(`⚠️  No seller found with businessName "${KEEP_NAME}". Aborting — nothing deleted.`);
    await mongoose.disconnect();
    return;
  }

  console.log(`\n✅  Keeping (${toKeep.length}):`);
  toKeep.forEach(s => console.log(`    • ${s.businessName} (${s._id})`));

  console.log(`\n🗑️  Deleting (${toDelete.length}):`);
  toDelete.forEach(s => console.log(`    • ${s.businessName} (${s._id})`));

  if (toDelete.length === 0) {
    console.log('\nNothing to delete.');
    await mongoose.disconnect();
    return;
  }

  const sellerIds = toDelete.map(s => s._id);
  const userIds   = toDelete.map(s => s.user).filter(Boolean);

  // ── 2. Delete their products ──────────────────────────────
  console.log('\n🛍️  Step 1 — Deleting products of removed sellers…');
  const products = await db.collection('products').find({ seller: { $in: sellerIds } }).toArray();
  const productIds = products.map(p => p._id);
  console.log(`    Found ${productIds.length} product(s)`);

  if (productIds.length > 0) {
    await db.collection('products').deleteMany({ _id: { $in: productIds } });
    console.log(`    ✅ Deleted ${productIds.length} product(s)`);

    // Remove product approvals
    const approvalResult = await db.collection('productapprovals').deleteMany({ product: { $in: productIds } });
    console.log(`    ✅ Removed ${approvalResult.deletedCount} product approval(s)`);
  }

  // ── 3. Delete seller documents ────────────────────────────
  console.log('\n🏪  Step 2 — Deleting seller documents…');
  const sellerResult = await db.collection('sellers').deleteMany({ _id: { $in: sellerIds } });
  console.log(`    ✅ Deleted ${sellerResult.deletedCount} seller(s)`);

  // ── 4. Delete associated user accounts ───────────────────
  console.log('\n👤  Step 3 — Deleting associated seller user accounts…');
  if (userIds.length > 0) {
    const userResult = await db.collection('users').deleteMany({ _id: { $in: userIds }, role: 'seller' });
    console.log(`    ✅ Deleted ${userResult.deletedCount} user account(s)`);
  } else {
    console.log('    ⚠️  No linked user IDs found — skipping');
  }

  // ── 5. Deactivate push subscriptions for deleted users ───
  if (userIds.length > 0) {
    await db.collection('pushsubscriptions').updateMany(
      { user: { $in: userIds } },
      { $set: { active: false } }
    );
    console.log(`    ✅ Deactivated push subscriptions for removed users`);
  }

  console.log('\n🎉  Done! All sellers except "Mary enterprises" have been removed.\n');
  await mongoose.disconnect();
}

run().catch(err => {
  console.error('❌  Script failed:', err);
  mongoose.disconnect();
  process.exit(1);
});
