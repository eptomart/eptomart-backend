// ============================================
// DATABASE SEEDER
// Run: node scripts/seed.js
// Creates: Admin user + sample categories + sample products
// ============================================
require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const User = require('../src/models/User');
const Category = require('../src/models/Category');
const Product = require('../src/models/Product');

const connectDB = async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✅ Connected to MongoDB');
};

// ─── Sample Data ──────────────────────────────

const CATEGORIES = [
  { name: 'Electronics', icon: '📱', description: 'Gadgets, phones, laptops & more' },
  { name: 'Fashion', icon: '👗', description: 'Clothing, shoes & accessories' },
  { name: 'Home & Kitchen', icon: '🏠', description: 'Furniture, appliances & decor' },
  { name: 'Grocery', icon: '🛒', description: 'Daily essentials & food items' },
  { name: 'Books', icon: '📚', description: 'Books, stationery & education' },
  { name: 'Sports', icon: '⚽', description: 'Sports & fitness equipment' },
  { name: 'Beauty', icon: '💄', description: 'Skincare, makeup & personal care' },
  { name: 'Toys', icon: '🎮', description: 'Toys, games & hobbies' },
];

const SAMPLE_PRODUCTS = (categoryIds) => [
  {
    name: 'Wireless Bluetooth Headphones',
    description: 'Premium sound quality with 30-hour battery life, active noise cancellation, and comfortable over-ear design. Compatible with all Bluetooth devices.',
    shortDescription: '30-hour battery | ANC | Premium Sound',
    price: 3999,
    discountPrice: 2499,
    stock: 50,
    category: categoryIds[0], // Electronics
    brand: 'SoundMax',
    tags: ['headphones', 'bluetooth', 'wireless', 'audio'],
    isFeatured: true,
    images: [{ url: 'https://via.placeholder.com/400x400?text=Headphones', isDefault: true }],
  },
  {
    name: 'Men\'s Cotton Casual T-Shirt',
    description: '100% pure cotton premium t-shirt. Soft, breathable, and perfect for casual wear. Available in multiple colors.',
    shortDescription: '100% Cotton | Comfortable | Casual Fit',
    price: 699,
    discountPrice: 449,
    stock: 200,
    category: categoryIds[1], // Fashion
    brand: 'ComfyCo',
    tags: ['tshirt', 'cotton', 'casual', 'men'],
    isFeatured: true,
    images: [{ url: 'https://via.placeholder.com/400x400?text=T-Shirt', isDefault: true }],
  },
  {
    name: 'Stainless Steel Water Bottle 1L',
    description: 'BPA-free double-walled stainless steel water bottle. Keeps drinks cold for 24 hours, hot for 12 hours. Perfect for gym, office, and travel.',
    shortDescription: '1 Litre | Double Wall | Hot & Cold',
    price: 899,
    discountPrice: 599,
    stock: 150,
    category: categoryIds[2], // Home
    brand: 'AquaPure',
    tags: ['bottle', 'steel', 'gym', 'water bottle'],
    isFeatured: true,
    images: [{ url: 'https://via.placeholder.com/400x400?text=Water+Bottle', isDefault: true }],
  },
  {
    name: 'Premium Basmati Rice 5kg',
    description: 'Extra long grain premium basmati rice from the fertile plains of Punjab. Aromatic, non-sticky, and perfect for biryani, pulao, and everyday meals.',
    shortDescription: '5 Kg | Extra Long Grain | Aromatic',
    price: 750,
    discountPrice: 649,
    stock: 100,
    category: categoryIds[3], // Grocery
    brand: 'India Gate',
    tags: ['rice', 'basmati', 'grocery', 'food'],
    isFeatured: false,
    images: [{ url: 'https://via.placeholder.com/400x400?text=Basmati+Rice', isDefault: true }],
  },
  {
    name: 'Yoga Mat with Carrying Strap',
    description: 'Premium non-slip yoga mat with alignment lines. 6mm thick for optimal cushioning and joint protection. Eco-friendly TPE material.',
    shortDescription: '6mm Thick | Non-Slip | Eco-Friendly TPE',
    price: 1299,
    discountPrice: 899,
    stock: 75,
    category: categoryIds[5], // Sports
    brand: 'FitLife',
    tags: ['yoga', 'mat', 'fitness', 'exercise'],
    isFeatured: true,
    images: [{ url: 'https://via.placeholder.com/400x400?text=Yoga+Mat', isDefault: true }],
  },
  {
    name: 'Smart LED Desk Lamp',
    description: 'Adjustable 5 color modes and 5 brightness levels. Built-in USB charging port. Memory function remembers last settings. Eye-care technology reduces eye strain.',
    shortDescription: '5 Color Modes | USB Charging | Memory Function',
    price: 1599,
    discountPrice: 1199,
    stock: 60,
    category: categoryIds[2], // Home
    brand: 'BrightHome',
    tags: ['lamp', 'desk lamp', 'LED', 'smart'],
    isFeatured: false,
    images: [{ url: 'https://via.placeholder.com/400x400?text=Desk+Lamp', isDefault: true }],
  },
  {
    name: 'Vitamin C Face Serum 30ml',
    description: 'Advanced brightening serum with 15% Vitamin C, Hyaluronic Acid, and Niacinamide. Reduces dark spots, improves skin texture, and provides antioxidant protection.',
    shortDescription: '15% Vitamin C | Anti-aging | Brightening',
    price: 999,
    discountPrice: 749,
    stock: 120,
    category: categoryIds[6], // Beauty
    brand: 'GlowCare',
    tags: ['serum', 'vitamin c', 'skincare', 'face'],
    isFeatured: true,
    images: [{ url: 'https://via.placeholder.com/400x400?text=Face+Serum', isDefault: true }],
  },
  {
    name: 'Mechanical Keyboard TKL',
    description: 'Tenkeyless mechanical keyboard with Blue switches. RGB backlighting, PBT keycaps, and sturdy metal frame. Compatible with Windows/Mac.',
    shortDescription: 'TKL | RGB | Blue Switches | PBT Keycaps',
    price: 4999,
    discountPrice: 3799,
    stock: 30,
    category: categoryIds[0], // Electronics
    brand: 'KeyMaster',
    tags: ['keyboard', 'mechanical', 'RGB', 'gaming'],
    isFeatured: false,
    images: [{ url: 'https://via.placeholder.com/400x400?text=Keyboard', isDefault: true }],
  },
];

// ─── Seed Functions ───────────────────────────

const seedAdmin = async () => {
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@eptomart.com';
  const existing = await User.findOne({ email: adminEmail });

  if (existing) {
    if (existing.role !== 'admin') {
      existing.role = 'admin';
      await existing.save();
      console.log(`✅ Updated "${adminEmail}" to admin`);
    } else {
      console.log(`ℹ️  Admin "${adminEmail}" already exists`);
    }
    return existing;
  }

  const admin = await User.create({
    name: 'Eptomart Admin',
    email: adminEmail,
    role: 'admin',
    isVerified: true,
    isActive: true,
  });

  console.log(`✅ Admin created: ${adminEmail}`);
  console.log(`   Login with OTP to: ${adminEmail}`);
  return admin;
};

const seedCategories = async () => {
  const existing = await Category.countDocuments();
  if (existing > 0) {
    console.log(`ℹ️  ${existing} categories already exist. Skipping.`);
    return await Category.find({}).sort('name');
  }

  const created = await Category.insertMany(CATEGORIES);
  console.log(`✅ ${created.length} categories created`);
  return created;
};

const seedProducts = async (categories) => {
  const existing = await Product.countDocuments();
  if (existing > 0) {
    console.log(`ℹ️  ${existing} products already exist. Skipping.`);
    return;
  }

  const categoryIds = categories.map(c => c._id);
  const products = SAMPLE_PRODUCTS(categoryIds);
  await Product.insertMany(products);
  console.log(`✅ ${products.length} sample products created`);
};

// ─── Main Seeder ──────────────────────────────
const seed = async () => {
  try {
    await connectDB();

    console.log('\n🌱 Starting Eptomart Database Seeder...\n');

    const admin = await seedAdmin();
    const categories = await seedCategories();
    await seedProducts(categories);

    console.log('\n🎉 Seeding complete!\n');
    console.log('─────────────────────────────────────');
    console.log('✅ What was created:');
    console.log(`   • Admin: ${process.env.ADMIN_EMAIL || 'admin@eptomart.com'}`);
    console.log(`   • ${(await Category.countDocuments())} categories`);
    console.log(`   • ${(await Product.countDocuments())} products`);
    console.log('─────────────────────────────────────');
    console.log('🚀 Next steps:');
    console.log('   1. Start the server: npm run dev');
    console.log('   2. Go to: http://localhost:5173');
    console.log('   3. Login as admin: http://localhost:5173/login');
    console.log(`      Use email: ${process.env.ADMIN_EMAIL || 'admin@eptomart.com'}`);
    console.log('   4. Check OTP in your email\n');

  } catch (error) {
    console.error('❌ Seeding failed:', error.message);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
    process.exit(0);
  }
};

seed();
