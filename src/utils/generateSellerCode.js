// ============================================================
// Generate a unique 6-char seller code from business name
// Format: [3 letters from name] + [3 random digits]
//   "Malarveni Enterprises"  →  MAL847
//   "Sri Traders"            →  SRI293
//   "KK Mobile World"        →  KKM519
//   "RS & Co"                →  RSC064
// Retries until a unique code is found (collision extremely unlikely).
// ============================================================

const Seller = require('../models/Seller');

/**
 * First 3 alphanumeric chars of the business name (uppercase).
 */
function derivePrefix(businessName) {
  const letters = businessName.replace(/[^a-zA-Z0-9]/g, '');
  return letters.slice(0, 3).toUpperCase().padEnd(3, 'X');
}

/**
 * Returns a unique 6-char code: prefix + 3 random digits.
 * excludeSellerId lets you skip the seller being edited (for updates).
 */
async function makeUniqueSellerCode(businessName, excludeSellerId = null) {
  const prefix = derivePrefix(businessName);

  const isFree = async (code) => {
    const q = { sellerId: code };
    if (excludeSellerId) q._id = { $ne: excludeSellerId };
    return !(await Seller.exists(q));
  };

  // Try up to 100 times — 1000 combinations per prefix, collision is near-zero
  for (let attempt = 0; attempt < 100; attempt++) {
    const digits = String(Math.floor(Math.random() * 1000)).padStart(3, '0');
    const code = prefix + digits;
    if (await isFree(code)) return code;
  }

  throw new Error(`Cannot generate unique seller code for: ${businessName}`);
}

module.exports = { derivePrefix, makeUniqueSellerCode };
