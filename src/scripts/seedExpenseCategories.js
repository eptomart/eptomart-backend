require('dotenv').config();
const mongoose = require('mongoose');
const ExpenseCategory = require('../models/ExpenseCategory');

const defaults = [
  { name: 'Client Visit',        icon: '🤝', isDefault: true },
  { name: 'Website Maintenance', icon: '💻', isDefault: true },
  { name: 'Office Supplies',     icon: '📦', isDefault: true },
  { name: 'Marketing',           icon: '📢', isDefault: true },
  { name: 'Logistics',           icon: '🚚', isDefault: true },
  { name: 'Miscellaneous',       icon: '💰', isDefault: true },
];

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  for (const cat of defaults) {
    await ExpenseCategory.findOneAndUpdate(
      { name: cat.name },
      { $setOnInsert: cat },
      { upsert: true, new: true }
    );
    console.log(`✓ ${cat.name}`);
  }
  console.log('Expense categories seeded!');
  process.exit(0);
})();
