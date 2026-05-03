require('dotenv').config();
const mongoose = require('mongoose');

mongoose.connect(process.env.MONGODB_URI).then(async () => {
  const result = await mongoose.connection.collection('products').updateMany(
    {},
    { $set: { freeShippingAbove: 1499 } }
  );
  console.log(`✅ Done — updated ${result.modifiedCount} products to freeShippingAbove: 1499`);
  await mongoose.disconnect();
}).catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
