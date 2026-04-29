const GST_SLABS = [0, 5, 12, 18, 28];

// Normalize Indian state names to handle common variations
// (abbreviations, typos, spacing, casing) from India Post API and manual entry
const STATE_NORM = {
  'andhra pradesh': 'andhra pradesh', 'ap': 'andhra pradesh',
  'arunachal pradesh': 'arunachal pradesh', 'ar': 'arunachal pradesh',
  'assam': 'assam', 'as': 'assam',
  'bihar': 'bihar', 'br': 'bihar',
  'chhattisgarh': 'chhattisgarh', 'cg': 'chhattisgarh', 'chattisgarh': 'chhattisgarh',
  'goa': 'goa', 'ga': 'goa',
  'gujarat': 'gujarat', 'gj': 'gujarat',
  'haryana': 'haryana', 'hr': 'haryana',
  'himachal pradesh': 'himachal pradesh', 'hp': 'himachal pradesh',
  'jharkhand': 'jharkhand', 'jh': 'jharkhand',
  'karnataka': 'karnataka', 'ka': 'karnataka',
  'kerala': 'kerala', 'kl': 'kerala',
  'madhya pradesh': 'madhya pradesh', 'mp': 'madhya pradesh',
  'maharashtra': 'maharashtra', 'mh': 'maharashtra',
  'manipur': 'manipur', 'mn': 'manipur',
  'meghalaya': 'meghalaya', 'ml': 'meghalaya',
  'mizoram': 'mizoram', 'mz': 'mizoram',
  'nagaland': 'nagaland', 'nl': 'nagaland',
  'odisha': 'odisha', 'or': 'odisha', 'orissa': 'odisha',
  'punjab': 'punjab', 'pb': 'punjab',
  'rajasthan': 'rajasthan', 'rj': 'rajasthan',
  'sikkim': 'sikkim', 'sk': 'sikkim',
  'tamil nadu': 'tamil nadu', 'tn': 'tamil nadu', 'tamilnadu': 'tamil nadu',
  'telangana': 'telangana', 'ts': 'telangana', 'tg': 'telangana',
  'tripura': 'tripura', 'tr': 'tripura',
  'uttar pradesh': 'uttar pradesh', 'up': 'uttar pradesh',
  'uttarakhand': 'uttarakhand', 'uk': 'uttarakhand', 'uttaranchal': 'uttarakhand',
  'west bengal': 'west bengal', 'wb': 'west bengal',
  'delhi': 'delhi', 'dl': 'delhi', 'new delhi': 'delhi',
  'jammu and kashmir': 'jammu and kashmir', 'jk': 'jammu and kashmir', 'j&k': 'jammu and kashmir',
  'ladakh': 'ladakh', 'la': 'ladakh',
  'chandigarh': 'chandigarh', 'ch': 'chandigarh',
  'puducherry': 'puducherry', 'py': 'puducherry', 'pondicherry': 'puducherry',
  'lakshadweep': 'lakshadweep', 'ld': 'lakshadweep',
  'andaman and nicobar islands': 'andaman and nicobar islands', 'an': 'andaman and nicobar islands',
  'dadra and nagar haveli': 'dadra and nagar haveli', 'dn': 'dadra and nagar haveli',
  'daman and diu': 'daman and diu', 'dd': 'daman and diu',
};

const normalizeState = (s) => {
  if (!s) return '';
  // Remove extra whitespace, lowercase, collapse multiple spaces
  const key = s.trim().toLowerCase().replace(/\s+/g, ' ');
  // Also try without spaces (handles "tamilnadu" → "tamil nadu")
  const keyNoSpace = key.replace(/\s/g, '');
  return STATE_NORM[key] || STATE_NORM[keyNoSpace] || key;
};

const isIntraState = (sellerState, buyerState) => {
  if (!sellerState || !buyerState) return true; // default to intra (safe)
  return normalizeState(sellerState) === normalizeState(buyerState);
};

/**
 * Extract base price (excl. GST) from an inclusive price
 */
const extractBasePrice = (priceInclGst, gstRate) => {
  if (!gstRate) return priceInclGst;
  return parseFloat((priceInclGst / (1 + gstRate / 100)).toFixed(2));
};

/**
 * Calculate GST for a single line item
 */
const calcLineGst = (unitPriceExGst, gstRate, quantity, sellerState, buyerState) => {
  const lineBase  = parseFloat((unitPriceExGst * quantity).toFixed(2));
  const totalGst  = parseFloat((lineBase * gstRate / 100).toFixed(2));
  const intra     = isIntraState(sellerState, buyerState);
  const half      = parseFloat((totalGst / 2).toFixed(2));

  return {
    unitPriceExGst,
    gstRate,
    quantity,
    lineBase,
    gstAmount:      totalGst,
    lineGrandTotal: parseFloat((lineBase + totalGst).toFixed(2)),
    gstType:        intra ? 'intra' : 'inter',
    cgstRate:       intra ? gstRate / 2 : 0,
    sgstRate:       intra ? gstRate / 2 : 0,
    igstRate:       intra ? 0 : gstRate,
    cgstAmount:     intra ? half : 0,
    sgstAmount:     intra ? (totalGst - half) : 0,  // handle odd cents
    igstAmount:     intra ? 0 : totalGst,
  };
};

/**
 * Calculate GST totals for a full order
 * items: [{ unitPriceExGst, gstRate, quantity }]
 */
const calcOrderGst = (items, sellerState, buyerState) => {
  const lines = items.map(i =>
    calcLineGst(i.unitPriceExGst, i.gstRate || 0, i.quantity, sellerState, buyerState)
  );

  const subtotal  = lines.reduce((s, l) => s + l.lineBase,    0);
  const cgstTotal = lines.reduce((s, l) => s + l.cgstAmount,  0);
  const sgstTotal = lines.reduce((s, l) => s + l.sgstAmount,  0);
  const igstTotal = lines.reduce((s, l) => s + l.igstAmount,  0);
  const gstTotal  = parseFloat((cgstTotal + sgstTotal + igstTotal).toFixed(2));

  return {
    lines,
    subtotal:   parseFloat(subtotal.toFixed(2)),
    cgstTotal:  parseFloat(cgstTotal.toFixed(2)),
    sgstTotal:  parseFloat(sgstTotal.toFixed(2)),
    igstTotal:  parseFloat(igstTotal.toFixed(2)),
    gstTotal,
    grandTotal: parseFloat((subtotal + gstTotal).toFixed(2)),
    gstType:    isIntraState(sellerState, buyerState) ? 'intra' : 'inter',
  };
};

module.exports = { GST_SLABS, isIntraState, extractBasePrice, calcLineGst, calcOrderGst };
