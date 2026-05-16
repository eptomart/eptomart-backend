const express = require('express');
const router = express.Router();
const Category = require('../models/Category');
const { protectAdmin } = require('../middleware/adminAuth');
const { uploadCategory } = require('../config/cloudinary');

// Get all active categories
router.get('/', async (req, res) => {
  const { parent, all, moduleType } = req.query;
  // $ne: false also includes docs where isActive is undefined/not set (legacy data)
  const filter = { isActive: { $ne: false } };

  // Module-type filter: e.g. ?moduleType=eptomart returns only non-perishable categories
  if (moduleType) {
    filter.moduleType = moduleType === 'eptomart'
      ? { $in: ['eptomart', null, undefined] }   // eptomart + legacy (no moduleType set)
      : moduleType;
  }

  // If all=true, return all categories (including sub-categories)
  // Otherwise, filter by parent
  if (all !== 'true') {
    if (parent === 'null' || parent === undefined) filter.parentCategory = null;
    else if (parent) filter.parentCategory = parent;
  }

  const categories = await Category.find(filter).sort('sortOrder name');
  res.json({ success: true, categories });
});

// Get single category by slug
router.get('/:slug', async (req, res) => {
  const category = await Category.findOne({ slug: req.params.slug, isActive: { $ne: false } })
    .populate('subcategories');
  if (!category) return res.status(404).json({ success: false, message: 'Category not found' });
  res.json({ success: true, category });
});

// Admin: Create category
router.post('/', protectAdmin, uploadCategory.single('image'), async (req, res) => {
  const { name, description, icon, parentCategory, sortOrder } = req.body;
  const image = req.file ? { url: req.file.path, publicId: req.file.filename } : undefined;

  const category = await Category.create({
    name, description, icon, parentCategory: parentCategory || null,
    sortOrder: sortOrder || 0, image,
  });

  res.status(201).json({ success: true, message: 'Category created', category });
});

// Admin: Update category
router.put('/:id', protectAdmin, uploadCategory.single('image'), async (req, res) => {
  const updates = { ...req.body };
  if (req.file) updates.image = { url: req.file.path, publicId: req.file.filename };

  // Explicitly handle parentCategory: allow null or an ID
  if (req.body.parentCategory !== undefined) {
    updates.parentCategory = req.body.parentCategory || null;
  }

  const category = await Category.findByIdAndUpdate(req.params.id, updates, { new: true });
  if (!category) return res.status(404).json({ success: false, message: 'Category not found' });

  res.json({ success: true, message: 'Category updated', category });
});

// Admin: Delete category
router.delete('/:id', protectAdmin, async (req, res) => {
  await Category.findByIdAndDelete(req.params.id);
  res.json({ success: true, message: 'Category deleted' });
});

module.exports = router;
