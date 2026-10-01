// ============================================================
// One-off cleanup: the Online Catalog "Save All" bug (fixed in
// expressAdminController.js upsertOnlineListing — missing $set wrapper)
// could have silently stripped the required `store`/`koyambeduProduct`
// fields off an EXISTING expressonlinelistings document whenever that
// document was re-saved, before erroring out on a later item in the same
// batch. This finds and removes any such corrupted documents.
//
// Safe to run: a missing/deleted document here is identical in effect to
// isEnabled:false (nothing shown in the Express online shop) — exactly the
// same as before that product/store pair was ever saved. No real data is
// lost; the admin just re-ticks "Online" + re-enters the price for any
// genuinely-affected store/product next time they open the tab.
//
// mongosh isn't installed on this machine, so this does the job with plain
// Node + mongoose (already a project dependency) — reads MONGODB_URI from
// the backend's own .env, exactly like scripts/findStuckOrder.js.
//
// USAGE (from the eptomart-backend folder):
//   node scripts/fixCorruptedOnlineListings.js
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
  console.log('Connected. Checking expressonlinelistings for corrupted documents...\n');

  const coll = mongoose.connection.db.collection('expressonlinelistings');
  const query = {
    $or: [
      { store: { $exists: false } },
      { store: null },
      { koyambeduProduct: { $exists: false } },
      { koyambeduProduct: null },
    ],
  };

  const bad = await coll.find(query).toArray();

  if (!bad.length) {
    console.log('✅ No corrupted expressonlinelistings documents found — nothing to do.');
  } else {
    console.log(`⚠️  Found ${bad.length} corrupted document(s):`);
    bad.forEach(d => console.log(JSON.stringify(d, null, 2)));

    const res = await coll.deleteMany(query);
    console.log(`\n🗑️  Deleted ${res.deletedCount} corrupted document(s). Re-tick + save those products in the Online Catalog tab to restore them.`);
  }

  await mongoose.disconnect();
})().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
