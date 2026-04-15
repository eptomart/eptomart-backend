const GST_SLABS = [0, 5, 12, 18, 28];

const isIntraState = (sellerState, buyerState) => {
  if (!sellerState || !buyerState) return true; // default to intra
  return sellerState.trim().toLowerCase() === buyerState.trim().toLowerCase();
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
