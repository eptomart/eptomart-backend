// =============================================================================
// ASSIGN PRODUCTS TO MALARVENI ENTERPRISES
// =============================================================================
// What this does:
//   1. Finds the seller "Malarveni enterprises"
//   2. Finds the sub-category "Herbs and Spices"
//   3. Finds the seller "Mary enterprises" — their products are SKIPPED
//   4. Updates all other products → seller = Malarveni, subCategory = Herbs and Spices
//   5. Also sets approvalStatus = 'approved', isActive = true
//
// Run:
//   node scripts/assignToMalarveni.js             ← live run
//   node scripts/assignToMalarveni.js --dry-run   ← preview only, no DB writes
// =============================================================================

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const mongoose = require('mongoose');

const DRY_RUN = process.argv.includes('--dry-run');

const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI;
if (!MONGO_URI) {
  console.error('❌  MONGODB_URI not found in .env');
  process.exit(1);
}

// ── Minimal schemas (no need to import full models) ──────────────────────────
const SellerSchema = new mongoose.Schema({
  businessName: String,
  phone: String,
}, { strict: false });

// Sub-categories are Category docs with a parentCategory set
const CategorySchema = new mongoose.Schema({
  name: String,
  parentCategory: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', default: null },
}, { strict: false });

const ProductSchema = new mongoose.Schema({
  name: String,
  seller: { type: mongoose.Schema.Types.ObjectId, ref: 'Seller' },
  subCategory: { type: mongoose.Schema.Types.ObjectId, ref: 'Category' },
  approvalStatus: String,
  isActive: Boolean,
}, { strict: false });

const Seller   = mongoose.model('Seller',   SellerSchema);
const Category = mongoose.model('Category', CategorySchema);
const Product  = mongoose.model('Product',  ProductSchema);

async function run() {
  await mongoose.connect(MONGO_URI);
  console.log('✅  Connected to MongoDB\n');

  // 1. Find Malarveni enterprises
  const malarveni = await Seller.findOne({ businessName: { $regex: 'malarveni', $options: 'i' } });
  if (!malarveni) {
    console.error('❌  Could not find seller "Malarveni enterprises". Check the name in DB.');
    process.exit(1);
  }
  console.log(`✅  Target seller  : ${malarveni.businessName} (${malarveni._id})`);

  // 2. Find Mary enterprises
  const mary = await Seller.findOne({ businessName: { $regex: 'mary', $options: 'i' } });
  if (mary) {
    console.log(`⏭️   Skip seller   : ${mary.businessName} (${mary._id})`);
  } else {
    console.log('ℹ️   "Mary enterprises" not found — no products will be excluded by seller.');
  }

  // 3. Find "Herbs and Spices" — it's a Category doc with parentCategory set (sub-category)
  const herbsSub = await Category.findOne({
    name: { $regex: 'herbs|spices', $options: 'i' },
    parentCategory: { $ne: null },
  });

  if (!herbsSub) {
    // Show all sub-categories (parentCategory != null) so user can pick the right one
    const allSubs = await Category.find({ parentCategory: { $ne: null } }).select('name').lean();
    const allTop  = await Category.find({ parentCategory: null }).select('name').lean();
    console.error('❌  Could not find a sub-category matching "herbs" or "spices".\n');
    if (allSubs.length > 0) {
      console.log('All SUB-categories in your DB:');
      allSubs.forEach(s => console.log(`  • "${s.name}"  (${s._id})`));
    } else {
      console.log('⚠️  No sub-categories found (parentCategory is null on all). Listing top-level categories instead:');
      allTop.forEach(c => console.log(`  • "${c.name}"  (${c._id})`));
    }
    process.exit(1);
  }
  console.log(`✅  Sub-category   : ${herbsSub.name} (${herbsSub._id})\n`);

  // 4. Build filter — exclude Mary's products
  const filter = {};
  if (mary) filter.seller = { $ne: mary._id };

  // Preview count
  const total = await Product.countDocuments(filter);
  const maryCount = mary ? await Product.countDocuments({ seller: mary._id }) : 0;
  console.log(`📦  Products to update : ${total}`);
  console.log(`🔒  Mary's products    : ${maryCount} (skipped)\n`);

  if (DRY_RUN) {
    console.log('🔍  DRY RUN — no changes written to DB.');
    // Show a sample of what would be updated
    const sample = await Product.find(filter).limit(10).select('name seller subCategory approvalStatus');
    console.log('\nSample products that WOULD be updated:');
    sample.forEach(p => console.log(`  • ${p.name}`));
    if (total > 10) console.log(`  ... and ${total - 10} more`);
  } else {
    const result = await Product.updateMany(
      filter,
      {
        $set: {
          seller:         malarveni._id,
          subCategory:    herbsSub._id,
          approvalStatus: 'approved',
          isActive:       true,
        },
      }
    );
    console.log(`✅  Done! ${result.modifiedCount} product(s) updated.`);
    console.log(`   → seller      : ${malarveni.businessName}`);
    console.log(`   → subCategory : ${herbsSub.name}`);
    console.log(`   → status      : approved + active`);
  }

  await mongoose.disconnect();
  console.log('\n🔌  Disconnected.');
}

run().catch(err => {
  console.error('❌  Error:', err.message);
  process.exit(1);
});
