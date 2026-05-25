// ============================================
// SUPPLIER / MANUFACTURER REPOSITORY CONTROLLER
// ============================================
const Supplier = require('../models/Supplier');

// ── GET /api/suppliers ─────────────────────────────────────
const getSuppliers = async (req, res) => {
  const { status, search, page = 1, limit = 20 } = req.query;
  const filter = {};

  if (status) filter.status = status;
  if (search) filter.$text = { $search: search };

  const [suppliers, total] = await Promise.all([
    Supplier.find(filter)
      .sort('-createdAt')
      .skip((Number(page) - 1) * Number(limit))
      .limit(Number(limit))
      .populate('addedBy', 'name email')
      .lean(),
    Supplier.countDocuments(filter),
  ]);

  res.json({ success: true, suppliers, total, totalPages: Math.ceil(total / Number(limit)) });
};

// ── POST /api/suppliers ────────────────────────────────────
const createSupplier = async (req, res) => {
  const {
    name, company, contactName, phone, email, location,
    instagramUrl, youtubeUrl, websiteUrl, otherRefUrl,
    productCategories, productsDescription,
    status, followUpDate, comments, internalNotes, tags, priority,
  } = req.body;

  if (!name) return res.status(400).json({ success: false, message: 'Supplier name is required' });

  const supplier = await Supplier.create({
    name, company, contactName, phone, email, location,
    instagramUrl, youtubeUrl, websiteUrl, otherRefUrl,
    productCategories: Array.isArray(productCategories) ? productCategories : [],
    productsDescription,
    status: status || 'follow_up',
    followUpDate: followUpDate || null,
    comments, internalNotes,
    tags: Array.isArray(tags) ? tags : [],
    priority: priority || 'medium',
    addedBy: req.user._id,
  });

  res.status(201).json({ success: true, supplier });
};

// ── GET /api/suppliers/:id ─────────────────────────────────
const getSupplier = async (req, res) => {
  const supplier = await Supplier.findById(req.params.id).populate('addedBy', 'name email');
  if (!supplier) return res.status(404).json({ success: false, message: 'Supplier not found' });
  res.json({ success: true, supplier });
};

// ── PUT /api/suppliers/:id ─────────────────────────────────
const updateSupplier = async (req, res) => {
  const supplier = await Supplier.findById(req.params.id);
  if (!supplier) return res.status(404).json({ success: false, message: 'Supplier not found' });

  const allowed = [
    'name', 'company', 'contactName', 'phone', 'email', 'location',
    'instagramUrl', 'youtubeUrl', 'websiteUrl', 'otherRefUrl',
    'productCategories', 'productsDescription',
    'status', 'followUpDate', 'comments', 'internalNotes', 'tags', 'priority',
  ];
  allowed.forEach(field => {
    if (req.body[field] !== undefined) supplier[field] = req.body[field];
  });

  await supplier.save();
  res.json({ success: true, supplier });
};

// ── DELETE /api/suppliers/:id ──────────────────────────────
const deleteSupplier = async (req, res) => {
  await Supplier.findByIdAndDelete(req.params.id);
  res.json({ success: true, message: 'Supplier deleted' });
};

// ── POST /api/suppliers/:id/ai-describe ───────────────────
// Uses Claude AI to generate a description + benefits for this supplier
const aiDescribeSupplier = async (req, res) => {
  const supplier = await Supplier.findById(req.params.id);
  if (!supplier) return res.status(404).json({ success: false, message: 'Supplier not found' });

  const { callClaude } = require('../utils/claudeApi');

  const prompt = `You are a sourcing analyst for an Indian ecommerce platform (Eptomart).
Given the following supplier/manufacturer details, write:
1. A concise 2-3 sentence "Description" of what this supplier likely offers.
2. A "Benefits" section with 3-5 bullet points about why partnering with them could be valuable.
Keep it professional, factual, and relevant to ecommerce sourcing in India.

Supplier Details:
- Name: ${supplier.name}
- Company: ${supplier.company || '—'}
- Location: ${supplier.location || '—'}
- Product Categories: ${(supplier.productCategories || []).join(', ') || '—'}
- Instagram: ${supplier.instagramUrl || '—'}
- YouTube: ${supplier.youtubeUrl || '—'}
- Comments: ${supplier.comments || '—'}

Respond in JSON:
{"description": "...", "benefits": ["...", "...", "..."]}`;

  try {
    const result = await callClaude({
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 400,
    });

    let parsed = { description: '', benefits: [] };
    try {
      const jsonMatch = result.text.match(/\{[\s\S]*\}/);
      if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
    } catch {
      parsed.description = result.text;
    }

    // Optionally save to supplier
    if (parsed.description) {
      const fullDescription = `${parsed.description}\n\nBenefits:\n${(parsed.benefits || []).map(b => `• ${b}`).join('\n')}`;
      supplier.productsDescription = fullDescription;
      await supplier.save();
    }

    res.json({ success: true, description: parsed.description, benefits: parsed.benefits || [], saved: true });
  } catch (err) {
    res.status(503).json({ success: false, message: 'AI description failed: ' + err.message });
  }
};

module.exports = { getSuppliers, createSupplier, getSupplier, updateSupplier, deleteSupplier, aiDescribeSupplier };
