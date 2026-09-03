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

// Security hardening (run: npm install express-mongo-sanitize hpp)
let mongoSanitize, hpp;
try { mongoSanitize = require('express-mongo-sanitize'); } catch (_) {}
try { hpp = require('hpp'); } catch (_) {}

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
const settingsRoutes = require('./src/routes/settings');
const activityRoutes      = require('./src/routes/activity');
const aiRoutes            = require('./src/routes/ai');
const conversationRoutes  = require('./src/routes/conversations');
const uzhavarRoutes       = require('./src/routes/uzhavar');
const koyambeduRoutes     = require('./src/routes/koyambedu');
const fruitBasketRoutes   = require('./src/routes/fruitBasket');
const supplierRoutes      = require('./src/routes/suppliers');
const eptoFreshRoutes     = require('./src/routes/eptoFresh');
const couponRoutes        = require('./src/routes/coupon');
const v2OrderRoutes       = require('./src/routes/v2Orders');   // Unified Orders API (all verticals)
const webhookRoutes       = require('./src/routes/webhook');     // Meta WhatsApp webhook (public)
const searchRoutes        = require('./src/routes/search');      // Unified ecosystem-wide product search
const expressAdminRoutes  = require('./src/routes/expressAdmin'); // Eptomart Express (same-day delivery) — Phase 1: admin only, fully isolated
const expressCustomerRoutes = require('./src/routes/expressCustomer'); // Eptomart Express — Phase 2: customer shopping flow

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
// ─── Helmet — Security Headers ───────────────
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  hsts: { maxAge: 63072000, includeSubDomains: true, preload: true }, // 2 years
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  contentSecurityPolicy: {
    directives: {
      defaultSrc:   ["'self'"],
      scriptSrc:    [
        "'self'", "'unsafe-inline'",          // React SPA requires inline scripts
        'https://fonts.googleapis.com',
        'https://checkout.razorpay.com',       // Razorpay payment modal
        'https://www.googletagmanager.com',    // GA4 (when enabled)
        'https://www.google-analytics.com',
        'https://maps.googleapis.com',         // Google Maps JS API
      ],
      styleSrc:     ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc:      ["'self'", 'https://fonts.gstatic.com'],
      imgSrc:       [
        "'self'", 'data:', 'blob:',
        'https://res.cloudinary.com',
        'https://*.cloudinary.com',
        'https://lh3.googleusercontent.com',   // Firebase / Google login avatars
        'https://maps.googleapis.com',         // Google Maps tiles
        'https://maps.gstatic.com',
        'https://www.google-analytics.com',    // GA4 pixel
        'https://placehold.co',               // dev placeholder images
      ],
      connectSrc:   [
        "'self'",
        'https://www.eptomart.com',
        'https://api.eptomart.com',
        // Render backend (update when you have your Render URL)
        'https://*.onrender.com',
        // Third-party APIs
        'https://checkout.razorpay.com',
        'https://api.razorpay.com',
        'https://lumberjack.razorpay.com',     // Razorpay analytics
        'https://maps.googleapis.com',
        'https://graph.facebook.com',
        'https://www.google-analytics.com',
        'https://www.googletagmanager.com',
        'https://firebase.googleapis.com',
        'https://firebaseinstallations.googleapis.com',
        // Allow localhost in dev
        ...(process.env.NODE_ENV !== 'production' ? ['http://localhost:5000', 'ws://localhost:*'] : []),
      ],
      frameSrc:     [
        "'none'",
        // Note: Razorpay checkout uses an iframe - if payment issues arise uncomment:
        // 'https://checkout.razorpay.com',
        // 'https://api.razorpay.com',
      ],
      objectSrc:    ["'none'"],
      mediaSrc:     ["'self'", 'https://res.cloudinary.com', 'blob:'],
      workerSrc:    ["'self'", 'blob:'],
      manifestSrc:  ["'self'"],
      upgradeInsecureRequests: [],
    },
  },
}));

// ─── Additional Security Headers ─────────────
app.use((req, res, next) => {
  // Permissions Policy — disable unused browser features
  res.setHeader('Permissions-Policy',
    'camera=(), microphone=(), geolocation=(self), payment=(self "https://checkout.razorpay.com"), usb=(), bluetooth=(), serial=()'
  );
  // Cross-domain policy
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  next();
});

// ─── CORS — whitelist only known origins ─────
const ALLOWED_ORIGINS = [
  'https://eptomart.com',
  'https://www.eptomart.com',
  'https://admin.eptomart.com',
  'https://eptomart.in',
  'https://www.eptomart.in',
  ...(process.env.NODE_ENV !== 'production' ? ['http://localhost:5173', 'http://localhost:3000'] : []),
];
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error(`CORS blocked: ${origin}`));
  },
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

// ─── NoSQL injection + HTTP param pollution ──
if (mongoSanitize) app.use(mongoSanitize());
if (hpp) app.use(hpp());

// ─── Logging ─────────────────────────────────
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

// ─── Rate Limiting ────────────────────────────
app.use('/api/', rateLimiter);

// ─── Visitor Tracking ─────────────────────────
app.use('/api/', trackVisitor);

// ─── Digital Asset Links (TWA / Play Store) ───
app.get('/.well-known/assetlinks.json', (req, res) => {
  res.json([{
    relation: ['delegate_permission/common.handle_all_urls'],
    target: {
      namespace: 'android_app',
      package_name: 'com.eptomart.app',
      sha256_cert_fingerprints: [
        '25:A5:7F:30:BA:B7:58:1C:7A:38:41:5E:3D:C0:A4:7A:F9:34:1F:94:94:2C:C1:CC:76:0D:F6:6B:7D:1F:74:FA',
      ],
    },
  }]);
});

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
app.use('/api/settings', settingsRoutes);
app.use('/api/activity',  activityRoutes);
app.use('/api/ai',            aiRoutes);
app.use('/api/conversations', conversationRoutes);
app.use('/api/uzhavar',       uzhavarRoutes);
app.use('/api/koyambedu',     koyambeduRoutes);
app.use('/api/fruitbaskets',  fruitBasketRoutes);
app.use('/api/suppliers',     supplierRoutes);
app.use('/api/eptofresh',     eptoFreshRoutes);
app.use('/api/coupon',       couponRoutes);
app.use('/api/v2/orders',    v2OrderRoutes);   // Unified Orders API (all verticals)
app.use('/api/webhooks',     webhookRoutes);   // Meta WhatsApp inbound webhook (public, no auth)
app.use('/api/search',       searchRoutes);    // Unified ecosystem-wide product search
app.use('/api/express/admin', expressAdminRoutes); // Eptomart Express — Phase 1 admin API
app.use('/api/express',       expressCustomerRoutes); // Eptomart Express — Phase 2 customer API
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

// ─── Uzhavar: Auto-cancel expired orders every 2 min ──────────
const { autoCancelExpired } = require('./src/controllers/uzhavarController');
setInterval(autoCancelExpired, 2 * 60 * 1000);

module.exports = app;
