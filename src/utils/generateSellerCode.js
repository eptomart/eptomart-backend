// ============================================================
// Generate a unique 3-letter seller code from business name
// e.g.  "Malarveni Enterprises"  →  MAL
//       "Sri Traders"            →  SRT
//       "KK Mobile World"        →  KKM
//       "ABC Company Pvt Ltd"    →  ABC
// ============================================================

const Seller = require('../models/Seller');

const STOP_WORDS = new Set([
  'pvt', 'ltd', 'private', 'limited', 'co', 'company',
  'enterprises', 'enterprise', 'traders', 'trading',
  'solutions', 'services', 'industries', 'international',
  'exports', 'imports', 'retail', 'wholesale', 'mart',
  'store', 'shop', 'world', 'group', 'and', 'the', 'a', 'of', '&',
]);

/**
 * Derive a 3-uppercase-letter code from a business name.
 * Does NOT guarantee uniqueness — call makeUniqueSellerCode for that.
 */
function deriveCode(businessName) {
  const words = businessName
    .trim()
    .split(/[\s\-_]+/)
    .map(w => w.replace(/[^a-zA-Z0-9]/g, ''))
    .filter(w => w.length > 0 && !STOP_WORDS.has(w.toLowerCase()));

  // Fallback if all words were stop-words
  const src = words.length > 0 ? words : [businessName.replace(/[^a-zA-Z0-9]/g, '')];

  let code;
  if (src.length >= 3) {
    // KK Mobile World → K K M
    code = src.slice(0, 3).map(w => w[0]).join('');
  } else if (src.length === 2) {
    // Sri Traders → S R → pad with 2nd char of first word: SRT
    const initials = src.map(w => w[0]).join('');
    const pad = src[0][1] || src[1][1] || src[0][0];
    code = (initials[0] + initials[1] + pad).slice(0, 3);
  } else {
    // Single word: first 3 letters
    code = src[0].slice(0, 3);
  }

  return code.toUpperCase().padEnd(3, 'X').slice(0, 3);
}

/**
 * Returns a unique 3-char code not already used by any other seller.
 * If "MAL" is taken, tries MAL2, MAL3, MA2, MA3 … M2X, M3X until free.
 */
async function makeUniqueSellerCode(businessName, excludeSellerId = null) {
  const base = deriveCode(businessName);

  const isAvailable = async (code) => {
    const query = { sellerId: code };
    if (excludeSellerId) query._id = { $ne: excludeSellerId };
    return !(await Seller.exists(query));
  };

  if (await isAvailable(base)) return base;

  // Try suffixing a digit
  for (let n = 2; n <= 9; n++) {
    const candidate = (base.slice(0, 2) + n).toUpperCase();
    if (await isAvailable(candidate)) return candidate;
  }

  // Last resort: random 3-char code
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let attempt = 0; attempt < 50; attempt++) {
    const rand = Array.from({ length: 3 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    if (await isAvailable(rand)) return rand;
  }

  throw new Error(`Cannot generate unique seller code for: ${businessName}`);
}

module.exports = { deriveCode, makeUniqueSellerCode };
