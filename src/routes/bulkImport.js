// ============================================
// BULK PRODUCT IMPORT — CSV Upload
// ============================================
const express = require('express');
const router = express.Router();
const multer = require('multer');
const Product = require('../models/Product');
const Category = require('../models/Category');
const { protectAdmin } = require('../middleware/adminAuth');

// Memory storage for CSV (no disk save needed)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are allowed'), false);
    }
  }
});

/**
 * Parse CSV buffer into array of objects
 * Expected columns: name, description, price, discountPrice, stock, category, brand, tags
 */
const parseCSV = (buffer) => {
  const text = buffer.toString('utf-8');
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];

  // Parse header row
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, '').toLowerCase());

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;

    // Handle quoted values with commas
    const values = lines[i].match(/(".*?"|[^",]+)(?=\s*,|\s*$)/g) || lines[i].split(',');
    const row = {};
    headers.forEach((header, index) => {
      row[header] = (values[index] || '').trim().replace(/^"|"$/g, '');
    });
    rows.push(row);
  }
  return rows;
};

/**
 * @route   POST /api/bulk/import-products
 * @desc    Bulk import products from CSV
 * @access  Admin
 */
router.post('/import-products', protectAdmin, upload.single('csv'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'CSV file is required' });
  }

  const rows = parseCSV(req.file.buffer);
  if (rows.length === 0) {
    return res.status(400).json({ success: false, message: 'CSV is empty or invalid' });
  }

  // Load all categories for lookup
  const categories = await Category.find({});
  const categoryMap = {};
  categories.forEach(c => {
    categoryMap[c.name.toLowerCase()] = c._id;
    categoryMap[c.slug] = c._id;
  });

  const results = { success: 0, failed: 0, errors: [] };

  for (const row of rows) {
    try {
      if (!row.name || !row.price) {
        results.failed++;
        results.errors.push(`Row missing name/price: ${JSON.stringify(row)}`);
        continue;
      }

      // Resolve category
      const categoryId = categoryMap[row.category?.toLowerCase()] || categoryMap[row.category?.toLowerCase()?.replace(/\s+/g, '-')];

      if (!categoryId) {
        results.failed++;
        results.errors.push(`Category not found: "${row.category}" for product "${row.name}"`);
        continue;
      }

      await Product.create({
        name: row.name,
        description: row.description || row.name,
        shortDescription: row.shortdescription || row.short_description || '',
        price: parseFloat(row.price) || 0,
        discountPrice: row.discountprice || row.discount_price ? parseFloat(row.discountprice || row.discount_price) : undefined,
        stock: parseInt(row.stock) || 0,
        category: categoryId,
        brand: row.brand || '',
        tags: row.tags ? row.tags.split('|').map(t => t.trim()) : [],
        sku: row.sku || undefined,
        images: row.image ? [{ url: row.image, isDefault: true }] : [],
      });

      results.success++;
    } catch (err) {
      results.failed++;
      results.errors.push(`"${row.name}": ${err.message}`);
    }
  }

  res.json({
    success: true,
    message: `Import complete: ${results.success} products added, ${results.failed} failed.`,
    results,
  });
});

/**
 * @route   GET /api/bulk/export-products
 * @desc    Export all products as CSV
 * @access  Admin
 */
router.get('/export-products', protectAdmin, async (req, res) => {
  const products = await Product.find({ isActive: true }).populate('category', 'name');

  const headers = ['name', 'description', 'price', 'discountPrice', 'stock', 'category', 'brand', 'tags', 'sku', 'image'];

  const rows = products.map(p => [
    `"${(p.name || '').replace(/"/g, '""')}"`,
    `"${(p.description || '').replace(/"/g, '""').slice(0, 200)}"`,
    p.price || 0,
    p.discountPrice || '',
    p.stock || 0,
    `"${p.category?.name || ''}"`,
    `"${p.brand || ''}"`,
    `"${(p.tags || []).join('|')}"`,
    p.sku || '',
    `"${p.images?.[0]?.url || ''}"`,
  ]);

  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="eptomart-products.csv"');
  res.send(csv);
});

/**
 * @route   GET /api/bulk/csv-template
 * @desc    Download CSV import template
 * @access  Admin
 */
router.get('/csv-template', protectAdmin, (req, res) => {
  const template = `name,description,price,discountPrice,stock,category,brand,tags,sku,image
"Samsung Galaxy S24","Latest Samsung flagship with 50MP camera",79999,69999,50,"Electronics","Samsung","smartphone|android|5g","SAM-S24-BLK","https://example.com/image.jpg"
"Cotton T-Shirt","Comfortable 100% cotton t-shirt",499,399,200,"Fashion","Generic","tshirt|cotton|casual","TSHIRT-M-BLU",""
"Basmati Rice 5kg","Premium basmati rice from Punjab",650,,100,"Grocery","India Gate","rice|basmati|grocery","RICE-BAS-5KG",""`;

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="product-import-template.csv"');
  res.send(template);
});

module.exports = router;
