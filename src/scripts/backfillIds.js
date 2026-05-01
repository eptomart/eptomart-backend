// ============================================
// BACKFILL SELLER CODES + PRODUCT CODES + CATEGORY
//
// Seller code format: 6 chars — first 3 from business name + 3 random digits
//   "Malarveni Enterprises" → MAL847
//   "Sri Traders"           → SRI293
//
// Migrates old formats (EPT-S-XXXX or plain 3-letter codes like MAL)
// to the new 6-char format.
//
// Product code format: MAL847-P-0001 (seller code + P + per-seller sequence)
//
// Usage:
//   node src/scripts/backfillIds.js
// ============================================
require('dotenv').config();
const mongoose = require('mongoose');
const Seller   = require('../models/Seller');
const Product  = require('../models/Product');
const Category = require('../models/Category');

// Old formats to migrate:
//   EPT-S-0001  (old counter style)
//   MAL         (old 3-letter style)
// New format: exactly 6 chars, first 3 alpha + last 3 digits  e.g. MAL847
const isOldFormat = (code) => !code || /^EPT-S-\d+$/.test(code) || /^[A-Z0-9]{3}$/.test(code);

function derivePrefix(businessName) {
  const letters = businessName.replace(/[^a-zA-Z0-9]/g, '');
  return letters.slice(0, 3).toUpperCase().padEnd(3, 'X');
}

function randomPrefixFromName(businessName) {
  const chars = businessName.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  if (chars.length < 3) return chars.padEnd(3, 'X');
  let result = '';
  const indices = new Set();
  let attempts = 0;
  while (result.length < 3 && attempts < 200) {
    const i = Math.floor(Math.random() * chars.length);
    if (!indices.has(i)) { indices.add(i); result += chars[i]; }
    attempts++;
  }
  return result.padEnd(3, 'X');
}

async function makeUniqueCode(businessName, usedCodes) {
  // Pass 1: natural prefix (first 3 chars)
  const naturalPrefix = derivePrefix(businessName);
  for (let attempt = 0; attempt < 20; attempt++) {
    const digits = String(Math.floor(Math.random() * 1000)).padStart(3, '0');
    const code = naturalPrefix + digits;
    if (!usedCodes.has(code)) return code;
  }
  // Pass 2: random chars from name
  for (let attempt = 0; attempt < 100; attempt++) {
    const prefix = randomPrefixFromName(businessName);
    const digits = String(Math.floor(Math.random() * 1000)).padStart(3, '0');
    const code = prefix + digits;
    if (!usedCodes.has(code)) return code;
  }
  throw new Error('Cannot generate unique code for: ' + businessName);
}

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✅ Connected to MongoDB\n');

  // ── 1. Seller codes ───────────────────────────────────────
  const sellers = await Seller.find({}).sort({ createdAt: 1 }).lean();

  // Sellers already on the new 6-char format — keep them
  const goodSellers  = sellers.filter(s => s.sellerId && !isOldFormat(s.sellerId));
  const needsSellers = sellers.filter(s => !s.sellerId || isOldFormat(s.sellerId));

  const usedCodes = new Set(goodSellers.map(s => s.sellerId));

  console.log(`Sellers already on new format (kept): ${goodSellers.length}`);
  console.log(`Sellers to migrate / assign:          ${needsSellers.length}\n`);

  // sellerId → new code map (for product prefix re-coding below)
  const sellerIdToNewCode = {}; // old sellerId string → new code

  for (const seller of needsSellers) {
    const newCode = await makeUniqueCode(seller.businessName, usedCodes);
    usedCodes.add(newCode);
    await Seller.updateOne({ _id: seller._id }, { $set: { sellerId: newCode } });

    const old = seller.sellerId || '(none)';
    sellerIdToNewCode[seller._id.toString()] = newCode;
    console.log(`  ✔ ${seller.businessName.padEnd(35)} ${old.padEnd(12)} → ${newCode}`);
  }

  // Also record new codes for good sellers (needed for product re-coding)
  for (const seller of goodSellers) {
    sellerIdToNewCode[seller._id.toString()] = seller.sellerId;
  }

  // ── 2. Product codes ──────────────────────────────────────
  console.log('\n── Product Codes ─────────────────────────────────────');

  // Build map: seller ObjectId → their new 6-char code
  const sellerCodeMap = sellerIdToNewCode; // already keyed by ObjectId string

  // Find products whose code is missing OR whose prefix doesn't match seller's new code
  const allProducts = await Product.find({}).select('_id name seller productCode createdAt').lean();

  const needsCode = allProducts.filter(p => {
    if (!p.productCode) return true;
    const sid = p.seller?.toString();
    const currentSellerCode = sid ? (sellerCodeMap[sid] || 'EPT') : 'EPT';
    // New format prefix is 6 chars before "-P-"
    const prefix = p.productCode.split('-P-')[0];
    return prefix !== currentSellerCode;
  });

  console.log(`Products needing new/updated code: ${needsCode.length}`);

  // Seed per-seller counters from products that will keep their existing code
  const perSellerCount = {};
  for (const p of allProducts) {
    if (needsCode.find(n => n._id.toString() === p._id.toString())) continue;
    const key = p.seller?.toString() || 'EPT';
    perSellerCount[key] = (perSellerCount[key] || 0) + 1;
  }

  // Sort by seller then creation time so sequences are stable
  needsCode.sort((a, b) => {
    const sa = a.seller?.toString() || '';
    const sb = b.seller?.toString() || '';
    if (sa !== sb) return sa.localeCompare(sb);
    return new Date(a.createdAt) - new Date(b.createdAt);
  });

  for (const product of needsCode) {
    const sid = product.seller?.toString();
    const sellerCode = sid ? (sellerCodeMap[sid] || 'EPT') : 'EPT';
    const key = sid || 'EPT';
    perSellerCount[key] = (perSellerCount[key] || 0) + 1;
    const seq = perSellerCount[key];
    const productCode = `${sellerCode}-P-${String(seq).padStart(4, '0')}`;
    await Product.updateOne({ _id: product._id }, { $set: { productCode } });
    const oldCode = product.productCode || '(none)';
    console.log(`  ✔ ${product.name.padEnd(40)} ${oldCode.padEnd(16)} → ${productCode}`);
  }

  // ── 3. Uncategorised products → Groceries ─────────────────
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
