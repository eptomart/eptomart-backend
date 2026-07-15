// ============================================
// AI CONTROLLER — Claude-powered features
// ============================================
const { callClaude }     = require('../utils/claudeApi');
const Product            = require('../models/Product');
const KoyambeduProduct   = require('../models/KoyambeduProduct');
const Order              = require('../models/Order');
const Category           = require('../models/Category');

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
const SHOPPING_SYSTEM = `You are Zya, Eptomart's shopping assistant.

RULES — follow strictly:
1. A product list will be provided below. From that list, show ONLY the products that are directly and genuinely relevant to what the user asked. Skip anything that doesn't match their intent — even if it's in the list.
2. When relevant products exist: one short warm sentence, then list each as "• Product Name — ₹Price". Nothing else.
3. When no relevant products exist (either none provided, or none actually match): one honest sentence saying we don't have it yet. No padding, no generic advice, no suggestions.
4. NEVER mention shipping, returns, delivery times, or payment unless the user specifically asks.
5. Maximum 3 sentences total. Be crisp.
6. Never make up products or prices.
7. If asked something unrelated to shopping, say in one sentence that you're here for product recommendations only.
8. Respond in the same language the user writes in (English, Hindi, or Tamil).

RELEVANCE FILTER — use your judgment:
- User asks "biryani" → show rice, masala, spices, ghee. NOT soap or shampoo.
- User asks "weight loss" → show health supplements, oats, seeds, herbal teas. NOT cleaning products.
- User asks "baby food" → show infant/toddler products. NOT adult snacks.
- User asks "skin care" → show creams, face wash, serums. NOT cooking oil (even if it's coconut oil).
- If a product in the list is unrelated to the user's query — skip it entirely.

EXAMPLE:
User: "What do you have for biryani?"
Zya: "Here's what you need! 🍛
• Kohinoor Basmati Rice 1kg — ₹180
• Eastern Biryani Masala 50g — ₹55
• Pure Cow Ghee 500ml — ₹320"

Product catalog injected below — filter it by relevance before responding.`;

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
    // Stop words — stripped before keyword extraction
    const STOP_WORDS = new Set([
      'what','which','do','you','have','for','the','a','an','i','me','my','your',
      'can','could','please','want','need','looking','show','tell','about','any',
      'some','get','find','suggest','recommend','is','are','and','or','to','of',
      'on','in','at','with','how','best','good','top','list','products','product',
      'items','item','buy','purchase','something','things','stuff','us','give','cook',
      'making','make','prepare','need','use','using',
    ]);

    // Query expansion — maps a dish/topic to relevant product keywords
    const EXPAND = {
      biryani:    ['biryani','basmati','rice','masala','spice','ghee','saffron','cardamom','clove','bay','cinnamon','star anise','mace'],
      curry:      ['curry','masala','turmeric','cumin','coriander','chilli','spice','garam'],
      dosa:       ['dosa','rice flour','urad dal','idli','batter','fenugreek'],
      sambar:     ['sambar','toor dal','tamarind','mustard','curry leaf','drumstick'],
      cake:       ['cake','flour','baking powder','vanilla','sugar','butter','cocoa','chocolate'],
      bread:      ['bread','yeast','flour','wheat','atta','whole wheat'],
      coffee:     ['coffee','filter coffee','instant coffee','chicory','creamer'],
      tea:        ['tea','green tea','chai','masala tea','ginger','cardamom','herbal'],
      weight:     ['weight loss','protein','fibre','oats','quinoa','flaxseed','chia','detox','green tea','herbal'],
      protein:    ['protein','whey','soy','pea protein','supplement','nuts','seeds'],
      organic:    ['organic','natural','chemical free','pure','cold pressed'],
      baby:       ['baby','infant','toddler','child','kids','cereal','puree'],
      skin:       ['skin','face','cream','lotion','moisturizer','vitamin c','neem','turmeric'],
      hair:       ['hair','shampoo','conditioner','oil','amla','bhringraj','coconut'],
      pickle:     ['pickle','achar','mango pickle','lime pickle','mixed pickle'],
      ghee:       ['ghee','clarified butter','cow ghee','desi ghee'],
      honey:      ['honey','raw honey','organic honey','wild honey'],
      oil:        ['oil','coconut oil','sesame oil','mustard oil','groundnut oil','olive oil'],
      dal:        ['dal','lentil','toor','moong','masoor','chana','split'],
      rice:       ['rice','basmati','sona masoori','brown rice','red rice','parboiled'],
      flour:      ['flour','atta','wheat','maida','besan','ragi','jowar','bajra','millet'],
      spice:      ['spice','masala','pepper','turmeric','cumin','coriander','chilli','cardamom','clove','cinnamon'],
      // Koyambedu Daily / fresh produce triggers
      vegetable:  ['tomato','onion','potato','capsicum','carrot','cucumber','brinjal','cabbage','cauliflower','spinach','beans','drumstick','bitter gourd','ridge gourd','ladies finger','cluster beans'],
      vegetables: ['tomato','onion','potato','capsicum','carrot','cucumber','brinjal','cabbage','cauliflower','spinach','beans'],
      produce:    ['tomato','onion','potato','capsicum','carrot','brinjal','cucumber','cabbage'],
      koyambedu:  ['tomato','onion','potato','capsicum','carrot','brinjal','cucumber','cabbage','cauliflower','spinach','beans','drumstick'],
      sabzi:      ['tomato','onion','potato','capsicum','carrot','brinjal','cucumber','beans'],
      greens:     ['spinach','curry leaf','coriander','mint','fenugreek','amaranth','drumstick'],
    };

    const msgLower = lastUserMsg.toLowerCase();
    const rawKeywords = msgLower
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 2 && !STOP_WORDS.has(w));

    // Expand keywords using the map
    const expandedSet = new Set(rawKeywords);
    for (const [trigger, synonyms] of Object.entries(EXPAND)) {
      if (msgLower.includes(trigger)) {
        synonyms.forEach(s => expandedSet.add(s));
      }
    }
    const keywords = [...expandedSet];

    let products = [];
    let kbdProducts = [];
    if (keywords.length > 0) {
      const orClauses = keywords.flatMap(kw => [
        { name:        { $regex: kw, $options: 'i' } },
        { description: { $regex: kw, $options: 'i' } },
        { tags:        { $regex: kw, $options: 'i' } },
      ]);
      if (categoryHint) orClauses.push({ category: { $regex: categoryHint, $options: 'i' } });

      // For Koyambedu, also try de-pluralized stems so "tomatoes" matches "Tomato"
      const depluralise = w => {
        if (w.length > 4 && w.endsWith('oes')) return w.slice(0, -2); // tomatoes → tomato
        if (w.length > 4 && w.endsWith('es'))  return w.slice(0, -2); // ladies → ladi (ok, imperfect)
        if (w.length > 3 && w.endsWith('s'))   return w.slice(0, -1); // tomatos → tomato
        return w;
      };
      const kbdKeywords = [...new Set([...keywords, ...keywords.map(depluralise)])];

      const kbdOrClauses = kbdKeywords.flatMap(kw => [
        { name:      { $regex: kw, $options: 'i' } },
        { nameTamil: { $regex: kw, $options: 'i' } },
        { tags:      { $regex: kw, $options: 'i' } },
      ]);

      [products, kbdProducts] = await Promise.all([
        Product.find({ approvalStatus: 'approved', isActive: true, $or: orClauses })
          .limit(6)
          .select('name discountPrice price category description stock')
          .lean(),
        KoyambeduProduct.find({ isActive: true, $or: kbdOrClauses })
          .limit(6)
          .select('name nameTamil currentPrice lowestUnitPrice category isAvailable')
          .populate('category', 'name')
          .lean(),
      ]);
    }

    const hasEpt = products.length > 0;
    const hasKbd = kbdProducts.length > 0;

    if (hasEpt || hasKbd) {
      productContext = '\n\nMatching products across Eptomart:\n';
      if (hasKbd) {
        productContext += '\n[Koyambedu Daily — fresh produce, wholesale vegetables]\n' +
          kbdProducts.map(p => {
            const price = p.lowestUnitPrice || p.currentPrice;
            const avail = p.isAvailable === false ? ' (Not available today)' : '';
            const cat   = p.category?.name || 'Koyambedu Daily';
            return `• ${p.name}${p.nameTamil ? ` (${p.nameTamil})` : ''} — ₹${price}${avail} [${cat}]`;
          }).join('\n');
      }
      if (hasEpt) {
        productContext += '\n\n[Eptomart — grocery, packaged goods, household]\n' +
          products.map(p =>
            `• ${p.name} — ₹${p.discountPrice || p.price}${p.stock === 0 ? ' (Out of stock)' : ''} [${p.category}]`
          ).join('\n');
      }
      productContext += '\n\nOnly recommend products listed above. Do not suggest anything else. When recommending Koyambedu Daily products, mention it\'s available via Koyambedu Daily section.';
    } else {
      productContext = '\n\nNo matching products found in the catalog right now. Tell the customer honestly and briefly that we don\'t carry that specific item yet, and invite them to check back or explore related categories. Do NOT make up product names or pretend products exist.';
    }
  } catch (_) {}

  const system = SHOPPING_SYSTEM +
    (userName ? `\n\nUser's name: ${userName}` : '') +
    productContext;

  try {
    const result = await callClaude({
      system,
      messages: messages.slice(-10), // keep last 10 turns for context
      max_tokens: 400,
      temperature: 0.75,
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
