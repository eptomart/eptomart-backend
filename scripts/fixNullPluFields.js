// ============================================================
// One-off cleanup for: "E11000 duplicate key error collection:
// eptomart.expressproducts index: plu_1 dup key: { plu: null }"
//
// Root cause: ExpressProduct.plu used to have `default: null`, and the
// unique index on plu is `sparse` — but a sparse index only skips documents
// where the field is entirely ABSENT, not documents that explicitly store
// `plu: null`. Every product whose category didn't map to a PLU series
// (vegetables/fruits) got `plu: null` saved explicitly, so the first such
// product succeeded and every next one collided with it on save — which is
// exactly what happens when an admin bulk-enables many products in the
// Online Catalog "Save All" action.
//
// Fixed going forward in expressAdminController.js (createProduct,
// adminAssignProductToStore, resolveExpressProduct now omit the key
// instead of setting it to null; adminSetProductPlu's "clear code" branch
// now uses $unset instead of $set: null) and in models/ExpressProduct.js
// (dropped the `default: null`).
//
// This script fixes the data already sitting in the database: it removes
// the `plu` key entirely (via $unset) from every ExpressProduct document
// that currently has `plu: null`, so the sparse index stops seeing them as
// present-and-colliding. Completely safe — a product with no PLU code
// behaves identically whether the field is null or absent; POS/printing
// code already treats both the same way (`product.plu ?? null`).
//
// USAGE (from the eptomart-backend folder):
//   node scripts/fixNullPluFields.js
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
  console.log('Connected. Checking expressproducts for explicit plu:null documents...\n');

  const coll = mongoose.connection.db.collection('expressproducts');
  const query = { plu: null };

  const count = await coll.countDocuments(query);

  if (!count) {
    console.log('✅ No expressproducts documents with plu:null found — nothing to do.');
  } else {
    console.log(`⚠️  Found ${count} document(s) with plu explicitly set to null — unsetting the field on all of them...`);
    const res = await coll.updateMany(query, { $unset: { plu: '' } });
    console.log(`\n✅ Unset plu on ${res.modifiedCount} document(s). The Online Catalog "Save All" action should now work without duplicate-key errors.`);
  }

  await mongoose.disconnect();
})().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
