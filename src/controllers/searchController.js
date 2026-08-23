const Product          = require('../models/Product');
const KoyambeduProduct = require('../models/KoyambeduProduct');
const { rankByFuzzy }   = require('../utils/fuzzySearch');

/**
 * Unified, ecosystem-wide product search — powers the Navbar and Home page
 * search bars. Searches the main Eptomart marketplace and Koyambedu Daily
 * together (Farmer Fresh / Proteins don't have individual product pages yet,
 * so they're left out of results that need to deep-link to a product).
 *
 * Behaves like a normal e-commerce/Google search: an exact/substring match
 * ranks highest, but a typo ("tomatoe", "bananna") still surfaces the
 * closest real product instead of returning nothing — see fuzzySearch.js.
 */

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const MAIN_FILTER = { approvalStatus: 'approved', isActive: true };
const KOY_FILTER  = {
  isActive: true,
  isAvailable: true,
  $or: [{ approvalStatus: 'approved' }, { approvalStatus: { $exists: false } }],
};

/**
 * Fetch a candidate pool for fuzzy ranking: first try a broad regex pass (any
 * query word matching any searchable field), then fall back to a general
 * recent/popular pool if the regex pass finds nothing at all — that fallback
 * is what makes a full typo ("bananna" with zero substring hits) still
 * surface a near-match instead of an empty result, the way Google always
 * shows *something* close.
 */
async function fetchCandidates(Model, baseFilter, query, fields, sortFallback, capField) {
  const words = query.trim().split(/\s+/).filter(w => w.length > 1);
  const regexes = words.length ? words : [query.trim()];
  const orClauses = [];
  for (const f of fields) {
    for (const w of regexes) orClauses.push({ [f]: new RegExp(escapeRegex(w), 'i') });
  }

  let candidates = orClauses.length
    ? await Model.find({ ...baseFilter, $or: orClauses }).limit(300).lean()
    : [];

  if (!candidates.length) {
    candidates = await Model.find(baseFilter).sort(sortFallback).limit(300).lean();
  }
  return candidates;
}

const mainLink = (p) => `/product/${p.slug}`;
const koyLink  = (p) => `/koyambedu/product/${p._id}`;

const toResult = (p, vertical, link) => ({
  _id: p._id,
  vertical,
  name: p.name,
  nameTamil: p.nameTamil || undefined,
  image: (p.images && p.images[0] && p.images[0].url) || null,
  price: p.discountPrice || p.currentPrice || p.price || null,
  link: link(p),
});

const unifiedSearch = async (req, res) => {
  try {
    const query = (req.query.q || req.query.search || '').trim();
    const limit = Math.min(Number(req.query.limit) || 24, 50);
    if (!query) return res.json({ success: true, results: [], count: 0 });

    const [mainCandidates, koyCandidates] = await Promise.all([
      fetchCandidates(Product, MAIN_FILTER, query, ['name', 'brand', 'tags', 'description'], { createdAt: -1 }),
      fetchCandidates(KoyambeduProduct, KOY_FILTER, query, ['name', 'nameTamil', 'description', 'tags'], { freshArrivalDate: -1 }),
    ]);

    const mainRanked = rankByFuzzy(mainCandidates, query, ['name', 'brand'])
      .map(({ doc, score }) => ({ ...toResult(doc, 'main', mainLink), score }));
    const koyRanked = rankByFuzzy(koyCandidates, query, ['name', 'nameTamil'])
      .map(({ doc, score }) => ({ ...toResult(doc, 'koyambedu', koyLink), score }));

    const combined = [...mainRanked, ...koyRanked].sort((a, b) => b.score - a.score).slice(0, limit);

    res.json({ success: true, results: combined, count: combined.length });
  } catch (err) {
    // Never break the search bar — degrade to empty results instead of a 500.
    res.json({ success: true, results: [], count: 0 });
  }
};

module.exports = { unifiedSearch, fetchCandidates, MAIN_FILTER, KOY_FILTER, mainLink, koyLink, toResult };
