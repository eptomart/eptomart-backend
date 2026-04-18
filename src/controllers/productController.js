// ============================================
// PRODUCT CONTROLLER
// ============================================
const Product = require('../models/Product');
const Seller  = require('../models/Seller');
const { deleteImage } = require('../config/cloudinary');

// Helper: get Seller._id from req.user
// User.sellerProfile is already populated by protect middleware — no extra DB query needed
const getSellerDocId = (req) => req.user.sellerProfile || null;

/**
 * @route   GET /api/products
 * @desc    Get all products with filtering, sorting, pagination
 * @access  Public
 */
const getProducts = async (req, res) => {
  const {
    page = 1,
    limit = 12,
    category,
    search,
    minPrice,
    maxPrice,
    sort = '-createdAt',
    featured,
    inStock,
  } = req.query;

  // Show all approved products (including inactive/deactivated seller products — they appear greyed out on frontend)
  const filter = { approvalStatus: 'approved' };

  if (category) filter.category = category;
  if (featured === 'true') filter.isFeatured = true;
  if (inStock === 'true') filter.stock = { $gt: 0 };

  // Price range
  if (minPrice || maxPrice) {
    filter.price = {};
    if (minPrice) filter.price.$gte = Number(minPrice);
    if (maxPrice) filter.price.$lte = Number(maxPrice);
  }

  // Full-text search
  if (search) {
    filter.$text = { $search: search };
  }

  const skip = (Number(page) - 1) * Number(limit);

  const [products, total] = await Promise.all([
    Product.find(filter)
      .populate('category', 'name slug')
      .populate('seller', 'businessName')
      .sort(sort)
      .skip(skip)
      .limit(Number(limit))
      .select('-reviews'),
    Product.countDocuments(filter),
  ]);

  res.json({
    success: true,
    count: products.length,
    total,
    totalPages: Math.ceil(total / Number(limit)),
    currentPage: Number(page),
    products,
  });
};

/**
 * @route   GET /api/products/:slug
 * @desc    Get single product by slug
 * @access  Public
 */
const getProduct = async (req, res) => {
  // Support ?byId=true for seller edit flow (param is an ObjectId, not slug)
  // Allow viewing inactive products so buyers can see a "seller unavailable" banner
  const query = req.query.byId === 'true'
    ? { _id: req.params.slug }
    : { slug: req.params.slug, approvalStatus: 'approved' };

  const product = await Product.findOne(query)
    .populate('category', 'name slug')
    .populate('reviews.user', 'name avatar');

  if (!product) {
    return res.status(404).json({ success: false, message: 'Product not found' });
  }

  res.json({ success: true, product });
};

/**
 * @route   GET /api/products/seller/mine
 * @desc    Get products belonging to logged-in seller
 * @access  Seller
 */
const getSellerProducts = async (req, res) => {
  const { page = 1, limit = 20, approvalStatus } = req.query;

  // Product.seller is a Seller._id, not User._id — sellerProfile is pre-loaded by protect middleware
  const sellerDocId = getSellerDocId(req);
  // Admins/superAdmins have no sellerProfile — return empty list rather than erroring
  if (!sellerDocId) return res.json({ success: true, products: [], total: 0 });

  const filter = { seller: sellerDocId };
  if (approvalStatus) filter.approvalStatus = approvalStatus;

  const [products, total] = await Promise.all([
    Product.find(filter)
      .populate('category', 'name slug')
      .sort('-createdAt')
      .skip((Number(page) - 1) * Number(limit))
      .limit(Number(limit))
      .select('-reviews'),
    Product.countDocuments(filter),
  ]);

  res.json({ success: true, products, total });
};

/**
 * @route   POST /api/products
 * @desc    Create product (Admin or Seller)
 * @access  Admin / Seller
 */
const createProduct = async (req, res) => {
  const {
    name, description, shortDescription, price, discountPrice, stock,
    category, tags, brand, sku, isFeatured, metaTitle, metaDescription,
    gstRate, hsnCode, codAvailable, seller, variants, instagramLink,
    // Seller margin fields
    platformMargin, sellerMargin,
  } = req.body;

  // Handle uploaded images
  const images = req.files?.map((file, index) => ({
    url: file.path,
    publicId: file.filename,
    isDefault: index === 0,
  })) || [];

  // Parse variants if sent as JSON string
  let parsedVariants = [];
  if (variants) {
    parsedVariants = typeof variants === 'string' ? JSON.parse(variants) : variants;
  }

  const productData = {
    name,
    description,
    shortDescription,
    price: Number(price),
    discountPrice: discountPrice ? Number(discountPrice) : undefined,
    stock: Number(stock),
    category,
    images,
    tags: tags ? (Array.isArray(tags) ? tags : tags.split(',').map(t => t.trim())) : [],
    brand,
    sku,
    isFeatured: isFeatured === 'true',
    codAvailable: codAvailable !== 'false',
    metaTitle,
    metaDescription,
    gstRate: gstRate ? Number(gstRate) : 18,
    hsnCode,
    variants: parsedVariants,
  };

  // Seller assignment: sellers are auto-assigned using their Seller document ID
  if (req.user.role === 'seller') {
    const sellerDocId = getSellerDocId(req);
    if (!sellerDocId) return res.status(404).json({ success: false, message: 'Seller profile not found. Contact admin.' });
    productData.seller = sellerDocId;
    productData.approvalStatus = 'pending'; // seller products need admin approval
    productData.isActive = false;           // hidden until approved
  } else if (seller) {
    productData.seller = seller; // admin assigns seller by Seller._id
  }

  // instagramLink — only superAdmin or admin can set
  if (instagramLink && ['admin', 'superAdmin'].includes(req.user.role)) {
    productData.instagramLink = instagramLink;
  }

  // Platform / seller margins (stored for pricing reference)
  if (platformMargin !== undefined) productData.platformMargin = Number(platformMargin);
  if (sellerMargin   !== undefined) productData.sellerMargin   = Number(sellerMargin);

  const product = await Product.create(productData);

  res.status(201).json({ success: true, message: 'Product created successfully', product });
};

/**
 * @route   PUT /api/products/:id
 * @desc    Update product (Admin)
 * @access  Admin
 */
const updateProduct = async (req, res) => {
  let product = await Product.findById(req.params.id);
  if (!product) return res.status(404).json({ success: false, message: 'Product not found' });

  // Seller can only edit their own products — compare using Seller document ID
  if (req.user.role === 'seller') {
    const sellerDocId = getSellerDocId(req);
    if (!sellerDocId || product.seller?.toString() !== sellerDocId.toString()) {
      return res.status(403).json({ success: false, message: 'You can only edit your own products' });
    }
  }

  const updates = { ...req.body };

  // Handle new images
  if (req.files?.length > 0) {
    const newImages = req.files.map((file, index) => ({
      url: file.path,
      publicId: file.filename,
      isDefault: index === 0 && product.images.length === 0,
    }));
    updates.images = [...product.images, ...newImages];
  }

  // Parse tags
  if (updates.tags && typeof updates.tags === 'string') {
    updates.tags = updates.tags.split(',').map(t => t.trim());
  }

  // Parse variants if sent as JSON string
  if (updates.variants && typeof updates.variants === 'string') {
    updates.variants = JSON.parse(updates.variants);
  }

  // instagramLink — only superAdmin or admin can set/update
  if ('instagramLink' in updates && !['admin', 'superAdmin'].includes(req.user.role)) {
    delete updates.instagramLink;
  }

  // Numeric margin fields
  if (updates.platformMargin !== undefined) updates.platformMargin = Number(updates.platformMargin);
  if (updates.sellerMargin   !== undefined) updates.sellerMargin   = Number(updates.sellerMargin);

  product = await Product.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true });

  res.json({ success: true, message: 'Product updated', product });
};

/**
 * @route   DELETE /api/products/:id
 * @desc    Delete product (Admin)
 * @access  Admin
 */
const deleteProduct = async (req, res) => {
  const product = await Product.findById(req.params.id);
  if (!product) return res.status(404).json({ success: false, message: 'Product not found' });

  // Seller can only delete their own products — compare using Seller document ID
  if (req.user.role === 'seller') {
    const sellerDocId = getSellerDocId(req);
    if (!sellerDocId || product.seller?.toString() !== sellerDocId.toString()) {
      return res.status(403).json({ success: false, message: 'You can only delete your own products' });
    }
  }

  // Delete images from Cloudinary
  for (const image of product.images) {
    if (image.publicId) await deleteImage(image.publicId);
  }

  await product.deleteOne();
  res.json({ success: true, message: 'Product deleted' });
};

/**
 * @route   DELETE /api/products/:id/image/:imageId
 * @desc    Remove a specific product image (Admin)
 * @access  Admin
 */
const removeProductImage = async (req, res) => {
  const product = await Product.findById(req.params.id);
  if (!product) return res.status(404).json({ success: false, message: 'Product not found' });

  const image = product.images.find(img => img._id.toString() === req.params.imageId);
  if (image?.publicId) await deleteImage(image.publicId);

  product.images = product.images.filter(img => img._id.toString() !== req.params.imageId);
  await product.save();

  res.json({ success: true, message: 'Image removed', product });
};

/**
 * @route   POST /api/products/:id/review
 * @desc    Add product review
 * @access  Private
 */
const addReview = async (req, res) => {
  const { rating, comment } = req.body;
  const product = await Product.findById(req.params.id);
  if (!product) return res.status(404).json({ success: false, message: 'Product not found' });

  // Check if already reviewed
  const alreadyReviewed = product.reviews.some(r => r.user.toString() === req.user._id.toString());
  if (alreadyReviewed) {
    return res.status(400).json({ success: false, message: 'You already reviewed this product' });
  }

  product.reviews.push({
    user: req.user._id,
    name: req.user.name,
    rating: Number(rating),
    comment,
  });

  product.updateRatings();
  await product.save();

  res.status(201).json({ success: true, message: 'Review added', ratings: product.ratings });
};

/**
 * @route   GET /api/products/search
 * @desc    Search products
 * @access  Public
 */
const searchProducts = async (req, res) => {
  const { q, limit = 10 } = req.query;
  if (!q) return res.json({ success: true, products: [] });

  const products = await Product.find({
    isActive: true,
    approvalStatus: 'approved',
    $or: [
      { name: { $regex: q, $options: 'i' } },
      { tags: { $in: [new RegExp(q, 'i')] } },
      { brand: { $regex: q, $options: 'i' } },
    ],
  })
    .populate('category', 'name')
    .limit(Number(limit))
    .select('name slug price discountPrice images ratings');

  res.json({ success: true, products });
};

module.exports = { getProducts, getProduct, getSellerProducts, createProduct, updateProduct, deleteProduct, removeProductImage, addReview, searchProducts };
