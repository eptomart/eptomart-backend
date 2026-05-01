// ============================================================
// Generate a unique 3-letter seller code from business name
// Rule: ALWAYS the first 3 alphanumeric characters of the name
//   "Malarveni Enterprises"  →  MAL
//   "Sri Traders"            →  SRI
//   "KK Mobile World"        →  KKM
//   "RS & Co"                →  RSC
// If collision → MAL2, MAL3 … MA2, MA3 …
// ============================================================

const Seller = require('../models/Seller');

/**
 * Derive 3-char code: first 3 alphanumeric chars of the business name (uppercase).
 */
function deriveCode(businessName) {
  const letters = businessName.replace(/[^a-zA-Z0-9]/g, '');
  return letters.slice(0, 3).toUpperCase().padEnd(3, 'X');
}

/**
 * Returns a unique code not already used by any seller.
 * excludeSellerId lets you skip the seller being edited (for updates).
 */
async function makeUniqueSellerCode(businessName, excludeSellerId = null) {
  const base = deriveCode(businessName);

  const isFree = async (code) => {
    const q = { sellerId: code };
    if (excludeSellerId) q._id = { $ne: excludeSellerId };
    return !(await Seller.exists(q));
  };

  if (await isFree(base)) return base;

  // Try appending digits: MAL2 … MAL9
  for (let n = 2; n <= 9; n++) {
    const c = (base.slice(0, 2) + n).toUpperCase();
    if (await isFree(c)) return c;
  }

  // Try two-char base + digit: MA2 … MA9, M2X…
  for (let n = 2; n <= 9; n++) {
    const c = (base[0] + n + base[2]).toUpperCase();
    if (await isFree(c)) return c;
  }

  throw new Error(`Cannot generate unique seller code for: ${businessName}`);
}

module.exports = { deriveCode, makeUniqueSellerCode };
