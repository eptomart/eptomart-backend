// ============================================
// BACKFILL SELLER CODES + PRODUCT CODES + CATEGORY
//
// 1. Assigns a unique 3-letter seller code from business name
//    e.g. "Malarveni Enterprises" → MAL
//         "Sri Traders"           → SRT
//
// 2. Assigns product codes per seller:
//    MAL-P-0001, MAL-P-0002 …
//
// 3. Moves products with no category → Groceries
//
// Usage:
//   node src/scripts/backfillIds.js
// ============================================
require('dotenv').config();
const mongoose = require('mongoose');
const Seller   = require('../models/Seller');
const Product  = require('../models/Product');
const Category = require('../models/Category');

// First 3 alphanumeric chars of business name — always predictable
function deriveCode(businessName) {
  const letters = businessName.replace(/[^a-zA-Z0-9]/g, '');
  return letters.slice(0, 3).toUpperCase().padEnd(3, 'X');
}

async function makeUniqueCode(businessName, usedCodes) {
  const base = deriveCode(businessName);
  if (!usedCodes.has(base)) return base;

  for (let n = 2; n <= 9; n++) {
    const candidate = (base.slice(0, 2) + n).toUpperCase();
    if (!usedCodes.has(candidate)) return candidate;
  }

  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let a = 0; a < 50; a++) {
    const rand = Array.from({ length: 3 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    if (!usedCodes.has(rand)) return rand;
  }
  throw new Error('Cannot generate unique code for: ' + businessName);
}

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✅ Connected to MongoDB\n');

  // ── 1. Assign seller codes ───────────────────────────────
  const sellers = await Seller.find({}).sort({ createdAt: 1 }).lean();

  // Collect codes that are already assigned (keep them)
  const usedCodes = new Set(
    sellers.filter(s => s.sellerId).map(s => s.sellerId)
  );

  const needCode = sellers.filter(s => !s.sellerId);
  console.log(`Sellers already with a code: ${usedCodes.size}`);
  console.log(`Sellers needing a code:      ${needCode.length}\n`);

  for (const seller of needCode) {
    const code = await makeUniqueCode(seller.businessName, usedCodes);
    usedCodes.add(code);
    await Seller.updateOne({ _id: seller._id }, { $set: { sellerId: code } });
    console.log(`  ✔ ${seller.businessName.padEnd(35)} → ${code}`);
  }

  // ── 2. Assign product codes (per seller) ─────────────────
  console.log('\n── Product Codes ─────────────────────────────────────');

  // Reload sellers to get their fresh codes
  const allSellers = await Seller.find({}).select('_id businessName sellerId').lean();
  const sellerCodeMap = {};
  for (const s of allSellers) sellerCodeMap[s._id.toString()] = s.sellerId || 'EPT';

  const productsWithoutCode = await Product.find({
    $or: [{ productCode: { $exists: false } }, { productCode: null }, { productCode: '' }],
  }).sort({ seller: 1, createdAt: 1 }).lean();

  console.log(`Products needing a code: ${productsWithoutCode.length}`);

  // Track per-seller sequence so codes are EPT-P-0001, 0002 … per seller
  const perSellerCount = {};

  // Seed counts from already-assigned products
  const assigned = await Product.find({ productCode: { $exists: true, $ne: null } })
    .select('seller productCode').lean();
  for (const p of assigned) {
    const sid = p.seller?.toString();
    if (!sid) continue;
    perSellerCount[sid] = (perSellerCount[sid] || 0) + 1;
  }

  for (const product of productsWithoutCode) {
    const sid = product.seller?.toString();
    const sellerCode = sid ? (sellerCodeMap[sid] || 'EPT') : 'EPT';
    perSellerCount[sid || 'EPT'] = (perSellerCount[sid || 'EPT'] || 0) + 1;
    const seq = perSellerCount[sid || 'EPT'];
    const productCode = `${sellerCode}-P-${String(seq).padStart(4, '0')}`;
    await Product.updateOne({ _id: product._id }, { $set: { productCode } });
    console.log(`  ✔ ${product.name.padEnd(40)} → ${productCode}`);
  }

  // ── 3. Assign uncategorised products → Groceries ─────────
  console.log('\n── Categories ────────────────────────────────────────');
  let groceries = await Category.findOne({ name: /^groceries$/i });
  if (!groceries) {
    groceries = await Category.create({
      name: 'Groceries', slug: 'groceries', icon: '🛒',
      description: 'Fresh groceries, staples, and everyday essentials',
      isActive: true, sortOrder: 1,
    });
    console.log('📂 Created "Groceries" category');
  }

  const uncategorised = await Product.find({
    $or: [{ category: { $exists: false } }, { category: null }],
  }).lean();

  console.log(`Products with no category: ${uncategorised.length}`);
  for (const p of uncategorised) {
    await Product.updateOne({ _id: p._id }, { $set: { category: groceries._id } });
    console.log(`  ✔ ${p.name}`);
  }

  console.log('\n✅ Backfill complete');
  await mongoose.disconnect();
}

run().catch(err => { console.error('❌ Error:', err.message); process.exit(1); });
