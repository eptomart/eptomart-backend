// ============================================================
// Generate a unique 6-char seller code
//
// Format: [3 letters] + [3 random digits]
//
// First attempt  → first 3 alphanumeric chars of business name
//   "Malarveni Enterprises"  →  MAL + 3 digits  e.g. MAL847
//
// On collision (another seller already starts with MAL) →
//   pick 3 chars randomly from anywhere in the name instead
//   "Malarveni Enterprises"  →  could produce LRV, AEn, VNI…
//   This avoids predictable suffixes (MAL2, MAL3) and keeps
//   every code genuinely tied to the seller's name.
// ============================================================

const Seller = require('../models/Seller');

/** First 3 alphanumeric chars of the business name (uppercase). */
function derivePrefix(businessName) {
  const letters = businessName.replace(/[^a-zA-Z0-9]/g, '');
  return letters.slice(0, 3).toUpperCase().padEnd(3, 'X');
}

/**
 * Pick 3 random alphanumeric characters from anywhere in the name.
 * Used when the natural prefix collides with an existing seller code.
 */
function randomPrefixFromName(businessName) {
  const chars = businessName.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  if (chars.length < 3) return chars.padEnd(3, 'X'); // very short name fallback
  let result = '';
  const indices = new Set();
  let attempts = 0;
  while (result.length < 3 && attempts < 200) {
    const i = Math.floor(Math.random() * chars.length);
    if (!indices.has(i)) { indices.add(i); result += chars[i]; }
    attempts++;
  }
  return result.padEnd(3, 'X');
}

/**
 * Returns a unique 6-char seller code: [3-letter prefix] + [3 random digits].
 * excludeSellerId lets you skip the seller being edited (for updates).
 */
async function makeUniqueSellerCode(businessName, excludeSellerId = null) {
  const isFree = async (code) => {
    const q = { sellerId: code };
    if (excludeSellerId) q._id = { $ne: excludeSellerId };
    return !(await Seller.exists(q));
  };

  // ── Pass 1: use the natural first-3-char prefix ──────────
  const naturalPrefix = derivePrefix(businessName);
  for (let attempt = 0; attempt < 20; attempt++) {
    const digits = String(Math.floor(Math.random() * 1000)).padStart(3, '0');
    const code = naturalPrefix + digits;
    if (await isFree(code)) return code;
  }

  // ── Pass 2: prefix collides too often — pick random chars from name ──
  for (let attempt = 0; attempt < 100; attempt++) {
    const prefix = randomPrefixFromName(businessName);
    const digits = String(Math.floor(Math.random() * 1000)).padStart(3, '0');
    const code = prefix + digits;
    if (await isFree(code)) return code;
  }

  throw new Error(`Cannot generate unique seller code for: ${businessName}`);
}

module.exports = { derivePrefix, makeUniqueSellerCode };
