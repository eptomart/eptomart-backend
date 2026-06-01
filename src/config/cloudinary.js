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

module.exports = { cloudinary, uploadProduct, uploadCategory, uploadPackaging, uploadDocument, uploadBill, uploadKoyambedu, deleteImage };
