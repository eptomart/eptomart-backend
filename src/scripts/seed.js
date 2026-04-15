// ============================================
// SEED SCRIPT — Run once after first deploy
// Usage: node src/scripts/seed.js
// ============================================
require('dotenv').config();
const mongoose = require('mongoose');

const ExpenseCategory = require('../models/ExpenseCategory');

const seedExpenseCategories = async () => {
  const defaults = [
    { name: 'Client Visit',        icon: '🤝', isDefault: true },
    { name: 'Website Maintenance', icon: '💻', isDefault: true },
    { name: 'Office Supplies',     icon: '📦', isDefault: true },
    { name: 'Marketing',           icon: '📢', isDefault: true },
    { name: 'Logistics',           icon: '🚚', isDefault: true },
    { name: 'Miscellaneous',       icon: '💰', isDefault: true },
    { name: 'Rent & Utilities',    icon: '🏢', isDefault: true },
    { name: 'Travel',              icon: '✈️',  isDefault: true },
  ];

  let created = 0;
  for (const cat of defaults) {
    const result = await ExpenseCategory.findOneAndUpdate(
      { name: cat.name },
      { $setOnInsert: cat },
      { upsert: true, new: true }
    );
    if (result.createdAt?.getTime() === result.updatedAt?.getTime()) {
      console.log(`  ✓ Created: ${cat.icon} ${cat.name}`);
      created++;
    } else {
      console.log(`  · Exists:  ${cat.icon} ${cat.name}`);
    }
  }
  console.log(`\n  ${created} categories created, ${defaults.length - created} already existed.`);
};

(async () => {
  console.log('\n🌱 Eptomart Seed Script\n');
  try {
    if (!process.env.MONGODB_URI) {
      throw new Error('MONGODB_URI not set in .env');
    }
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    console.log('📁 Seeding Expense Categories...');
    await seedExpenseCategories();

    console.log('\n✅ All seeds complete!\n');
  } catch (err) {
    console.error('❌ Seed failed:', err.message);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
})();
