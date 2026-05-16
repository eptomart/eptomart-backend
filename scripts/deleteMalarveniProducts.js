// =============================================================================
// DELETE ALL PRODUCTS UNDER MALARVENI ENTERPRISES
// =============================================================================
// Usage:
//   node scripts/deleteMalarveniProducts.js             ← live delete
//   node scripts/deleteMalarveniProducts.js --dry-run   ← preview only
// =============================================================================

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const mongoose = require('mongoose');

const DRY_RUN = process.argv.includes('--dry-run');

const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI;
if (!MONGO_URI) { console.error('❌  MONGODB_URI not set in .env'); process.exit(1); }

const Seller  = mongoose.model('Seller',  new mongoose.Schema({ businessName: String }, { strict: false }));
const Product = mongoose.model('Product', new mongoose.Schema({ name: String, seller: mongoose.Schema.Types.ObjectId }, { strict: false }));

async function run() {
  await mongoose.connect(MONGO_URI);
  console.log('✅  Connected to MongoDB\n');

  const malarveni = await Seller.findOne({ businessName: { $regex: 'malarveni', $options: 'i' } });
  if (!malarveni) {
    const all = await Seller.find({}).select('businessName').lean();
    console.error('❌  "Malarveni Enterprises" not found. Sellers in DB:');
    all.forEach(s => console.log(`   • "${s.businessName}"  (${s._id})`));
    process.exit(1);
  }
  console.log(`✅  Seller found : ${malarveni.businessName}  (${malarveni._id})`);

  const count = await Product.countDocuments({ seller: malarveni._id });
  console.log(`🗑️   Products to delete : ${count}\n`);

  if (count === 0) {
    console.log('Nothing to delete.'); await mongoose.disconnect(); return;
  }

  if (DRY_RUN) {
    console.log('🔍  DRY RUN — no deletes written.\n');
    const sample = await Product.find({ seller: malarveni._id }).limit(15).select('name').lean();
    sample.forEach(p => console.log(`   • ${p.name}`));
    if (count > 15) console.log(`   ... and ${count - 15} more`);
    await mongoose.disconnect(); return;
  }

  const result = await Product.deleteMany({ seller: malarveni._id });
  console.log(`✅  Deleted ${result.deletedCount} product(s) under "${malarveni.businessName}"`);

  await mongoose.disconnect();
  console.log('🔌  Disconnected.');
}

run().catch(err => { console.error('❌  Error:', err.message); process.exit(1); });
