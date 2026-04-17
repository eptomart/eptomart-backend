// ============================================
// MAKE SUPER ADMIN — One-time setup script
//
// Usage (from backend root folder):
//   node src/scripts/makeSuperAdmin.js your@email.com
//
// Or with phone number:
//   node src/scripts/makeSuperAdmin.js 9876543210
//
// Requires MONGODB_URI in .env
// ============================================
require('dotenv').config();
const mongoose = require('mongoose');
const User     = require('../models/User');

const identifier = process.argv[2];

if (!identifier) {
  console.error('\n❌  Usage: node src/scripts/makeSuperAdmin.js <email_or_phone>\n');
  process.exit(1);
}

const run = async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✅  Connected to MongoDB');

  // Find user by email or phone
  const isPhone = /^\d{10}$/.test(identifier);
  const query   = isPhone ? { phone: identifier } : { email: identifier.toLowerCase() };

  const user = await User.findOne(query);

  if (!user) {
    console.error(`\n❌  No user found with ${isPhone ? 'phone' : 'email'}: ${identifier}`);
    console.log('    Make sure this user has logged in at least once on Eptomart.\n');
    await mongoose.disconnect();
    process.exit(1);
  }

  const prevRole = user.role;
  user.role = 'superAdmin';
  await user.save();

  console.log(`\n✅  SUCCESS!`);
  console.log(`    Name:      ${user.name}`);
  console.log(`    Email:     ${user.email || '—'}`);
  console.log(`    Phone:     ${user.phone || '—'}`);
  console.log(`    Role:      ${prevRole}  →  superAdmin`);
  console.log(`\n    This account now has full Super Admin access on Eptomart.\n`);

  await mongoose.disconnect();
  process.exit(0);
};

run().catch(err => {
  console.error('❌  Script failed:', err.message);
  process.exit(1);
});
