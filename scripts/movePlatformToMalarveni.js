// =============================================================================
// MOVE ALL PRODUCTS FROM "PLATFORM" → "MALARVENI ENTERPRISES"
// =============================================================================
// Usage:
//   node scripts/movePlatformToMalarveni.js             ← live run
//   node scripts/movePlatformToMalarveni.js --dry-run   ← preview only
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

  // Find Platform seller
  const platform = await Seller.findOne({ businessName: { $regex: 'platform', $options: 'i' } });
  if (!platform) {
    const all = await Seller.find({}).select('businessName').lean();
    console.error('❌  "Platform" seller not found. Sellers in DB:');
    all.forEach(s => console.log(`   • "${s.businessName}"  (${s._id})`));
    process.exit(1);
  }
  console.log(`✅  Source  : ${platform.businessName}  (${platform._id})`);

  // Find Malarveni Enterprises
  const malarveni = await Seller.findOne({ businessName: { $regex: 'malarveni', $options: 'i' } });
  if (!malarveni) {
    const all = await Seller.find({}).select('businessName').lean();
    console.error('❌  "Malarveni Enterprises" not found. Sellers in DB:');
    all.forEach(s => console.log(`   • "${s.businessName}"  (${s._id})`));
    process.exit(1);
  }
  console.log(`✅  Target  : ${malarveni.businessName}  (${malarveni._id})`);

  const count = await Product.countDocuments({ seller: platform._id });
  console.log(`\n📦  Products to move : ${count}\n`);

  if (count === 0) {
    console.log('Nothing to move.'); await mongoose.disconnect(); return;
  }

  if (DRY_RUN) {
    console.log('🔍  DRY RUN — no DB writes.\n');
    const sample = await Product.find({ seller: platform._id }).limit(15).select('name').lean();
    sample.forEach(p => console.log(`   • ${p.name}`));
    if (count > 15) console.log(`   ... and ${count - 15} more`);
    await mongoose.disconnect(); return;
  }

  const result = await Product.updateMany(
    { seller: platform._id },
    { $set: { seller: malarveni._id, approvalStatus: 'approved', isActive: true } }
  );

  console.log(`✅  Done! ${result.modifiedCount} product(s) moved from "${platform.businessName}" → "${malarveni.businessName}"`);
  await mongoose.disconnect();
  console.log('🔌  Disconnected.');
}

run().catch(err => { console.error('❌  Error:', err.message); process.exit(1); });
