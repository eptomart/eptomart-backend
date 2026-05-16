// ============================================
// FIX CATEGORIES — clean up flat seed + rebuild proper hierarchy
// Run: node scripts/fixCategories.js
// ============================================
require('dotenv').config();
const mongoose = require('mongoose');
const Category = require('../src/models/Category');

// ── Names from the OLD broken seed (all were seeded as top-level) ──
const OLD_FLAT_NAMES = [
  'Rice', 'Millets', 'Pulses', 'Oils', 'Dry Fruits', 'Pickles',
  'Snacks', 'Bakery', 'Health Foods', 'Kitchen Essentials',
  'Natural Products', 'Subscription Boxes',
  'Greens', 'Temple Flowers', 'Bulk Vegetables', 'Hotel Supply', 'Farm Produce',
];

// ── Old parent names (seeded correctly as top-level — keep them) ──
// Fruits, Vegetables, Flowers & Greens, Grocery & Staples, Masalas & Spices,
// Farm Fresh, Homemade & Organic, Pooja & Coconut

// ── NEW parent categories ──────────────────────────────────────────
const NEW_PARENTS = [
  // Eptomart main shop
  { name: 'Grocery & Staples',   icon: '🛒', moduleType: 'eptomart',        sortOrder: 1 },
  { name: 'Masalas & Spices',    icon: '🌶️', moduleType: 'eptomart',        sortOrder: 2 },
  { name: 'Snacks & Namkeen',    icon: '🍿', moduleType: 'eptomart',        sortOrder: 3 },
  { name: 'Dry Fruits & Nuts',   icon: '🥜', moduleType: 'eptomart',        sortOrder: 4 },
  { name: 'Oils & Ghee',         icon: '🫙', moduleType: 'eptomart',        sortOrder: 5 },
  { name: 'Pickles & Condiments',icon: '🥒', moduleType: 'eptomart',        sortOrder: 6 },
  { name: 'Bakery & Dairy',      icon: '🥖', moduleType: 'eptomart',        sortOrder: 7 },
  { name: 'Health & Organic',    icon: '🌿', moduleType: 'eptomart',        sortOrder: 8 },
  { name: 'Kitchen Essentials',  icon: '🍳', moduleType: 'eptomart',        sortOrder: 9 },
  // Koyambedu Daily
  { name: 'Fruits',              icon: '🍊', moduleType: 'koyambedu_daily', sortOrder: 10 },
  { name: 'Vegetables',          icon: '🥦', moduleType: 'koyambedu_daily', sortOrder: 11 },
  { name: 'Flowers & Greens',    icon: '🌸', moduleType: 'koyambedu_daily', sortOrder: 12 },
  { name: 'Pooja & Coconut',     icon: '🪔', moduleType: 'koyambedu_daily', sortOrder: 13 },
  // Uzhavar Fresh
  { name: 'Farm Fresh',          icon: '🌾', moduleType: 'uzhavar_fresh',   sortOrder: 14 },
  { name: 'Homemade & Organic',  icon: '🏡', moduleType: 'uzhavar_fresh',   sortOrder: 15 },
];

// ── NEW sub-categories (with parent name references) ──────────────
const NEW_CHILDREN = [
  // Under Grocery & Staples
  { name: 'Rice & Grains',        icon: '🍚', parent: 'Grocery & Staples',    moduleType: 'eptomart',        sortOrder: 1 },
  { name: 'Pulses & Lentils',     icon: '🫘', parent: 'Grocery & Staples',    moduleType: 'eptomart',        sortOrder: 2 },
  { name: 'Millets & Seeds',      icon: '🌾', parent: 'Grocery & Staples',    moduleType: 'eptomart',        sortOrder: 3 },
  { name: 'Atta & Flour',         icon: '🌾', parent: 'Grocery & Staples',    moduleType: 'eptomart',        sortOrder: 4 },
  { name: 'Sugar, Salt & Jaggery',icon: '🧂', parent: 'Grocery & Staples',    moduleType: 'eptomart',        sortOrder: 5 },
  // Under Masalas & Spices
  { name: 'Whole Spices',         icon: '🌰', parent: 'Masalas & Spices',     moduleType: 'eptomart',        sortOrder: 1 },
  { name: 'Powder Masalas',       icon: '🌶️', parent: 'Masalas & Spices',     moduleType: 'eptomart',        sortOrder: 2 },
  { name: 'Blended Masalas',      icon: '🍛', parent: 'Masalas & Spices',     moduleType: 'eptomart',        sortOrder: 3 },
  // Under Snacks & Namkeen
  { name: 'Chips & Crisps',       icon: '🍟', parent: 'Snacks & Namkeen',     moduleType: 'eptomart',        sortOrder: 1 },
  { name: 'Namkeen & Mixtures',   icon: '🥨', parent: 'Snacks & Namkeen',     moduleType: 'eptomart',        sortOrder: 2 },
  { name: 'Biscuits & Cookies',   icon: '🍪', parent: 'Snacks & Namkeen',     moduleType: 'eptomart',        sortOrder: 3 },
  // Under Dry Fruits & Nuts
  { name: 'Almonds & Cashews',    icon: '🥜', parent: 'Dry Fruits & Nuts',    moduleType: 'eptomart',        sortOrder: 1 },
  { name: 'Dates & Figs',         icon: '🍇', parent: 'Dry Fruits & Nuts',    moduleType: 'eptomart',        sortOrder: 2 },
  { name: 'Mixed Dry Fruits',     icon: '🍱', parent: 'Dry Fruits & Nuts',    moduleType: 'eptomart',        sortOrder: 3 },
  // Under Oils & Ghee
  { name: 'Cooking Oils',         icon: '🫙', parent: 'Oils & Ghee',          moduleType: 'eptomart',        sortOrder: 1 },
  { name: 'Ghee & Butter',        icon: '🧈', parent: 'Oils & Ghee',          moduleType: 'eptomart',        sortOrder: 2 },
  { name: 'Coconut Oil',          icon: '🥥', parent: 'Oils & Ghee',          moduleType: 'eptomart',        sortOrder: 3 },
  // Under Pickles & Condiments
  { name: 'Pickles',              icon: '🥒', parent: 'Pickles & Condiments', moduleType: 'eptomart',        sortOrder: 1 },
  { name: 'Chutneys & Sauces',    icon: '🍅', parent: 'Pickles & Condiments', moduleType: 'eptomart',        sortOrder: 2 },
  { name: 'Jams & Spreads',       icon: '🍓', parent: 'Pickles & Condiments', moduleType: 'eptomart',        sortOrder: 3 },
  // Under Bakery & Dairy
  { name: 'Breads & Buns',        icon: '🍞', parent: 'Bakery & Dairy',       moduleType: 'eptomart',        sortOrder: 1 },
  { name: 'Dairy Products',       icon: '🥛', parent: 'Bakery & Dairy',       moduleType: 'eptomart',        sortOrder: 2 },
  { name: 'Ready to Eat',         icon: '🍱', parent: 'Bakery & Dairy',       moduleType: 'eptomart',        sortOrder: 3 },
  // Under Health & Organic
  { name: 'Organic Grains',       icon: '🌾', parent: 'Health & Organic',     moduleType: 'eptomart',        sortOrder: 1 },
  { name: 'Health Supplements',   icon: '💊', parent: 'Health & Organic',     moduleType: 'eptomart',        sortOrder: 2 },
  { name: 'Superfoods',           icon: '🥗', parent: 'Health & Organic',     moduleType: 'eptomart',        sortOrder: 3 },
  // Under Kitchen Essentials
  { name: 'Cookware',             icon: '🍳', parent: 'Kitchen Essentials',   moduleType: 'eptomart',        sortOrder: 1 },
  { name: 'Storage & Containers', icon: '📦', parent: 'Kitchen Essentials',   moduleType: 'eptomart',        sortOrder: 2 },
  // Under Vegetables (Koyambedu)
  { name: 'Greens',               icon: '🥬', parent: 'Vegetables',           moduleType: 'koyambedu_daily', sortOrder: 1 },
  { name: 'Bulk Vegetables',      icon: '📦', parent: 'Vegetables',           moduleType: 'koyambedu_daily', sortOrder: 2 },
  { name: 'Hotel Supply',         icon: '🏨', parent: 'Vegetables',           moduleType: 'koyambedu_daily', sortOrder: 3 },
  // Under Flowers & Greens (Koyambedu)
  { name: 'Temple Flowers',       icon: '🌺', parent: 'Flowers & Greens',     moduleType: 'koyambedu_daily', sortOrder: 1 },
  // Under Farm Fresh (Uzhavar)
  { name: 'Farm Produce',         icon: '🚜', parent: 'Farm Fresh',           moduleType: 'uzhavar_fresh',   sortOrder: 1 },
];

async function fix() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB\n');

    // ── Step 1: Delete old wrongly-flat categories (only if no products linked) ──
    console.log('── Step 1: Cleaning up old flat categories ──');
    const Product = mongoose.model('Product', new mongoose.Schema({}, { strict: false }), 'products');

    for (const name of OLD_FLAT_NAMES) {
      const cat = await Category.findOne({ name, parentCategory: null });
      if (!cat) { console.log(`  ⏭  Not found (skipping): ${name}`); continue; }

      const productCount = await Product.countDocuments({ category: cat._id });
      if (productCount > 0) {
        console.log(`  ⚠️  Skipping "${name}" — ${productCount} product(s) linked`);
      } else {
        await Category.findByIdAndDelete(cat._id);
        console.log(`  🗑  Deleted: ${name}`);
      }
    }

    // ── Step 2: Upsert parent categories ──────────────────────────────────────
    console.log('\n── Step 2: Upserting parent categories ──');
    const parentMap = {}; // name → _id

    for (const p of NEW_PARENTS) {
      let cat = await Category.findOne({ name: p.name });
      if (cat) {
        cat.moduleType = p.moduleType;
        cat.icon       = p.icon;
        cat.sortOrder  = p.sortOrder;
        cat.parentCategory = null;
        await cat.save();
        console.log(`  ↻  Updated parent: ${p.name}`);
      } else {
        cat = await Category.create({ ...p, parentCategory: null, isActive: true });
        console.log(`  ✅ Created parent: ${p.name}`);
      }
      parentMap[p.name] = cat._id;
    }

    // ── Step 3: Upsert sub-categories ─────────────────────────────────────────
    console.log('\n── Step 3: Upserting sub-categories ──');

    for (const c of NEW_CHILDREN) {
      const parentId = parentMap[c.parent];
      if (!parentId) { console.log(`  ⚠️  Parent not found for: ${c.name} (parent: ${c.parent})`); continue; }

      let cat = await Category.findOne({ name: c.name, parentCategory: parentId });
      if (!cat) {
        // Also check if it exists with no parent (old flat version) and reassign
        cat = await Category.findOne({ name: c.name, parentCategory: null });
      }

      const data = {
        name: c.name, icon: c.icon, moduleType: c.moduleType,
        sortOrder: c.sortOrder, parentCategory: parentId, isActive: true,
      };

      if (cat) {
        Object.assign(cat, data);
        await cat.save();
        console.log(`  ↻  Updated sub-cat: ${c.name} → ${c.parent}`);
      } else {
        await Category.create(data);
        console.log(`  ✅ Created sub-cat: ${c.name} → ${c.parent}`);
      }
    }

    console.log('\n🎉 Categories fixed successfully!');
  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    await mongoose.disconnect();
  }
}

fix();
