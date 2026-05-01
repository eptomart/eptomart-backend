// ============================================
// ASSIGN SUB-CATEGORY TO ALL EXISTING PRODUCTS
//
// Moves every product that has no subCategory
// into "Herbs and Spices" under "Groceries".
//
// Creates Groceries and/or Herbs and Spices if
// they don't exist yet.
//
// Usage:
//   node src/scripts/assignSubCategory.js
// ============================================
require('dotenv').config();
const mongoose = require('mongoose');
const Category = require('../models/Category');
const Product  = require('../models/Product');

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✅ Connected to MongoDB\n');

  // ── 1. Ensure Groceries parent category exists ─────────
  let groceries = await Category.findOne({ name: /^groceries$/i });
  if (!groceries) {
    groceries = await Category.create({
      name: 'Groceries', slug: 'groceries', icon: '🛒',
      description: 'Fresh groceries, staples, and everyday essentials',
      isActive: true, sortOrder: 1,
    });
    console.log('📂 Created "Groceries" parent category');
  } else {
    console.log(`✔ Found Groceries (${groceries._id})`);
  }

  // ── 2. Ensure "Herbs and Spices" sub-category exists ───
  let herbsAndSpices = await Category.findOne({
    name: /^herbs\s+and\s+spices$/i,
    parentCategory: groceries._id,
  });

  if (!herbsAndSpices) {
    herbsAndSpices = await Category.create({
      name: 'Herbs and Spices',
      slug: 'herbs-and-spices',
      icon: '🌿',
      description: 'Fresh and dried herbs, whole and ground spices',
      parentCategory: groceries._id,
      isActive: true,
      sortOrder: 1,
    });
    console.log('📂 Created "Herbs and Spices" sub-category under Groceries');
  } else {
    console.log(`✔ Found Herbs and Spices (${herbsAndSpices._id})`);
  }

  // ── 3. Move all products without a subCategory ──────────
  const products = await Product.find({
    $or: [{ subCategory: { $exists: false } }, { subCategory: null }],
  }).select('_id name').lean();

  console.log(`\nProducts without a sub-category: ${products.length}`);

  let updated = 0;
  for (const p of products) {
    await Product.updateOne(
      { _id: p._id },
      { $set: { subCategory: herbsAndSpices._id, category: groceries._id } }
    );
    console.log(`  ✔ ${p.name}`);
    updated++;
  }

  console.log(`\n✅ Done — ${updated} products assigned to Herbs and Spices`);
  await mongoose.disconnect();
}

run().catch(err => { console.error('❌', err.message); process.exit(1); });
