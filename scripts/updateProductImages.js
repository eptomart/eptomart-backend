// =============================================================================
// UPDATE PRODUCT IMAGES — Eptomart Data Quality Script
// =============================================================================
// What this script does:
//   1. Connects to your MongoDB Atlas database
//   2. Creates a full JSON backup of all products → scripts/backups/
//   3. For each product, finds the matching content config (productConfigs.js)
//   4. Fetches a high-quality, accurately matched image from Unsplash API
//   5. Updates: images, description, shortDescription, tags, metaTitle,
//              metaDescription
//   6. Preserves: price, GST, HSN, stock, seller, variants, approvalStatus,
//                 orders, payments — nothing financial is touched
//   7. Generates a Markdown report → scripts/reports/
//
// Prerequisites:
//   npm install axios dotenv  (in the eptomart-backend folder)
//
// .env must contain:
//   MONGO_URI=mongodb+srv://...
//   UNSPLASH_ACCESS_KEY=your_unsplash_client_id   ← get free at unsplash.com/developers
//   PEXELS_API_KEY=your_pexels_key                ← optional fallback
//
// Run:
//   node scripts/updateProductImages.js              ← skips products with existing images
//   node scripts/updateProductImages.js --force      ← replaces ALL images
//   node scripts/updateProductImages.js --dry-run    ← shows what WOULD change, no writes
//
// =============================================================================

// Load .env from the project root (works regardless of which directory you run from)
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const axios    = require('axios');
const fs       = require('fs');
// (path already required above)
const { findConfig } = require('./productConfigs');

// ── CLI flags ─────────────────────────────────────────────────────────────────
const FORCE_UPDATE = process.argv.includes('--force');
const DRY_RUN      = process.argv.includes('--dry-run');

// ── CLI key override: --unsplash-key=VALUE ────────────────────────────────────
const cliUnsplashArg = process.argv.find(a => a.startsWith('--unsplash-key='));
const cliUnsplashKey = cliUnsplashArg ? cliUnsplashArg.split('=').slice(1).join('=') : null;

// ── API credentials (env var OR inline env OR CLI arg) ────────────────────────
const UNSPLASH_KEY = cliUnsplashKey || process.env.UNSPLASH_ACCESS_KEY;
const PEXELS_KEY   = process.env.PEXELS_API_KEY;

// ── Directories ───────────────────────────────────────────────────────────────
const BACKUP_DIR = path.join(__dirname, 'backups');
const REPORT_DIR = path.join(__dirname, 'reports');
[BACKUP_DIR, REPORT_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

// ── Rate-limit helper ─────────────────────────────────────────────────────────
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// =============================================================================
// IMAGE FETCHING
// =============================================================================

/**
 * Fetch a permanent, high-quality image URL from Unsplash.
 * Returns { url, publicId } or null on failure.
 */
async function fetchUnsplashImage(query, altQuery = '') {
  if (!UNSPLASH_KEY) return null;

  const tryQuery = async (q) => {
    try {
      const res = await axios.get('https://api.unsplash.com/search/photos', {
        params: {
          query:          q,
          per_page:       5,
          orientation:    'squarish',
          content_filter: 'high',
          order_by:       'relevant',
        },
        headers: { Authorization: `Client-ID ${UNSPLASH_KEY}` },
        timeout: 10000,
      });

      const results = res.data?.results || [];
      if (results.length === 0) return null;

      // Prefer results with keywords overlapping the query
      const queryWords = q.toLowerCase().split(' ');
      let best = results[0];
      for (const r of results) {
        const desc = `${r.description || ''} ${r.alt_description || ''}`.toLowerCase();
        const overlap = queryWords.filter(w => desc.includes(w)).length;
        const bestOverlap = queryWords.filter(w =>
          `${best.description || ''} ${best.alt_description || ''}`.toLowerCase().includes(w)
        ).length;
        if (overlap > bestOverlap) best = r;
      }

      // Use the `regular` size (~1080px) — permanent CDN URL
      return {
        url:      best.urls.regular,
        publicId: `unsplash-${best.id}`,
      };
    } catch (err) {
      if (err.response?.status === 403 || err.response?.status === 429) {
        console.warn('  ⚠ Unsplash rate limit hit. Waiting 60s…');
        await sleep(60000);
      }
      return null;
    }
  };

  const result = await tryQuery(query);
  if (result) return result;
  if (altQuery) return await tryQuery(altQuery);
  return null;
}

/**
 * Fetch from Pexels as a fallback.
 * Returns { url, publicId } or null.
 */
async function fetchPexelsImage(query) {
  if (!PEXELS_KEY) return null;
  try {
    const res = await axios.get('https://api.pexels.com/v1/search', {
      params: { query, per_page: 3, orientation: 'square' },
      headers: { Authorization: PEXELS_KEY },
      timeout: 10000,
    });
    const photo = res.data?.photos?.[0];
    if (!photo) return null;
    return {
      url:      photo.src.large,
      publicId: `pexels-${photo.id}`,
    };
  } catch {
    return null;
  }
}

/**
 * Get best available image for a product config.
 * Tries Unsplash → Pexels → returns null if both fail.
 */
async function getImage(config) {
  let img = await fetchUnsplashImage(config.imageQuery, config.altImageQuery);
  if (!img) img = await fetchPexelsImage(config.imageQuery);
  return img;
}

// =============================================================================
// BACKUP
// =============================================================================

async function backupProducts(products) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename  = path.join(BACKUP_DIR, `products-backup-${timestamp}.json`);
  fs.writeFileSync(filename, JSON.stringify(products, null, 2));
  console.log(`✅ Backup saved → ${filename}`);
  return filename;
}

// =============================================================================
// REPORT GENERATOR
// =============================================================================

function generateReport(results, backupFile) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename  = path.join(REPORT_DIR, `image-update-report-${timestamp}.md`);

  const updated     = results.filter(r => r.status === 'updated');
  const skipped     = results.filter(r => r.status === 'skipped');
  const noConfig    = results.filter(r => r.status === 'no_config');
  const noImage     = results.filter(r => r.status === 'no_image');
  const errored     = results.filter(r => r.status === 'error');
  const dryRun      = results.filter(r => r.status === 'dry_run');
  const needsReview = [...noConfig, ...noImage, ...errored];

  const lines = [
    `# Eptomart — Product Image Update Report`,
    `**Generated:** ${new Date().toLocaleString('en-IN')}`,
    `**Mode:** ${DRY_RUN ? '🧪 DRY RUN (no changes written)' : FORCE_UPDATE ? '⚡ FORCE UPDATE' : '🔄 NORMAL (skips existing images)'}`,
    `**Backup:** \`${backupFile}\``,
    ``,
    `## Summary`,
    `| Metric | Count |`,
    `|---|---|`,
    `| Total products checked | ${results.length} |`,
    `| ✅ Successfully updated | ${updated.length + dryRun.length} |`,
    `| ⏭ Skipped (had image already) | ${skipped.length} |`,
    `| ❌ No matching config found | ${noConfig.length} |`,
    `| 🖼 Config matched but no image fetched | ${noImage.length} |`,
    `| 💥 Errors during update | ${errored.length} |`,
    `| 🔍 Needs manual review | ${needsReview.length} |`,
    ``,
    `## ✅ Updated Products`,
    ...(updated.length > 0 ? [
      `| Product Name | Image Source | Description Updated | Tags Updated |`,
      `|---|---|---|---|`,
      ...updated.map(r =>
        `| ${r.name} | ${r.imageSource || 'N/A'} | ${r.descUpdated ? '✅' : '—'} | ${r.tagsUpdated ? '✅' : '—'} |`
      ),
    ] : ['_None_']),
    ``,
    `## 🧪 Dry Run — Would Update`,
    ...(dryRun.length > 0 ? [
      `| Product Name | Matched Config | Image Query |`,
      `|---|---|---|`,
      ...dryRun.map(r => `| ${r.name} | ${r.configMatch || '—'} | ${r.imageQuery || '—'} |`),
    ] : ['_None_']),
    ``,
    `## ⏭ Skipped (Already Have Images)`,
    ...(skipped.length > 0 ? skipped.map(r => `- ${r.name}`) : ['_None_']),
    ``,
    `## ❌ No Config Found — Manual Review Required`,
    ...(noConfig.length > 0 ? [
      `These products did not match any pattern in \`productConfigs.js\`. Add a config entry for them.`,
      ``,
      ...noConfig.map(r => `- **${r.name}** (ID: ${r.id})`),
    ] : ['_None — all products matched a config._']),
    ``,
    `## 🖼 Config Found, But No Image Fetched`,
    ...(noImage.length > 0 ? [
      `These products matched a config but Unsplash/Pexels returned no usable image.`,
      `Check your API keys and try again, or add a manual image URL.`,
      ``,
      ...noImage.map(r => `- **${r.name}** — Query: \`${r.imageQuery}\``),
    ] : ['_None_']),
    ``,
    `## 💥 Errors`,
    ...(errored.length > 0 ? errored.map(r => `- **${r.name}**: ${r.error}`) : ['_None_']),
    ``,
    `---`,
    `*Report generated by \`scripts/updateProductImages.js\`*`,
    `*Eptomart — Premium Quality Data Engineer*`,
  ];

  fs.writeFileSync(filename, lines.join('\n'));
  console.log(`\n📊 Report saved → ${filename}`);
  return filename;
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║  Eptomart — Product Image & Content Updater          ║');
  console.log(`║  Mode: ${DRY_RUN ? 'DRY RUN    ' : FORCE_UPDATE ? 'FORCE UPDATE' : 'NORMAL     '}                               ║`);
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log('');

  if (!UNSPLASH_KEY && !PEXELS_KEY) {
    console.error('❌ No image API key found.');
    console.error('   Set UNSPLASH_ACCESS_KEY or PEXELS_API_KEY in your .env file.');
    console.error('   Get a free Unsplash key at: https://unsplash.com/developers');
    process.exit(1);
  }

  const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!MONGO_URI) {
    console.error('❌ MONGODB_URI not set in .env');
    process.exit(1);
  }

  // ── Connect ──────────────────────────────────────────────────────────────
  console.log('🔌 Connecting to MongoDB…');
  await mongoose.connect(MONGO_URI);
  console.log('✅ Connected.\n');

  // Load Product model (reuse existing)
  const Product = require('../src/models/Product');

  // ── Fetch all products ────────────────────────────────────────────────────
  console.log('📦 Loading all products…');
  const products = await Product.find({}).lean();
  console.log(`   Found ${products.length} product(s).\n`);

  if (products.length === 0) {
    console.log('No products in database. Exiting.');
    await mongoose.disconnect();
    return;
  }

  // ── Backup ────────────────────────────────────────────────────────────────
  const backupFile = await backupProducts(products);
  console.log('');

  // ── Process each product ─────────────────────────────────────────────────
  const results = [];
  let counter   = 0;

  for (const product of products) {
    counter++;
    const progressTag = `[${counter}/${products.length}]`;
    console.log(`${progressTag} Processing: "${product.name}"`);

    // ── Check if it already has an image (skip unless --force) ────────────
    const hasImage = Array.isArray(product.images) && product.images.length > 0 &&
                     product.images.some(img => img.url && img.url.trim() !== '');

    if (hasImage && !FORCE_UPDATE && !DRY_RUN) {
      console.log(`  ⏭ Skipping — already has ${product.images.length} image(s).`);
      results.push({ status: 'skipped', name: product.name, id: product._id });
      continue;
    }

    // ── Find matching content config ──────────────────────────────────────
    const config = findConfig(product.name, product.tags);

    if (!config) {
      console.log(`  ❌ No config match found for "${product.name}"`);
      results.push({ status: 'no_config', name: product.name, id: product._id });
      continue;
    }

    console.log(`  ✓ Config matched: patterns=[${config.patterns.slice(0,2).join(', ')}]`);

    // ── Dry-run mode — log and continue ───────────────────────────────────
    if (DRY_RUN) {
      console.log(`  🧪 DRY RUN: Would fetch image for query: "${config.imageQuery}"`);
      results.push({
        status:      'dry_run',
        name:        product.name,
        id:          product._id,
        configMatch: config.patterns[0],
        imageQuery:  config.imageQuery,
      });
      continue;
    }

    // ── Fetch image ────────────────────────────────────────────────────────
    console.log(`  🖼 Fetching image: "${config.imageQuery}"…`);
    const img = await getImage(config);

    if (!img) {
      console.log(`  ❌ No image found from any API for "${product.name}"`);
      results.push({ status: 'no_image', name: product.name, id: product._id, imageQuery: config.imageQuery });
      await sleep(300);
      continue;
    }

    console.log(`  ✅ Image fetched: ${img.url.substring(0, 70)}…`);

    // ── Prepare update payload ─────────────────────────────────────────────
    // Safely truncate fields to model limits
    const safeStr = (str, max) => str ? str.substring(0, max) : undefined;

    const updatePayload = {
      // Image — replace with single authoritative image
      images: [{
        url:       img.url,
        publicId:  img.publicId,
        isDefault: true,
      }],

      // Content (with hard length guards)
      description:      safeStr(config.description,      1950),
      shortDescription: safeStr(config.shortDescription,  295),
      tags:             config.tags || [],
      metaTitle:        safeStr(config.metaTitle,          100),
      metaDescription:  safeStr(config.metaDescription,   160),
    };

    // Detect what actually changed
    const descUpdated = product.description !== updatePayload.description;
    const tagsUpdated = JSON.stringify(product.tags) !== JSON.stringify(updatePayload.tags);

    // ── Write update to DB ─────────────────────────────────────────────────
    try {
      await Product.findByIdAndUpdate(
        product._id,
        { $set: updatePayload },
        { new: false, runValidators: true }
      );

      console.log(`  💾 Saved.  desc_updated=${descUpdated}  tags_updated=${tagsUpdated}`);
      results.push({
        status:      'updated',
        name:        product.name,
        id:          product._id,
        imageSource: img.publicId?.startsWith('unsplash') ? 'Unsplash' : 'Pexels',
        descUpdated,
        tagsUpdated,
      });
    } catch (err) {
      console.error(`  💥 DB update error: ${err.message}`);
      results.push({ status: 'error', name: product.name, id: product._id, error: err.message });
    }

    // Rate-limit: 500ms between API calls to stay within Unsplash's 50 req/hour
    await sleep(500);
  }

  // ── Disconnect ────────────────────────────────────────────────────────────
  await mongoose.disconnect();
  console.log('\n🔌 Disconnected from MongoDB.\n');

  // ── Print summary ─────────────────────────────────────────────────────────
  const updated  = results.filter(r => r.status === 'updated').length;
  const skipped  = results.filter(r => r.status === 'skipped').length;
  const noConfig = results.filter(r => r.status === 'no_config').length;
  const noImage  = results.filter(r => r.status === 'no_image').length;
  const errored  = results.filter(r => r.status === 'error').length;
  const dryRun   = results.filter(r => r.status === 'dry_run').length;

  console.log('══════════════════════════════════════════════');
  console.log('  RESULTS SUMMARY');
  console.log('══════════════════════════════════════════════');
  console.log(`  Total checked   : ${results.length}`);
  console.log(`  ✅ Updated       : ${updated}`);
  console.log(`  🧪 Dry-run shown : ${dryRun}`);
  console.log(`  ⏭  Skipped       : ${skipped}`);
  console.log(`  ❌ No config     : ${noConfig}`);
  console.log(`  🖼  No image      : ${noImage}`);
  console.log(`  💥 Errors        : ${errored}`);
  console.log('══════════════════════════════════════════════');

  // ── Generate report ────────────────────────────────────────────────────────
  generateReport(results, backupFile);
  console.log('\n✅ All done.\n');
}

main().catch(err => {
  console.error('\n💥 Fatal error:', err.message);
  mongoose.disconnect().finally(() => process.exit(1));
});
