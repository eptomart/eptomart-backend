// ============================================
// Reset demo account to first-time state
// Usage: node scripts/resetDemoAccount.js
// ============================================
require('dotenv').config();
const mongoose = require('mongoose');

const DEMO_EMAIL = process.env.DEMO_EMAIL || 'eptosicare@gmail.com';

async function reset() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB');

  const User    = require('../src/models/User');
  const Cart    = require('../src/models/Cart');
  const Order   = require('../src/models/Order');

  const user = await User.findOne({ email: DEMO_EMAIL });
  if (!user) { console.log('Demo user not found'); process.exit(1); }

  console.log(`Resetting demo account: ${DEMO_EMAIL} (${user._id})`);

  // 1. Clear addresses, wishlist, login history
  user.addresses    = [];
  user.wishlist     = [];
  user.loginHistory = [];
  user.name         = 'Demo User';
  user.firstName    = 'Demo';
  user.lastName     = 'User';
  user.avatar       = undefined;
  await user.save();
  console.log('✅ User profile reset');

  // 2. Clear cart
  await Cart.deleteMany({ user: user._id });
  console.log('✅ Cart cleared');

  // 3. Clear orders
  const { deletedCount } = await Order.deleteMany({ buyer: user._id });
  console.log(`✅ Orders cleared (${deletedCount} deleted)`);

  // 4. Clear Koyambedu cart & orders if models exist
  try {
    const KoyambeduCart  = require('../src/models/KoyambeduCart');
    const KoyambeduOrder = require('../src/models/KoyambeduOrder');
    await KoyambeduCart.deleteMany({ user: user._id });
    const { deletedCount: kd } = await KoyambeduOrder.deleteMany({ buyer: user._id });
    console.log(`✅ Koyambedu cart & orders cleared (${kd} orders)`);
  } catch (e) {
    console.log('ℹ️  Koyambedu models not found, skipping');
  }

  // 5. Clear Uzhavar orders if model exists
  try {
    const UzhavarOrder = require('../src/models/UzhavarOrder');
    const { deletedCount: ud } = await UzhavarOrder.deleteMany({ buyer: user._id });
    console.log(`✅ Uzhavar orders cleared (${ud} deleted)`);
  } catch (e) {
    console.log('ℹ️  UzhavarOrder model not found, skipping');
  }

  console.log('\n🎉 Demo account reset complete — ready for App Store review!');
  await mongoose.disconnect();
}

reset().catch(err => { console.error(err); process.exit(1); });
