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

  // Find Tamarind
  const tamarind = await Product.findOne({ name: /tamarind/i });
  if (!tamarind) {
    console.log('❌ Tamarind product not found — aborting to be safe');
    process.exit(1);
  }
  console.log(`🟢 Tamarind found: "${tamarind.name}" [${tamarind._id}]`);

  // Ensure Tamarind is active + approved
  await Product.findByIdAndUpdate(tamarind._id, {
    isActive: true,
    approvalStatus: 'approved',
  });
  console.log('✅ Tamarind set to active + approved');

  // Deactivate all OTHER products
  const result = await Product.updateMany(
    { _id: { $ne: tamarind._id } },
    { $set: { isActive: false } }
  );
  console.log(`✅ Deactivated ${result.modifiedCount} other products`);

  // Summary
  const all = await Product.find({}).select('name isActive approvalStatus').lean();
  console.log('\nFinal product list:');
  all.forEach(p => console.log(` - ${p.name} | active: ${p.isActive} | status: ${p.approvalStatus}`));

  await mongoose.disconnect();
  console.log('\n✅ Done. Tamarind is live. All other products are hidden from store.');
}

cleanup().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
