/**
 * ONE-TIME MIGRATION — Fix inverted variant pricing
 *
 * Problem: The old variantPricingService used (1 - diffPct/100) going from
 * highest→smaller qty, making smaller quantities CHEAPER (backwards).
 * Also: finalPrices were stored as decimals instead of whole numbers.
 *
 * Fix: For each product with variants, re-derive all variant prices using
 * the highest-qty variant's stored basePrice as the starting point,
 * and apply (1 + diffPct/100) for each step toward smaller quantities.
 *
 * Run once:
 *   node scripts/fixVariantPricing.js
 */
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
if (!MONGO_URI) {
  console.error('❌  MONGO_URI not set in .env');
  process.exit(1);
}

// ── Inline schema (no model imports needed) ──────────────────
const variantSchema = new mongoose.Schema({
  basePrice:  Number,
  fromQty:    Number,
  toQty:      Number,
  finalPrice: Number,
}, { _id: false });

const productSchema = new mongoose.Schema({
  name:                     String,
  variants:                 [variantSchema],
  variantDiffPercent:       Number,
  procurementChargePercent: { type: Number, default: 15 },
  platformChargePercent:    { type: Number, default: 10 },
  logisticsChargePercent:   { type: Number, default: 10 },
  currentPrice:             Number,
  isActive:                 Boolean,
}, { strict: false });

const Product = mongoose.model('KoyambeduProduct', productSchema, 'koyambeduproducts');

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

async function run() {
  await mongoose.connect(MONGO_URI);
  console.log('✅  Connected to MongoDB');

  const products = await Product.find({ 'variants.0': { $exists: true } });
  console.log(`📦  Found ${products.length} products with variants\n`);

  let fixed = 0, skipped = 0;

  for (const product of products) {
    if (!product.variants?.length) { skipped++; continue; }

    const totalChargePercent =
      (Number(product.procurementChargePercent) || 15) +
      (Number(product.platformChargePercent)    || 10) +
      (Number(product.logisticsChargePercent)   || 10);

    // Sort DESC — highest qty = index 0 (cheapest wholesale rate)
    const sorted = [...product.variants]
      .map(v => ({ ...v.toObject() }))
      .sort((a, b) => Number(b.fromQty) - Number(a.fromQty));

    const highestBasePrice = Number(sorted[0].basePrice);
    if (!highestBasePrice) { skipped++; continue; }

    const diffPct = Number(product.variantDiffPercent) || 0;
    // CORRECTED: each step toward smaller qty multiplies UP (more expensive per unit)
    const diffMultiplier = 1 + diffPct / 100;

    let runningBase = highestBasePrice;
    const corrected = sorted.map(variant => {
      const basePrice  = r2(runningBase);
      const finalPrice = Math.round(runningBase * (1 + totalChargePercent / 100));
      runningBase = runningBase * diffMultiplier; // next (smaller) variant costs MORE
      return { ...variant, basePrice, finalPrice };
    });

    // Restore ASC order (small qty first)
    const asc = corrected.sort((a, b) => Number(a.fromQty) - Number(b.fromQty));

    // Log what's changing
    const oldPrices = product.variants.map(v => `${v.fromQty}kg=₹${v.finalPrice}`).join(', ');
    const newPrices = asc.map(v => `${v.fromQty}kg=₹${v.finalPrice}`).join(', ');
    console.log(`  ${product.name}`);
    console.log(`    BEFORE: ${oldPrices}`);
    console.log(`    AFTER:  ${newPrices}`);

    // Update embedded variants
    for (let i = 0; i < product.variants.length; i++) {
      const match = asc.find(a => String(a.fromQty) === String(product.variants[i].fromQty));
      if (match) {
        product.variants[i].basePrice  = match.basePrice;
        product.variants[i].finalPrice = match.finalPrice;
      }
    }

    // currentPrice = lowest finalPrice = highest qty tier (bulk rate)
    product.currentPrice = Math.min(...asc.map(v => v.finalPrice));
    product.markModified('variants');
    await product.save();
    fixed++;
  }

  console.log(`\n✅  Migration complete — ${fixed} products fixed, ${skipped} skipped`);
  await mongoose.disconnect();
}

run().catch(err => {
  console.error('❌  Migration failed:', err);
  mongoose.disconnect();
  process.exit(1);
});
