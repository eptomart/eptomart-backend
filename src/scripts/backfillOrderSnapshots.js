// ============================================
// BACKFILL ORDER SNAPSHOTS (Stage B)
//
// Copies items → itemsOrdered for existing orders
// in Order, EptoFreshOrder, and UzhavarOrder that
// were placed before immutable snapshots existed.
// (KoyambeduOrder already has snapshots.)
//
// Safe to run multiple times — orders that already
// have a snapshot are never touched.
//
// Usage:
//   node src/scripts/backfillOrderSnapshots.js          (dry run)
//   node src/scripts/backfillOrderSnapshots.js --apply  (write)
// ============================================
require('dotenv').config();
const mongoose = require('mongoose');
const Order          = require('../models/Order');
const EptoFreshOrder = require('../models/EptoFreshOrder');
const UzhavarOrder   = require('../models/UzhavarOrder');

const APPLY = process.argv.includes('--apply');

const MAPPERS = {
  Order: (it) => ({
    product:    it.product,
    name:       it.name,
    orderedQty: it.quantity,
    unitPrice:  it.price,
    lineTotal:  (it.price || 0) * (it.quantity || 0),
  }),
  EptoFreshOrder: (it) => ({
    product:    it.product,
    name:       it.productName,
    orderedQty: it.quantity,
    unitPrice:  it.unitPrice ?? it.variant?.price ?? 0,
    lineTotal:  it.totalPrice ?? (it.unitPrice || 0) * (it.quantity || 0),
  }),
  UzhavarOrder: (it) => ({
    product:    it.product,
    name:       it.name,
    unit:       it.unit,
    orderedQty: it.quantity,
    unitPrice:  it.pricePerUnit,
    lineTotal:  it.lineTotal ?? (it.pricePerUnit || 0) * (it.quantity || 0),
  }),
};

async function backfill(Model, name) {
  const filter = {
    $and: [
      { items: { $exists: true, $ne: [] } },
      { $or: [{ itemsOrdered: { $exists: false } }, { itemsOrdered: { $size: 0 } }] },
    ],
  };
  const total = await Model.countDocuments(filter);
  console.log(`${name}: ${total} orders need snapshots`);
  if (!APPLY || total === 0) return { total, updated: 0 };

  let updated = 0;
  const cursor = Model.find(filter).cursor();
  for (let doc = await cursor.next(); doc != null; doc = await cursor.next()) {
    const snapshot = (doc.items || []).map(MAPPERS[name]);
    // updateOne — avoids pre-save hooks & other side effects
    await Model.updateOne(
      { _id: doc._id, $or: [{ itemsOrdered: { $exists: false } }, { itemsOrdered: { $size: 0 } }] },
      { $set: { itemsOrdered: snapshot } },
    );
    updated++;
    if (updated % 100 === 0) console.log(`  …${updated}/${total}`);
  }
  console.log(`  ✅ ${name}: ${updated} orders backfilled`);
  return { total, updated };
}

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log(`✅ Connected to MongoDB — ${APPLY ? 'APPLY mode' : 'DRY RUN (pass --apply to write)'}\n`);

  await backfill(Order, 'Order');
  await backfill(EptoFreshOrder, 'EptoFreshOrder');
  await backfill(UzhavarOrder, 'UzhavarOrder');

  await mongoose.disconnect();
  console.log('\nDone.');
}

run().catch(err => { console.error(err); process.exit(1); });
