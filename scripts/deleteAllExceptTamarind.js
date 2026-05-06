/**
 * deleteAllExceptTamarind.js
 * ──────────────────────────
 * Deletes ALL products from the database EXCEPT any product
 * whose name contains "tamarind" (case-insensitive).
 *
 * Run: node scripts/deleteAllExceptTamarind.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Product  = require('../src/models/Product');

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB');

  // Find tamarind products first so we know what's being kept
  const kept = await Product.find({ name: { $regex: /tamarind/i } }).select('name _id');
  if (kept.length === 0) {
    console.log('⚠️  No product with "tamarind" in the name found. Aborting — nothing deleted.');
    await mongoose.disconnect();
    return;
  }

  console.log(`Keeping ${kept.length} product(s):`);
  kept.forEach(p => console.log(`  ✓ ${p.name} (${p._id})`));

  const keepIds = kept.map(p => p._id);

  // Delete everything else
  const result = await Product.deleteMany({ _id: { $nin: keepIds } });
  console.log(`\n🗑️  Deleted ${result.deletedCount} product(s).`);

  await mongoose.disconnect();
  console.log('Done.');
}

run().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
