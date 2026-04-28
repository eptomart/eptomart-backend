// ============================================
// RESET USERS SCRIPT
// Removes all regular users (role: 'user')
// Keeps: admin, superAdmin, seller accounts
// Also clears: carts, push subscriptions for removed users
// ============================================
// Usage: node src/scripts/resetUsers.js
// ============================================

require('dotenv').config();
const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('❌  MONGODB_URI is not set in .env');
  process.exit(1);
}

async function main() {
  console.log('🔌  Connecting to MongoDB…');
  await mongoose.connect(MONGODB_URI);
  console.log('✅  Connected');

  const User            = require('../models/User');
  const Cart            = require('../models/Cart');
  const Order           = require('../models/Order');
  const PushSubscription = require('../models/PushSubscription');

  // Count before
  const totalBefore = await User.countDocuments({ role: 'user' });
  console.log(`\n📊  Regular users found: ${totalBefore}`);

  if (totalBefore === 0) {
    console.log('ℹ️   Nothing to delete. Exiting.');
    await mongoose.disconnect();
    return;
  }

  // Get IDs of users to remove
  const usersToRemove = await User.find({ role: 'user' }).select('_id').lean();
  const userIds = usersToRemove.map(u => u._id);

  // Delete carts
  const cartResult = await Cart.deleteMany({ user: { $in: userIds } });
  console.log(`🛒  Carts deleted: ${cartResult.deletedCount}`);

  // Deactivate push subscriptions (can't cleanly unsubscribe from server, just mark inactive)
  const pushResult = await PushSubscription.updateMany({ user: { $in: userIds } }, { isActive: false });
  console.log(`🔕  Push subscriptions deactivated: ${pushResult.modifiedCount}`);

  // Note: We do NOT delete orders — they contain transaction history
  const orderCount = await Order.countDocuments({ user: { $in: userIds } });
  if (orderCount > 0) {
    console.log(`📦  Orders retained (not deleted): ${orderCount} (transaction history preserved)`);
  }

  // Delete users
  const userResult = await User.deleteMany({ role: 'user' });
  console.log(`\n✅  Users deleted: ${userResult.deletedCount}`);

  // Show what's left
  const remaining = await User.find({}).select('name email role').lean();
  console.log(`\n👥  Remaining accounts (${remaining.length}):`);
  remaining.forEach(u => console.log(`   • [${u.role}] ${u.name} — ${u.email || u.phone || '(no contact)'}`));

  await mongoose.disconnect();
  console.log('\n🔌  Disconnected. Done.');
}

main().catch(err => {
  console.error('❌  Script failed:', err.message);
  process.exit(1);
});
