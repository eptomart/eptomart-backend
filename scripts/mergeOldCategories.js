// ============================================
// MERGE OLD CATEGORIES → NEW ONES
// Finds legacy categories and reassigns their products to the new seeded categories
// Run: node scripts/mergeOldCategories.js
// ============================================
require('dotenv').config();
const mongoose = require('mongoose');
const Category = require('../src/models/Category');

const MERGE_MAP = [
  // { from: 'Old name', to: 'New name' }
  { from: 'Groceries',          to: 'Grocery & Staples' },
  { from: 'Grocery',            to: 'Grocery & Staples' },
  { from: 'Nuts and Dry fruits',to: 'Dry Fruits & Nuts' },
  { from: 'Nuts & Dry Fruits',  to: 'Dry Fruits & Nuts' },
  { from: 'Spices',             to: 'Masalas & Spices'  },
  { from: 'Masalas',            to: 'Masalas & Spices'  },
  { from: 'Oils',               to: 'Oils & Ghee'       },
  { from: 'Dry Fruits',         to: 'Dry Fruits & Nuts' },
  { from: 'Snacks',             to: 'Snacks & Namkeen'  },
  { from: 'Bakery',             to: 'Bakery & Dairy'    },
  { from: 'Health Foods',       to: 'Health & Organic'  },
  { from: 'Natural Products',   to: 'Health & Organic'  },
  { from: 'Kitchen Essentials', to: 'Kitchen Essentials'}, // same — just ensure it's active
  { from: 'Rice',               to: 'Grocery & Staples' },
  { from: 'Millets',            to: 'Grocery & Staples' },
  { from: 'Pulses',             to: 'Grocery & Staples' },
  { from: 'Pickles',            to: 'Pickles & Condiments' },
];

async function merge() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB\n');

    const Product = mongoose.model('Product', new mongoose.Schema({}, { strict: false }), 'products');

    for (const { from, to } of MERGE_MAP) {
      const oldCat = await Category.findOne({ name: from });
      if (!oldCat) { console.log(`  ⏭  Not found: "${from}"`); continue; }

      if (from === to) {
        console.log(`  ✅ Same name "${from}" — skipping merge, ensuring active`);
        oldCat.isActive = true;
        await oldCat.save();
        continue;
      }

      const newCat = await Category.findOne({ name: to });
      if (!newCat) { console.log(`  ⚠️  Target not found: "${to}" — skipping "${from}"`); continue; }

      // Reassign products
      const result = await Product.updateMany(
        { category: oldCat._id },
        { $set: { category: newCat._id } }
      );
      console.log(`  ✅ Merged "${from}" → "${to}" (${result.modifiedCount} products reassigned)`);

      // Deactivate old category so it no longer shows in UI
      oldCat.isActive = false;
      await oldCat.save();
      console.log(`     ↳ Deactivated: "${from}"`);
    }

    console.log('\n🎉 Merge complete!');
  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    await mongoose.disconnect();
  }
}

merge();
