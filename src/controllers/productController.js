// ============================================
// PRODUCT CONTROLLER
// ============================================
const Product  = require('../models/Product');
const Seller   = require('../models/Seller');
const Category = require('../models/Category');
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
    subCategory,
    search,
    minPrice,
    maxPrice,
    sort = '-createdAt',
    featured,
    inStock,
  } = req.query;

  // Show all approved products (including inactive/deactivated seller products — they appear greyed out on frontend)
  const filter = { approvalStatus: 'approved' };

  if (subCategory) {
    filter.subCategory = subCategory; // subcategory filter takes precedence
  } else if (category) {
    filter.category = category;
  }
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
      .populate('category', 'name slug').populate('subCategory', 'name slug')
      .populate('seller', 'businessName sellerId')
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
    .populate('subCategory', 'name slug')
    .populate('seller', 'businessName sellerId address status')
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
      .populate('category', 'name slug').populate('subCategory', 'name slug')
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
    category, subCategory, tags, brand, sku, isFeatured, metaTitle, metaDescription,
    gstRate, hsnCode, codAvailable, priceIncludesGst, seller, variants, instagramLink,
    location,
    // Seller margin fields
    platformMargin, sellerMargin,
    costPrice, sellerPrice, eptomartMargin,
    freeShippingAbove,
  } = req.body;

  // Handle uploaded images
  const images = req.files?.map((file, index) => ({
    url: file.path,
    publicId: file.filename,
    isDefault: index === 0,
  })) || [];

  // Parse variants if sent as JSON string (strip any _id)
  let parsedVariants = [];
  if (variants) {
    const raw = typeof variants === 'string' ? JSON.parse(variants) : variants;
    parsedVariants = raw.map(({ _id, ...v }) => v);
  }

  // Parse location if sent as JSON string
  let parsedLocation;
  if (location) {
    try { parsedLocation = typeof location === 'string' ? JSON.parse(location) : location; } catch (_) {}
  }

  const productData = {
    name,
    description,
    shortDescription,
    price: Number(price),
    discountPrice: discountPrice ? Number(discountPrice) : undefined,
    stock: Number(stock),
    category,
    subCategory: subCategory || undefined,
    location: parsedLocation,
    costPrice: costPrice ? Number(costPrice) : undefined,
    sellerPrice: sellerPrice ? Number(sellerPrice) : undefined,
    eptomartMargin: eptomartMargin !== undefined && eptomartMargin !== '' ? Number(eptomartMargin) : undefined,
    freeShippingAbove: freeShippingAbove ? Number(freeShippingAbove) : 499,
    images,
    tags: tags ? (Array.isArray(tags) ? tags : tags.split(',').map(t => t.trim())) : [],
    brand,
    sku,
    isFeatured: isFeatured === 'true',
    codAvailable: codAvailable !== 'false',
    priceIncludesGst: priceIncludesGst !== 'false',
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
  } else if (['admin', 'superAdmin'].includes(req.user.role)) {
    // Admin-created products are immediately active and approved
    if (seller) productData.seller = seller;
    productData.approvalStatus = 'approved';
    productData.isActive = true;
  }

  // instagramLink — only superAdmin or admin can set
  if (instagramLink && ['admin', 'superAdmin'].includes(req.user.role)) {
    productData.instagramLink = instagramLink;
  }

  // Platform / seller margins (stored for pricing reference)
  if (platformMargin !== undefined) productData.platformMargin = Number(platformMargin);
  if (sellerMargin   !== undefined) productData.sellerMargin   = Number(sellerMargin);

  // FSSAI check: if category requires FSSAI, seller must have it on file
  if (category) {
    const cat = await Category.findById(category).lean();
    if (cat?.requiresFSSAI) {
      let sellerDoc = null;
      if (req.user.role === 'seller') {
        sellerDoc = await Seller.findById(getSellerDocId(req)).lean();
      } else if (productData.seller) {
        sellerDoc = await Seller.findById(productData.seller).lean();
      }
      if (!sellerDoc?.fssaiLicenseNumber) {
        return res.status(400).json({
          success: false,
          message: 'FSSAI license number is mandatory for food/beverage products. Please update your seller profile with your FSSAI license before listing this product.',
          requiresFSSAI: true,
        });
      }
    }
  }

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

  // Parse variants if sent as JSON string (strip any _id so Mongoose adds fresh ones)
  if (updates.variants && typeof updates.variants === 'string') {
    updates.variants = JSON.parse(updates.variants).map(({ _id, ...v }) => v);
  }

  // Parse location if sent as JSON string
  if (updates.location && typeof updates.location === 'string') {
    try { updates.location = JSON.parse(updates.location); } catch (_) {}
  }

  // instagramLink — only superAdmin or admin can set/update
  if ('instagramLink' in updates && !['admin', 'superAdmin'].includes(req.user.role)) {
    delete updates.instagramLink;
  }

  // Numeric fields — FormData sends everything as strings, convert explicitly
  const numericFields = ['price', 'discountPrice', 'stock', 'gstRate', 'costPrice',
                         'sellerPrice', 'eptomartMargin', 'platformMargin', 'sellerMargin', 'freeShippingAbove'];
  numericFields.forEach(f => {
    if (updates[f] !== undefined && updates[f] !== '') updates[f] = Number(updates[f]);
  });

  // Admin/superAdmin saving a product always marks it active (undoes any deactivation)
  if (['admin', 'superAdmin'].includes(req.user.role)) {
    updates.isActive = true;
    updates.approvalStatus = 'approved';
  }

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
 * @desc    Remove a specific product image (admin or owning seller)
 * @access  Seller (own product) | Admin
 */
const removeProductImage = async (req, res) => {
  const product = await Product.findById(req.params.id);
  if (!product) return res.status(404).json({ success: false, message: 'Product not found' });

  // Sellers can only remove images from their own products
  if (!['admin', 'superAdmin'].includes(req.user?.role)) {
    const sellerDocId = getSellerDocId(req);
    if (!sellerDocId || product.seller?.toString() !== sellerDocId.toString()) {
      return res.status(403).json({ success: false, message: 'You can only edit your own products' });
    }
  }

  const image = product.images.find(img => img._id.toString() === req.params.imageId);
  if (!image) return res.status(404).json({ success: false, message: 'Image not found' });

  if (image.publicId) await deleteImage(image.publicId);

  product.images = product.images.filter(img => img._id.toString() !== req.params.imageId);

  // If the removed image was the default, promote first remaining as default
  const hasDefault = product.images.some(img => img.isDefault);
  if (!hasDefault && product.images.length > 0) product.images[0].isDefault = true;

  await product.save();
  res.json({ success: true, message: 'Image removed', images: product.images });
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
    .populate('category', 'name').populate('subCategory', 'name')
    .limit(Number(limit))
    .select('name slug price discountPrice images ratings');

  res.json({ success: true, products });
};

/**
 * @route   GET /api/products/admin/all
 * @desc    Get ALL products for super admin (all statuses, all sellers, no filters stripped)
 * @access  Admin / SuperAdmin
 */
const getAdminProducts = async (req, res) => {
  const { page = 1, limit = 20, search, approvalStatus, seller, isActive } = req.query;
  const filter = {};

  if (approvalStatus) filter.approvalStatus = approvalStatus;
  if (seller)         filter.seller         = seller;
  if (isActive !== undefined) filter.isActive = isActive === 'true';

  if (search) {
    filter.$or = [
      { name:  { $regex: search, $options: 'i' } },
      { brand: { $regex: search, $options: 'i' } },
    ];
  }

  const skip = (Number(page) - 1) * Number(limit);
  const [products, total] = await Promise.all([
    Product.find(filter)
      .populate('category', 'name').populate('subCategory', 'name')
      .populate('seller', 'businessName sellerId status')
      .sort('-createdAt')
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
 * @route   POST /api/products/:id/clone
 * @desc    Clone a product (creates a draft copy)
 * @access  Seller / Admin
 */
const cloneProduct = async (req, res) => {
  const source = await Product.findById(req.params.id).lean();
  if (!source) return res.status(404).json({ success: false, message: 'Product not found' });

  // Sellers can only clone their own products
  if (req.user.role === 'seller') {
    const sellerDocId = getSellerDocId(req);
    if (!sellerDocId || source.seller?.toString() !== sellerDocId.toString()) {
      return res.status(403).json({ success: false, message: 'You can only clone your own products' });
    }
  }

  // Build clone — strip unique fields, reset approval
  // productCode is intentionally excluded so assignProductCode gives it a fresh name-based code on approval
  const { _id, slug, sku, productCode, createdAt, updatedAt, __v, soldCount, likeCount, repeatBuyerCount, reviews, ratings, ...rest } = source;
  const clone = await Product.create({
    ...rest,
    name: `${source.name} (Copy)`,
    approvalStatus: 'draft',
    isActive: false,
    productCode: null,       // will be assigned (from seller's name code) when approved
    images: source.images,   // reuse same Cloudinary URLs (no re-upload needed)
  });

  res.status(201).json({ success: true, message: 'Product cloned as draft', product: clone });
};

/**
 * @route   GET /api/products/:id/preview
 * @desc    Preview any product by ID (seller/admin can preview drafts/pending)
 * @access  Seller / Admin
 */
const previewProduct = async (req, res) => {
  const product = await Product.findById(req.params.id)
    .populate('category', 'name slug').populate('subCategory', 'name slug')
    .populate('seller', 'businessName sellerId');

  if (!product) return res.status(404).json({ success: false, message: 'Product not found' });

  // Sellers can only preview their own products
  if (req.user.role === 'seller') {
    const sellerDocId = getSellerDocId(req);
    if (!sellerDocId || product.seller?._id?.toString() !== sellerDocId.toString()) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }
  }

  res.json({ success: true, product });
};

// ── Toggle product active / inactive (admin only) ────────────────────────────
const toggleProductActive = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ success: false, message: 'Product not found' });

    product.isActive = !product.isActive;
    await product.save();

    res.json({
      success: true,
      isActive: product.isActive,
      message: product.isActive ? 'Product activated' : 'Product deactivated',
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * @route   POST /api/products/bulk-stock
 * @desc    Bulk update product stock from CSV data
 *          Accepts rows with: sku OR product_code (either works as identifier)
 *          Optional: price, discount_price (admin only)
 * @access  Seller / Admin
 */
const bulkUpdateStock = async (req, res) => {
  try {
    const { updates } = req.body;

    if (!Array.isArray(updates) || updates.length === 0) {
      return res.status(400).json({ success: false, message: 'updates must be a non-empty array' });
    }

    let updated = 0;
    let skipped = 0;
    const errors  = [];
    const results = [];

    for (let i = 0; i < updates.length; i++) {
      const item = updates[i];
      // Support: sku, product_code (aliases: productCode, code)
      const identifier = (item.sku || item.product_code || item.productCode || item.code || '').trim();
      const stockVal   = item.stock !== undefined && item.stock !== '' ? Number(item.stock) : undefined;

      if (!identifier) {
        errors.push(`Row ${i + 2}: Missing identifier (sku or product_code)`);
        skipped++;
        continue;
      }
      if (stockVal === undefined || isNaN(stockVal)) {
        errors.push(`Row ${i + 2}: Invalid stock value for "${identifier}"`);
        skipped++;
        continue;
      }

      try {
        // Find by SKU first, then fall back to productCode
        let product = await Product.findOne({ sku: identifier });
        if (!product) product = await Product.findOne({ productCode: identifier });

        if (!product) {
          errors.push(`Row ${i + 2}: No product found with SKU/Code "${identifier}"`);
          skipped++;
          continue;
        }

        // Sellers can only touch their own products
        if (req.user.role === 'seller') {
          const sellerDocId = getSellerDocId(req);
          if (!sellerDocId || product.seller?.toString() !== sellerDocId.toString()) {
            errors.push(`Row ${i + 2}: Access denied for "${identifier}" — not your product`);
            skipped++;
            continue;
          }
        }

        // Apply stock update
        product.stock = Math.max(0, stockVal);

        // Admin-only: optional price / discount_price columns
        if (req.user.role !== 'seller') {
          const newPrice = item.price !== undefined && item.price !== '' ? Number(item.price) : undefined;
          const newDisc  = item.discount_price !== undefined && item.discount_price !== '' ? Number(item.discount_price) : undefined;
          if (newPrice  !== undefined && !isNaN(newPrice)  && newPrice  > 0) product.price         = newPrice;
          if (newDisc   !== undefined && !isNaN(newDisc)   && newDisc   >= 0) product.discountPrice = newDisc;
        }

        await product.save();
        updated++;
        results.push({ identifier, name: product.name, stock: product.stock });
      } catch (err) {
        errors.push(`Row ${i + 2}: Error updating "${identifier}" — ${err.message}`);
        skipped++;
      }
    }

    res.json({
      success: true,
      updated,
      skipped,
      errors,
      results,
      message: `${updated} product${updated !== 1 ? 's' : ''} updated${skipped > 0 ? `, ${skipped} skipped` : ''}`,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * @route   GET /api/products/seller/export-stock
 * @desc    Seller downloads their own product list as CSV (pre-filled for stock update)
 * @access  Seller
 */
const exportSellerStock = async (req, res) => {
  try {
    const sellerDocId = getSellerDocId(req);
    if (!sellerDocId) return res.status(403).json({ success: false, message: 'Seller profile not found' });

    const products = await Product.find({ seller: sellerDocId, isActive: true })
      .select('name productCode sku stock price discountPrice')
      .sort('name')
      .lean();

    const escape = (val) => {
      const s = String(val ?? '');
      return s.includes(',') || s.includes('"') || s.includes('\n')
        ? `"${s.replace(/"/g, '""')}"`
        : s;
    };

    const headers = ['product_name', 'product_code', 'sku', 'current_stock', 'new_stock'];
    const rows = products.map(p => [
      escape(p.name),
      escape(p.productCode || ''),
      escape(p.sku || ''),
      p.stock ?? 0,
      '', // blank — seller fills in new_stock
    ]);

    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="stock-update.csv"');
    res.send(csv);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { getProducts, getProduct, getSellerProducts, getAdminProducts, createProduct, updateProduct, deleteProduct, removeProductImage, addReview, searchProducts, cloneProduct, previewProduct, toggleProductActive, bulkUpdateStock, exportSellerStock };
