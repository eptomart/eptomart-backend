// =============================================================================
// REASSIGN ALL PRODUCTS → MALARVENI ENTERPRISES
// Skips products already owned by "Platform" seller
// =============================================================================
// Usage:
//   node scripts/reassignToMalarveni.js             ← live run
//   node scripts/reassignToMalarveni.js --dry-run   ← preview, no DB writes
// =============================================================================

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const mongoose = require('mongoose');

const DRY_RUN = process.argv.includes('--dry-run');

const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI;
if (!MONGO_URI) {
  console.error('❌  MONGODB_URI not set in .env');
  process.exit(1);
}

const Seller  = mongoose.model('Seller',  new mongoose.Schema({ businessName: String }, { strict: false }));
const Product = mongoose.model('Product', new mongoose.Schema({ name: String, seller: mongoose.Schema.Types.ObjectId, approvalStatus: String, isActive: Boolean }, { strict: false }));

async function run() {
  await mongoose.connect(MONGO_URI);
  console.log('✅  Connected to MongoDB\n');

  // ── 1. Find Malarveni Enterprises ─────────────────────────────────────────
  const malarveni = await Seller.findOne({ businessName: { $regex: 'malarveni', $options: 'i' } });
  if (!malarveni) {
    const all = await Seller.find({}).select('businessName').lean();
    console.error('❌  "Malarveni Enterprises" not found. Sellers in DB:');
    all.forEach(s => console.log(`   • "${s.businessName}"  (${s._id})`));
    process.exit(1);
  }
  console.log(`✅  Target seller : ${malarveni.businessName}  (${malarveni._id})`);

  // ── 2. Find Platform seller (skip their products) ──────────────────────────
  const mary = await Seller.findOne({ businessName: { $regex: 'platform', $options: 'i' } });
  if (mary) {
    console.log(`⏭️   Skip seller  : ${mary.businessName}  (${mary._id})`);
  } else {
    console.log('ℹ️   "Platform" seller not found — no products will be excluded.\n');
  }

  // ── 3. Count ───────────────────────────────────────────────────────────────
  const excludeFilter = mary ? { seller: { $ne: mary._id } } : {};
  const maryCount     = mary ? await Product.countDocuments({ seller: mary._id }) : 0;
  const updateCount   = await Product.countDocuments(excludeFilter);

  console.log(`\n📦  Total products         : ${await Product.countDocuments()}`);
  console.log(`🔒  Mary's products (skip) : ${maryCount}`);
  console.log(`✏️   Will be reassigned     : ${updateCount}\n`);

  if (DRY_RUN) {
    console.log('🔍  DRY RUN — no DB writes.\n');
    const sample = await Product.find(excludeFilter).limit(15).select('name seller approvalStatus isActive').lean();
    console.log('Sample products that WOULD be updated:');
    sample.forEach(p => console.log(`   • ${p.name}  (seller: ${p.seller || 'none'}, status: ${p.approvalStatus})`));
    if (updateCount > 15) console.log(`   ... and ${updateCount - 15} more`);
    await mongoose.disconnect();
    return;
  }

  // ── 4. Update ──────────────────────────────────────────────────────────────
  const result = await Product.updateMany(
    excludeFilter,
    {
      $set: {
        seller:         malarveni._id,
        approvalStatus: 'approved',
        isActive:       true,
      },
    }
  );

  console.log(`✅  Done!`);
  console.log(`   → ${result.modifiedCount} product(s) assigned to "${malarveni.businessName}"`);
  console.log(`   → approvalStatus set to "approved", isActive = true`);
  if (mary) console.log(`   → ${maryCount} Platform product(s) untouched`);

  await mongoose.disconnect();
  console.log('\n🔌  Disconnected.');
}

run().catch(err => {
  console.error('❌  Error:', err.message);
  process.exit(1);
});
