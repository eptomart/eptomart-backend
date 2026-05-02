// ============================================
// AI CONTROLLER — Claude-powered features
// ============================================
const { callClaude } = require('../utils/claudeApi');
const Product  = require('../models/Product');
const Order    = require('../models/Order');
const Category = require('../models/Category');

// ── In-memory rate limit: max 30 AI calls/IP/hour (free-tier safe) ──
const _ipHits = new Map();
const _rateOk = (ip) => {
  const now  = Date.now();
  const hits  = (_ipHits.get(ip) || []).filter(t => now - t < 3600000);
  if (hits.length >= 30) return false;
  hits.push(now);
  _ipHits.set(ip, hits);
  return true;
};

// ── Shopping Assistant system prompt ────────────────────────────────
const SHOPPING_SYSTEM = `You are Eptomart's friendly AI shopping assistant. Eptomart is a premium Indian e-commerce platform focused on quality, organic, and curated products.

Your personality:
- Warm, helpful and knowledgeable — like a trusted personal shopper
- Concise but thorough — give useful answers without being verbose
- Slightly playful but professional
- You address the user by name if known

Your capabilities:
- Help customers find the right products based on their needs
- Answer questions about product quality, ingredients, usage, benefits
- Assist with order tracking queries (guide them to the Orders section)
- Explain Eptomart's return, shipping, and payment policies
- Give personalised recommendations when asked

Platform facts you know:
- Free shipping on orders above ₹499 (otherwise ₹60 flat)
- Payments: UPI, Razorpay (cards/wallets), Cash on Delivery
- Returns accepted within 7 days of delivery for most products
- All sellers on Eptomart are verified and their products are approved
- Delivery typically takes 3–7 business days

Product catalog context will be injected per request. Respond in English (or Hindi/Tamil if user writes in that language). Keep responses under 150 words unless a detailed comparison is asked for. Never make up product names or prices — only reference what's in the context provided.`;

// ── Seller product description system prompt ─────────────────────────
const DESCRIPTION_SYSTEM = `You are an expert e-commerce copywriter for Eptomart, a premium Indian marketplace.
Write compelling product descriptions that:
- Start with a punchy 1-sentence hook
- Highlight key benefits (not just features)
- Include relevant details: weight, ingredients, usage instructions if applicable
- End with a warm brand voice line
- Are optimised for Indian buyers
- Stay between 80–120 words
- Do NOT include price, shipping info, or seller details
- Use plain text (no markdown, no asterisks, no bullet points) — flowing prose only
Output ONLY the description text, nothing else.`;

// ── Seller insights system prompt ────────────────────────────────────
const INSIGHTS_SYSTEM = `You are an e-commerce performance analyst for Eptomart sellers.
Given order and product data, generate 3–4 actionable, specific insights.
Format: plain numbered list, one insight per line, max 25 words each.
Be concrete — mention actual numbers, product names, or trends from the data.
Do not give generic advice. Focus on what the seller can do THIS WEEK to grow.`;

/**
 * POST /api/ai/chat
 * Shopping assistant — public (rate limited by IP)
 */
const chat = async (req, res) => {
  const ip = req.ip || 'unknown';
  if (!_rateOk(ip)) {
    return res.status(429).json({ success: false, message: 'Too many AI requests. Please wait a moment.' });
  }

  const { messages = [], userName, categoryHint } = req.body;
  if (!messages.length) {
    return res.status(400).json({ success: false, message: 'messages array required' });
  }

  // Fetch relevant products for context (last user message as search hint)
  const lastUserMsg = [...messages].reverse().find(m => m.role === 'user')?.content || '';
  let productContext = '';
  try {
    const searchWords = lastUserMsg.replace(/[^\w\s]/g, '').split(/\s+/).slice(0, 4).join(' ');
    const products = await Product.find({
      approvalStatus: 'approved',
      isActive: true,
      $or: [
        { name:        { $regex: searchWords, $options: 'i' } },
        { description: { $regex: searchWords, $options: 'i' } },
        { category:    categoryHint ? { $regex: categoryHint, $options: 'i' } : undefined },
      ].filter(Boolean),
    })
      .limit(5)
      .select('name discountPrice price category description gstRate stock')
      .lean();

    if (products.length) {
      productContext = '\n\nRelevant products currently on Eptomart:\n' +
        products.map(p =>
          `• ${p.name} — ₹${p.discountPrice || p.price}${p.stock === 0 ? ' (Out of stock)' : ''}`
        ).join('\n');
    }
  } catch (_) {}

  const system = SHOPPING_SYSTEM +
    (userName ? `\n\nUser's name: ${userName}` : '') +
    productContext;

  try {
    const result = await callClaude({
      system,
      messages: messages.slice(-10), // keep last 10 turns for context
      max_tokens: 300,
      temperature: 0.7,
    });
    res.json({ success: true, reply: result.text });
  } catch (err) {
    console.error('[AI Chat] ERROR:', err.message);
    res.status(503).json({
      success: false,
      message: 'AI assistant is temporarily unavailable. Please try again shortly.',
      debug: process.env.NODE_ENV !== 'production' ? err.message : undefined,
    });
  }
};

/**
 * POST /api/ai/generate-description
 * Seller: generate a product description from basic info
 * Protected — seller auth required
 */
const generateDescription = async (req, res) => {
  const { productName, category, keyFeatures, weight, ingredients } = req.body;
  if (!productName) {
    return res.status(400).json({ success: false, message: 'productName is required' });
  }

  const userPrompt = [
    `Product name: ${productName}`,
    category    ? `Category: ${category}`         : null,
    keyFeatures ? `Key features: ${keyFeatures}`  : null,
    weight      ? `Weight/size: ${weight}`         : null,
    ingredients ? `Ingredients/contents: ${ingredients}` : null,
  ].filter(Boolean).join('\n');

  try {
    const result = await callClaude({
      system:  DESCRIPTION_SYSTEM,
      messages: [{ role: 'user', content: userPrompt }],
      max_tokens: 200,
      temperature: 0.75,
    });
    res.json({ success: true, description: result.text.trim() });
  } catch (err) {
    console.error('[AI Description]', err.message);
    res.status(503).json({ success: false, message: 'Could not generate description. Try again.' });
  }
};

/**
 * GET /api/ai/seller-insights
 * Seller: get AI-generated performance insights
 * Protected — seller auth required
 */
const getSellerInsights = async (req, res) => {
  const sellerDocId = req.user?.sellerProfile;
  if (!sellerDocId) return res.status(403).json({ success: false, message: 'Seller access required' });

  try {
    // Gather last 30 days of data
    const since = new Date(); since.setDate(since.getDate() - 30);
    const sellerProducts = await Product.find({ seller: sellerDocId })
      .select('name stock soldCount approvalStatus discountPrice price')
      .lean();
    const productIds = sellerProducts.map(p => p._id);

    const recentOrders = await Order.find({
      'items.product': { $in: productIds },
      createdAt: { $gte: since },
    })
      .select('items pricing orderStatus createdAt')
      .lean();

    // Build summary for Claude
    const totalOrders   = recentOrders.length;
    const delivered     = recentOrders.filter(o => o.orderStatus === 'delivered').length;
    const revenue       = recentOrders.reduce((s, o) => s + (o.pricing?.total || 0), 0);
    const outOfStock    = sellerProducts.filter(p => p.stock === 0).length;
    const topProduct    = sellerProducts.sort((a, b) => (b.soldCount || 0) - (a.soldCount || 0))[0];
    const lowStock      = sellerProducts.filter(p => p.stock > 0 && p.stock <= 5);

    const dataPrompt = `Seller performance — last 30 days:
- Orders received: ${totalOrders}
- Delivered: ${delivered}
- Revenue: ₹${revenue.toLocaleString('en-IN')}
- Total products: ${sellerProducts.length} (${outOfStock} out of stock)
- Top selling product: ${topProduct?.name || 'N/A'} (${topProduct?.soldCount || 0} units sold)
- Low stock products (≤5 units): ${lowStock.map(p => p.name).join(', ') || 'None'}
- Pending approval: ${sellerProducts.filter(p => p.approvalStatus === 'pending').length} products`;

    const result = await callClaude({
      system:  INSIGHTS_SYSTEM,
      messages: [{ role: 'user', content: dataPrompt }],
      max_tokens: 250,
      temperature: 0.4,
    });

    // Parse numbered list into array
    const insights = result.text
      .split('\n')
      .filter(l => l.trim())
      .map(l => l.replace(/^\d+\.\s*/, '').trim())
      .filter(Boolean);

    res.json({ success: true, insights, generatedAt: new Date() });
  } catch (err) {
    console.error('[AI Insights]', err.message);
    res.status(503).json({ success: false, message: 'Could not generate insights right now.' });
  }
};

module.exports = { chat, generateDescription, getSellerInsights };
