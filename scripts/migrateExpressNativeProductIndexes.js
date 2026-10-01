// ============================================================
// One-off migration for the "Express combos/products must stay within
// Express" fix — models/ExpressProduct.js and models/ExpressOnlineListing.js
// changed shape so Express can create its own standalone products/combos
// without touching Koyambedu Daily's catalog at all:
//
//   - ExpressProduct.koyambeduProduct is now OPTIONAL (was required+unique).
//     Its unique index is now a separate sparse index.
//   - ExpressOnlineListing.koyambeduProduct is now OPTIONAL (was required).
//     Its old unique index on { store, koyambeduProduct } is replaced with
//     a partialFilterExpression version (only enforced when the field is
//     actually present), plus a NEW unique index on { store, product } for
//     native listings (which have no koyambeduProduct at all).
//
// Mongoose will try to create the new-shaped indexes automatically on
// startup, but if autoIndex is off in production (common), or if the old
// index already exists under the same auto-generated name with different
// options, MongoDB will refuse to silently change it. This script drops
// the old indexes and lets the app (or this script) recreate the new ones
// directly via the native driver, so it doesn't depend on mongoose's
// autoIndex setting at all.
//
// Safe to run any number of times — every step checks before acting.
//
// USAGE (from the eptomart-backend folder):
//   node scripts/migrateExpressNativeProductIndexes.js
// ============================================================
require('dotenv').config();
const mongoose = require('mongoose');

(async () => {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    console.error('❌ No MONGODB_URI (or MONGO_URI) found in .env — run this from the eptomart-backend folder.');
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log('Connected.\n');

  // ── expressproducts: koyambeduProduct unique index ──────────────────────
  {
    const coll = mongoose.connection.db.collection('expressproducts');
    const indexes = await coll.indexes();
    const old = indexes.find(i => JSON.stringify(i.key) === JSON.stringify({ koyambeduProduct: 1 }) && !i.sparse);
    if (old) {
      console.log(`expressproducts: dropping old non-sparse index "${old.name}"...`);
      await coll.dropIndex(old.name);
    } else {
      console.log('expressproducts: no old non-sparse koyambeduProduct index found — nothing to drop.');
    }
    await coll.createIndex({ koyambeduProduct: 1 }, { unique: true, sparse: true });
    console.log('expressproducts: sparse unique koyambeduProduct index ensured.\n');
  }

  // ── expressonlinelistings: koyambeduProduct + product unique indexes ────
  {
    const coll = mongoose.connection.db.collection('expressonlinelistings');
    const indexes = await coll.indexes();

    const oldComposite = indexes.find(i =>
      JSON.stringify(i.key) === JSON.stringify({ store: 1, koyambeduProduct: 1 }) && !i.partialFilterExpression
    );
    if (oldComposite) {
      console.log(`expressonlinelistings: dropping old index "${oldComposite.name}"...`);
      await coll.dropIndex(oldComposite.name);
    } else {
      console.log('expressonlinelistings: no old plain store+koyambeduProduct index found — nothing to drop.');
    }

    await coll.createIndex(
      { store: 1, koyambeduProduct: 1 },
      { unique: true, partialFilterExpression: { koyambeduProduct: { $exists: true } } }
    );
    await coll.createIndex(
      { store: 1, product: 1 },
      { unique: true, partialFilterExpression: { product: { $exists: true } } }
    );
    console.log('expressonlinelistings: partial unique indexes on {store,koyambeduProduct} and {store,product} ensured.\n');
  }

  console.log('✅ Done.');
  await mongoose.disconnect();
})().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
