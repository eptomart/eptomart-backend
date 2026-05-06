/**
 * trimVariants.js
 * ───────────────
 * Keeps only the FIRST variant on every product that has more than one.
 * Also syncs the product's base price to the first variant's price (if set).
 *
 * Run: node scripts/trimVariants.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Product  = require('../src/models/Product');

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB');

  // Find all products that have more than 1 variant
  const products = await Product.find({ 'variants.1': { $exists: true } });
  console.log(`Found ${products.length} product(s) with multiple variants`);

  let updated = 0;
  for (const product of products) {
    // Pick the variant with the highest price
    const highest = product.variants.reduce((best, v) =>
      (v.price ?? 0) > (best.price ?? 0) ? v : best,
      product.variants[0]
    );

    // Keep only that variant
    product.variants = [highest];

    // Sync base price to the highest variant's price
    if (highest.price != null && highest.price > 0) {
      product.price = highest.price;
    }

    await product.save();
    console.log(`  ✓ ${product.name} — kept variant "${highest.label}", price ₹${product.price}`);
    updated++;
  }

  console.log(`\nDone. Updated ${updated} product(s).`);
  await mongoose.disconnect();
}

run().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
