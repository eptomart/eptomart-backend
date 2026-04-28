/**
 * PRODUCT CLEANUP SCRIPT
 * Deactivates all products except Tamarind from production database.
 * Keeps Tamarind active and approved.
 *
 * Run with: node src/scripts/cleanupProducts.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Product  = require('../models/Product');

async function cleanup() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✅ Connected to MongoDB');

  // Find the ACTIVE Tamarind (keep this one)
  const tamarind = await Product.findOne({ name: /tamarind/i, isActive: true });
  if (!tamarind) {
    console.log('❌ Active Tamarind product not found — aborting to be safe');
    process.exit(1);
  }
  console.log(`🟢 Keeping: "${tamarind.name}" [${tamarind._id}]`);

  // Ensure it is active + approved
  await Product.findByIdAndUpdate(tamarind._id, {
    isActive: true,
    approvalStatus: 'approved',
  });

  // Delete everything else (including the duplicate inactive Tamarind)
  const toDelete = await Product.find({ _id: { $ne: tamarind._id } }).select('name _id').lean();
  console.log(`\n🗑️  Deleting ${toDelete.length} products:`);
  toDelete.forEach(p => console.log(`   - ${p.name}`));

  const result = await Product.deleteMany({ _id: { $ne: tamarind._id } });
  console.log(`\n✅ Deleted ${result.deletedCount} products`);

  // Summary
  const remaining = await Product.find({}).select('name isActive approvalStatus').lean();
  console.log('\nRemaining products:');
  remaining.forEach(p => console.log(` ✅ ${p.name} | active: ${p.isActive} | status: ${p.approvalStatus}`));

  await mongoose.disconnect();
  console.log('\n✅ Done. Only Tamarind remains in production.');
}

cleanup().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
