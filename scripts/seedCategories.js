// ============================================
// SEED CATEGORIES — 25 scalable categories
// Run: node scripts/seedCategories.js
// ============================================
require('dotenv').config();
const mongoose = require('mongoose');
const Category = require('../src/models/Category');

const CATEGORIES = [
  // ── 8 Homepage-featured categories ───────────────────────────────────────
  // Perishable → routed to Koyambedu Daily or Uzhavar Fresh (NOT main shop)
  // Non-perishable → Eptomart main shop

  { name: 'Fruits',             icon: '🍊', moduleType: 'koyambedu_daily', isFeatured: true,  sortOrder: 1  },
  { name: 'Vegetables',         icon: '🥦', moduleType: 'koyambedu_daily', isFeatured: true,  sortOrder: 2  },
  { name: 'Flowers & Greens',   icon: '🌸', moduleType: 'koyambedu_daily', isFeatured: true,  sortOrder: 3  },
  { name: 'Grocery & Staples',  icon: '🛒', moduleType: 'eptomart',        isFeatured: true,  sortOrder: 4  },
  { name: 'Masalas & Spices',   icon: '🌶️', moduleType: 'eptomart',       isFeatured: true,  sortOrder: 5  },
  { name: 'Farm Fresh',         icon: '🌾', moduleType: 'uzhavar_fresh',   isFeatured: true,  sortOrder: 6  },
  { name: 'Homemade & Organic', icon: '🏡', moduleType: 'uzhavar_fresh',   isFeatured: true,  sortOrder: 7  },
  { name: 'Pooja & Coconut',    icon: '🪔', moduleType: 'koyambedu_daily', isFeatured: true,  sortOrder: 8  },

  // ── Non-perishable Eptomart categories ───────────────────────────────────
  { name: 'Rice',               icon: '🍚', moduleType: 'eptomart',        isFeatured: false, sortOrder: 9  },
  { name: 'Millets',            icon: '🌾', moduleType: 'eptomart',        isFeatured: false, sortOrder: 10 },
  { name: 'Pulses',             icon: '🫘', moduleType: 'eptomart',        isFeatured: false, sortOrder: 11 },
  { name: 'Oils',               icon: '🫙', moduleType: 'eptomart',        isFeatured: false, sortOrder: 12 },
  { name: 'Dry Fruits',         icon: '🥜', moduleType: 'eptomart',        isFeatured: false, sortOrder: 13 },
  { name: 'Pickles',            icon: '🥒', moduleType: 'eptomart',        isFeatured: false, sortOrder: 14 },
  { name: 'Snacks',             icon: '🍿', moduleType: 'eptomart',        isFeatured: false, sortOrder: 15 },
  { name: 'Bakery',             icon: '🥖', moduleType: 'eptomart',        isFeatured: false, sortOrder: 16 },
  { name: 'Health Foods',       icon: '💪', moduleType: 'eptomart',        isFeatured: false, sortOrder: 17 },
  { name: 'Kitchen Essentials', icon: '🍳', moduleType: 'eptomart',        isFeatured: false, sortOrder: 18 },
  { name: 'Natural Products',   icon: '🌿', moduleType: 'eptomart',        isFeatured: false, sortOrder: 19 },
  { name: 'Subscription Boxes', icon: '📬', moduleType: 'eptomart',        isFeatured: false, sortOrder: 20 },

  // ── Koyambedu Daily sub-categories ───────────────────────────────────────
  { name: 'Greens',             icon: '🥬', moduleType: 'koyambedu_daily', isFeatured: false, sortOrder: 21 },
  { name: 'Temple Flowers',     icon: '🌺', moduleType: 'koyambedu_daily', isFeatured: false, sortOrder: 22 },
  { name: 'Bulk Vegetables',    icon: '📦', moduleType: 'koyambedu_daily', isFeatured: false, sortOrder: 23 },
  { name: 'Hotel Supply',       icon: '🏨', moduleType: 'koyambedu_daily', isFeatured: false, sortOrder: 24 },

  // ── Uzhavar Fresh sub-categories ─────────────────────────────────────────
  { name: 'Farm Produce',       icon: '🚜', moduleType: 'uzhavar_fresh',   isFeatured: false, sortOrder: 25 },
];

async function seed() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');

    let created = 0, skipped = 0;

    for (const cat of CATEGORIES) {
      const exists = await Category.findOne({ name: cat.name });
      if (exists) {
        // Always overwrite moduleType + isFeatured so re-running the script fixes stale values
        let updated = false;
        if (exists.moduleType !== cat.moduleType) {
          exists.moduleType = cat.moduleType;
          updated = true;
        }
        if (exists.isFeatured !== cat.isFeatured) {
          exists.isFeatured = cat.isFeatured;
          updated = true;
        }
        if (!exists.icon && cat.icon) {
          exists.icon = cat.icon;
          updated = true;
        }
        if (exists.sortOrder !== cat.sortOrder) {
          exists.sortOrder = cat.sortOrder;
          updated = true;
        }
        if (updated) {
          await exists.save();
          console.log(`  ↻ Updated: ${cat.name}  (moduleType → ${cat.moduleType})`);
        } else {
          console.log(`  ⏭  Skipped: ${cat.name}`);
        }
        skipped++;
      } else {
        await Category.create(cat);
        console.log(`  ✅ Created: ${cat.name}`);
        created++;
      }
    }

    console.log(`\n🎉 Done — ${created} created, ${skipped} skipped/updated`);
  } catch (err) {
    console.error('❌ Seed error:', err.message);
  } finally {
    await mongoose.disconnect();
  }
}

seed();
