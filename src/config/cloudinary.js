// ============================================
// CLOUDINARY CONFIGURATION — Image Storage
// ============================================
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Product image storage
const productStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'eptomart/products',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
    transformation: [{ width: 800, height: 800, crop: 'limit', quality: 'auto' }],
  },
});

// Category/banner image storage
const categoryStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'eptomart/categories',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
    transformation: [{ width: 400, height: 400, crop: 'fill', quality: 'auto' }],
  },
});

// Upload middleware
const uploadProduct = multer({
  storage: productStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  },
});

const uploadCategory = multer({
  storage: categoryStorage,
  limits: { fileSize: 2 * 1024 * 1024 },
});

// Packaging image storage (seller uploads before AWB)
const packagingStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'eptomart/packaging',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
    transformation: [{ width: 1200, quality: 'auto' }],
  },
});
const uploadPackaging = multer({
  storage: packagingStorage,
  limits: { fileSize: 8 * 1024 * 1024 }, // 8MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Images only'), false);
  },
});

// Document storage (cancelled cheque, agreement PDF)
const documentStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'eptomart/kyc',
    allowed_formats: ['jpg', 'jpeg', 'png', 'pdf'],
    resource_type: 'auto',
  },
});
const uploadDocument = multer({
  storage: documentStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

// Shiprocket bill storage (PDF or image)
const billStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'eptomart/shiprocket-bills',
    allowed_formats: ['jpg', 'jpeg', 'png', 'pdf'],
    resource_type: 'auto',
  },
});
const uploadBill = multer({
  storage: billStorage,
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB — courier bills can be large
  fileFilter: (req, file, cb) => {
    const ok = file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf';
    ok ? cb(null, true) : cb(new Error('Only images or PDF allowed'), false);
  },
});

// Helper to delete image from Cloudinary
const deleteImage = async (publicId, resourceType = 'image') => {
  try {
    await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
  } catch (error) {
    console.error('Cloudinary delete error:', error);
  }
};

// Koyambedu Inventory — purchase bill/receipt storage (optional attachment;
// image or PDF). Separate folder from product images and Shiprocket bills.
const koyambeduPurchaseBillStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'eptomart/koyambedu/purchase-bills',
    allowed_formats: ['jpg', 'jpeg', 'png', 'pdf'],
    resource_type: 'auto',
  },
});
const uploadKoyambeduBill = multer({
  storage: koyambeduPurchaseBillStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

// Koyambedu Fresh produce image storage
const koyambeduStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'eptomart/koyambedu',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
    transformation: [{ width: 800, height: 800, crop: 'limit', quality: 'auto' }],
  },
});
const uploadKoyambedu = multer({
  storage: koyambeduStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed'), false);
  },
});

// Hero video storage (Koyambedu home banner) — mp4/webm up to 50MB.
// This banner is displayed on the home page (highest-traffic page in the
// app) at a small tile size (~165px tall), looping/autoplaying for every
// visitor. Capping width + auto quality/format at upload time means every
// visitor streams a compressed, right-sized file instead of whatever raw
// resolution/bitrate the admin originally uploaded — this is by far the
// single biggest per-asset bandwidth cost in the app if left uncapped.
const heroVideoStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'eptomart/koyambedu/hero',
    resource_type: 'video',
    transformation: [{ width: 720, crop: 'limit', quality: 'auto', fetch_format: 'auto' }],
  },
});
const uploadHeroVideo = multer({
  storage: heroVideoStorage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('video/')) cb(null, true);
    else cb(new Error('Video files only (mp4/webm)'), false);
  },
});

// Fruit Baskets & Hampers — basket listing photos (Super Admin uploads)
const fruitBasketStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'eptomart/fruitbaskets',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
    transformation: [{ width: 800, height: 800, crop: 'limit', quality: 'auto' }],
  },
});
const uploadFruitBasket = multer({
  storage: fruitBasketStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed'), false);
  },
});

// Koyambedu Bulk Harvest — listing photos, up to 5 per listing (Koyambedu admin uploads)
const bulkHarvestStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'eptomart/koyambedu-bulk-harvest',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
    transformation: [{ width: 1000, height: 1000, crop: 'limit', quality: 'auto' }],
  },
});
const uploadBulkHarvest = multer({
  storage: bulkHarvestStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed'), false);
  },
});

// Koyambedu News — one photo per post (Koyambedu admin uploads)
const koyambeduNewsStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'eptomart/koyambedu-news',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
    transformation: [{ width: 1000, height: 1000, crop: 'limit', quality: 'auto' }],
  },
});
const uploadKoyambeduNews = multer({
  storage: koyambeduNewsStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed'), false);
  },
});

module.exports = { cloudinary, uploadProduct, uploadCategory, uploadPackaging, uploadDocument, uploadBill, uploadKoyambedu, uploadKoyambeduBill, uploadHeroVideo, uploadFruitBasket, uploadBulkHarvest, uploadKoyambeduNews, deleteImage };
