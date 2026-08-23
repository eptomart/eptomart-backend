/**
 * Lightweight fuzzy / near-match search helper — no external dependencies.
 *
 * Why this exists: every search box in the app (Navbar, Home, Koyambedu Shop,
 * main Shop) previously matched products with plain case-insensitive
 * substring regex only. A single typo — "tomatoe", "bananna", "chiken" —
 * returned zero results, unlike a normal e-commerce/Google search which
 * always tries to show the closest thing it can find. This module adds that
 * near-match tolerance on top of the existing regex search, without needing
 * MongoDB Atlas Search or a new search-engine dependency.
 */

/** Classic Levenshtein edit distance between two strings. */
function levenshtein(a, b) {
  if (a === b) return 0;
  const al = a.length, bl = b.length;
  if (al === 0) return bl;
  if (bl === 0) return al;
  let prev = new Array(bl + 1);
  let curr = new Array(bl + 1);
  for (let j = 0; j <= bl; j++) prev[j] = j;
  for (let i = 1; i <= al; i++) {
    curr[0] = i;
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[bl];
}

/**
 * How well a single query word matches a single word from a product name.
 * Returns a 0-1 similarity score (1 = identical), or 0 if too dissimilar to
 * count as a match. Tolerance scales with word length — short words need a
 * near-exact match (a 1-letter slip can change the meaning entirely), while
 * longer words tolerate a couple of character mistakes.
 */
function wordSimilarity(token, word) {
  if (!token || !word) return 0;
  if (token === word) return 1;
  if (word.startsWith(token) || token.startsWith(word)) return 0.95; // prefix match
  if (word.includes(token) || token.includes(word)) return 0.85; // substring match
  const dist = levenshtein(token, word);
  const maxLen = Math.max(token.length, word.length);
  const allowedDist = maxLen <= 4 ? 1 : maxLen <= 7 ? 2 : 3;
  if (dist > allowedDist) return 0;
  return 1 - dist / maxLen;
}

/**
 * Score how well a search query matches a piece of text (e.g. a product
 * name). Splits both into words; for every query word, finds its best
 * matching word anywhere in the text — near-matches count, not just exact
 * ones. Every query word must find *some* match, so "xyz apple" doesn't
 * score just because "apple" happens to be present.
 *
 * Returns 0 for no match, otherwise a positive score (higher = better) —
 * not bounded to any fixed range, only meaningful relative to other scores
 * from the same call.
 */
function fuzzyScore(query, text) {
  if (!query || !text) return 0;
  const qWords = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const tWords = text.toLowerCase().trim().split(/[\s,\-/()]+/).filter(Boolean);
  if (!qWords.length || !tWords.length) return 0;

  let total = 0;
  for (const qw of qWords) {
    let best = 0;
    for (const tw of tWords) {
      const s = wordSimilarity(qw, tw);
      if (s > best) best = s;
    }
    if (best === 0) return 0; // every query word must find some match
    total += best;
  }
  // Bonus for an exact whole-phrase substring match, so precise matches
  // still rank above near-matches instead of being tied with them.
  const phraseBonus = text.toLowerCase().includes(query.toLowerCase().trim()) ? 0.5 : 0;
  return total / qWords.length + phraseBonus;
}

/**
 * Rank a pool of already-fetched documents against a query using fuzzyScore
 * across one or more text fields (e.g. name + nameTamil). Returns only
 * documents that scored above 0, sorted best-first.
 */
function rankByFuzzy(docs, query, fields = ['name']) {
  const scored = [];
  for (const doc of docs) {
    let best = 0;
    for (const f of fields) {
      const val = doc[f];
      if (!val) continue;
      const s = fuzzyScore(query, String(val));
      if (s > best) best = s;
    }
    if (best > 0) scored.push({ doc, score: best });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored;
}

module.exports = { levenshtein, wordSimilarity, fuzzyScore, rankByFuzzy };
