// ============================================================
// One-off diagnostic: find the ₹1,792 order (Fri Sep 11, ~8:44-8:47pm)
// across every vertical, by its Razorpay IDs and by the customer's phone.
//
// mongosh isn't installed on this machine, so this does the same job with
// plain Node + mongoose (already a project dependency) — reads MONGODB_URI
// from the backend's own .env, exactly like the other scripts/ one-offs.
//
// USAGE (from the eptomart-backend folder):
//   node scripts/findStuckOrder.js
// ============================================================
require('dotenv').config();
const mongoose = require('mongoose');

const RZP_ORDER_ID   = 'order_Tam8CXl8QELVSI';
const RZP_PAYMENT_ID = 'pay_Tam8wBXxF0x4lI';
const PHONE          = '9841581161';

const CHECKS = [
  { coll: 'koyambeduorders', q: { $or: [
      { 'paymentDetails.razorpayOrderId': RZP_ORDER_ID },
      { 'paymentDetails.razorpayPaymentId': RZP_PAYMENT_ID },
      { 'shippingAddress.phone': { $regex: PHONE } },
      // "Add More Items" top-ups on an ALREADY-placed order store their own
      // separate Razorpay IDs nested per-amendment, not at paymentDetails —
      // easy to miss if this was a top-up payment rather than a fresh order.
      { 'amendments.razorpayOrderId': RZP_ORDER_ID },
      { 'amendments.razorpayPaymentId': RZP_PAYMENT_ID },
  ] } },
  { coll: 'orders', q: { $or: [
      { 'paymentDetails.gatewayOrderId': RZP_ORDER_ID },
      { 'paymentDetails.transactionId': RZP_PAYMENT_ID },
  ] } },
  { coll: 'eptofreshorders', q: { $or: [
      { 'paymentDetails.razorpayOrderId': RZP_ORDER_ID },
      { 'paymentDetails.razorpayPaymentId': RZP_PAYMENT_ID },
  ] } },
  { coll: 'expressorders', q: { $or: [
      { razorpayOrderId: RZP_ORDER_ID },
      { razorpayPaymentId: RZP_PAYMENT_ID },
  ] } },
  { coll: 'fruitbasketorders', q: { $or: [
      { razorpayOrderId: RZP_ORDER_ID },
      { razorpayPaymentId: RZP_PAYMENT_ID },
  ] } },
  { coll: 'uzhavarorders', q: { $or: [
      { razorpayOrderId: RZP_ORDER_ID },
      { razorpayPaymentId: RZP_PAYMENT_ID },
  ] } },
];

(async () => {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    console.error('❌ No MONGODB_URI (or MONGO_URI) found in .env — run this from the eptomart-backend folder, or paste your Atlas connection string as an env var, e.g.:\n   MONGODB_URI="mongodb+srv://..." node scripts/findStuckOrder.js');
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log('Connected. Searching', CHECKS.length, 'collections...\n');

  let foundAny = false;
  for (const { coll, q } of CHECKS) {
    const results = await mongoose.connection.db.collection(coll).find(q).toArray();
    if (results.length) {
      foundAny = true;
      console.log(`✅ FOUND in "${coll}" (${results.length} match):`);
      results.forEach(r => console.log(JSON.stringify(r, null, 2)));
    } else {
      console.log(`— nothing in "${coll}"`);
    }
  }

  if (!foundAny) {
    console.log('\n⚠️  No order document anywhere references this Razorpay order/payment ID or phone number.');
    console.log('This means an order document was never saved for this payment at all — Razorpay');
    console.log('captured the money, but our backend never got as far as creating the order record.');
    console.log('Trying a broad date-range scan across ALL order collections instead (8:15–9:05pm IST today)...\n');

    const start = new Date('2026-09-11T14:45:00.000Z'); // 8:15pm IST
    const end   = new Date('2026-09-11T15:35:00.000Z'); // 9:05pm IST
    let anyByDate = false;
    for (const coll of ['koyambeduorders', 'orders', 'eptofreshorders', 'expressorders', 'fruitbasketorders', 'uzhavarorders']) {
      const byDate = await mongoose.connection.db.collection(coll)
        .find({ createdAt: { $gte: start, $lte: end } }).toArray();
      if (byDate.length) {
        anyByDate = true;
        console.log(`Found ${byDate.length} in "${coll}" created 8:15–9:05pm IST:`);
        byDate.forEach(r => console.log(JSON.stringify(r, null, 2)));
      } else {
        console.log(`— nothing in "${coll}" in that window`);
      }
    }
    if (!anyByDate) {
      console.log('\nNothing in ANY collection in that window either — widen the range further if needed,');
      console.log('or double check the server\'s clock / timezone matches what Razorpay displayed.');
    }
  }

  await mongoose.disconnect();
})().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
