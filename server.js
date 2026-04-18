// ============================================
// EPTOMART — Main Server Entry Point
// ============================================
require('dotenv').config();
require('express-async-errors');

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const path = require('path');

const connectDB = require('./src/config/db');
const { rateLimiter } = require('./src/middleware/rateLimiter');
const { trackVisitor } = require('./src/middleware/trackVisitor');

// Route imports
const authRoutes = require('./src/routes/auth');
const productRoutes = require('./src/routes/products');
const orderRoutes = require('./src/routes/orders');
const adminRoutes = require('./src/routes/admin');
const analyticsRoutes = require('./src/routes/analytics');
const paymentRoutes = require('./src/routes/payment');
const categoryRoutes = require('./src/routes/categories');
const notificationRoutes = require('./src/routes/notifications');
const wishlistRoutes = require('./src/routes/wishlist');
const bulkImportRoutes = require('./src/routes/bulkImport');
const sellerRoutes   = require('./src/routes/sellers');
const approvalRoutes = require('./src/routes/approvals');
const deliveryRoutes = require('./src/routes/delivery');
const invoiceRoutes  = require('./src/routes/invoices');
const expenseRoutes  = require('./src/routes/expenses');
const cartRoutes     = require('./src/routes/cart');
const sitemapRoutes  = require('./src/routes/sitemap');

const app = express();

// ─── Trust Proxy (required for Render/Vercel/Nginx deployments) ──
app.set('trust proxy', 1);

// ─── Connect to Database + Auto-seed ─────────
const autoSeed = async () => {
  try {
    const ExpenseCategory = require('./src/models/ExpenseCategory');
    const count = await ExpenseCategory.countDocuments();
    if (count === 0) {
      const defaults = [
        { name: 'Client Visit',        icon: '🤝', isDefault: true },
        { name: 'Website Maintenance', icon: '💻', isDefault: true },
        { name: 'Office Supplies',     icon: '📦', isDefault: true },
        { name: 'Marketing',           icon: '📢', isDefault: true },
        { name: 'Logistics',           icon: '🚚', isDefault: true },
        { name: 'Miscellaneous',       icon: '💰', isDefault: true },
        { name: 'Rent & Utilities',    icon: '🏢', isDefault: true },
        { name: 'Travel',              icon: '✈️',  isDefault: true },
      ];
      await ExpenseCategory.insertMany(defaults);
      console.log('🌱 Expense categories seeded');
    }
    // Mark all legacy products without approvalStatus as approved
    const Product = require('./src/models/Product');
    const updated = await Product.updateMany(
      { approvalStatus: { $exists: false } },
      { $set: { approvalStatus: 'approved', gstRate: 18, priceIncludesGst: true } }
    );
    if (updated.modifiedCount > 0) {
      console.log(`🌱 Migrated ${updated.modifiedCount} legacy products → approvalStatus: approved`);
    }
  } catch (err) {
    console.error('⚠️ Auto-seed error (non-fatal):', err.message);
  }
};

connectDB().then(autoSeed).catch(() => {});

// ─── Security Middleware ──────────────────────
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));

// ─── CORS Configuration ───────────────────────
app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-session-id'],
  exposedHeaders: ['Content-Disposition', 'Content-Type'],
}));

// ─── General Middleware ───────────────────────
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// ─── Logging ─────────────────────────────────
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

// ─── Rate Limiting ────────────────────────────
app.use('/api/', rateLimiter);

// ─── Visitor Tracking ─────────────────────────
app.use('/api/', trackVisitor);

// ─── API Routes ───────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/wishlist', wishlistRoutes);
app.use('/api/bulk', bulkImportRoutes);
app.use('/api/sellers',   sellerRoutes);
app.use('/api/approvals', approvalRoutes);
app.use('/api/delivery',  deliveryRoutes);
app.use('/api/invoices',  invoiceRoutes);
app.use('/api/expenses',  expenseRoutes);
app.use('/api/cart',      cartRoutes);
app.use('/',             sitemapRoutes);  // /sitemap.xml and /robots.txt

// ─── Health Check ────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    app: 'Eptomart API',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV
  });
});

// ─── 404 Handler ─────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.originalUrl} not found`
  });
});

// ─── Global Error Handler ─────────────────────
app.use((err, req, res, next) => {
  console.error('❌ Error:', err.stack);

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    const messages = Object.values(err.errors).map(e => e.message);
    return res.status(400).json({ success: false, message: messages.join(', ') });
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({ success: false, message: 'Invalid token' });
  }
  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({ success: false, message: 'Token expired' });
  }

  // Duplicate key error
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue)[0];
    return res.status(400).json({ success: false, message: `${field} already exists` });
  }

  res.status(err.statusCode || 500).json({
    success: false,
    message: err.message || 'Internal Server Error'
  });
});

// ─── Start Server ─────────────────────────────
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`\n🚀 Eptomart API running on port ${PORT}`);
  console.log(`📦 Environment: ${process.env.NODE_ENV}`);
  console.log(`🌐 URL: http://localhost:${PORT}/api/health\n`);
});

module.exports = app;
