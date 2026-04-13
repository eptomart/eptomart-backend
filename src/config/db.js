// ============================================
// DATABASE CONNECTION — MongoDB Atlas
// ============================================
const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI, {
      // These options are defaults in Mongoose 8+, kept for clarity
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });

    console.log(`✅ MongoDB Connected: ${conn.connection.host}`);

    // Handle connection events
    mongoose.connection.on('disconnected', () => {
      console.log('⚠️  MongoDB disconnected. Reconnecting...');
    });

    mongoose.connection.on('error', (err) => {
      console.error('❌ MongoDB error:', err);
    });

  } catch (error) {
    console.error('❌ MongoDB connection failed:', error.message);
    console.error('💡 Check your MONGODB_URI in .env file');
    process.exit(1);
  }
};

module.exports = connectDB;
