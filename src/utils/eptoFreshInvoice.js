// GST invoice for Proteins orders, issued in the SELLER's name.
// Prices are treated as tax-inclusive. Unregistered / 0% sellers get a Bill of Supply.
const EptoFreshSeller = require('../models/EptoFreshSeller');
const EptoFreshProduct = require('../models/EptoFreshProduct');

const r2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
const STATE_CODES = { 'tamil nadu':'33','karnataka':'29','kerala':'32','andhra pradesh':'37','telangana':'36','maharashtra':'27','delhi':'07','puducherry':'34' };
const stateCodeOf = n => STATE_CODES[String(n || '').toLowerCase().trim()] || null;

function fyOf(d = new Date()) {
  const y = d.getFullYear(), m = d.getMonth();
  const a = m >= 3 ? y : y - 1;
  return `${String(a).slice(2)}${String(a + 1).slice(2)}`;
}

// UQC (GST standard unit quantity codes)
function lineQty(it) {
  const w = Number(it.variant?.weight) || 0;     // grams
  const q = Number(it.quantity) || 1;
  if (w > 0) return { qty: r2((w / 1000) * q), uqc: 'KGS' };
  return { qty: q, uqc: 'PCS' };
}

async function nextNumber(sellerId) {
  const s = await EptoFreshSeller.findByIdAndUpdate(sellerId, { $inc: { 'gst.invoiceCounter': 1 } }, { new: true }).lean();
  const prefix = s.gst?.invoicePrefix || (s.sellerCode || 'EPF').toString().replace(/[^A-Z0-9]/gi, '').slice(0, 6).toUpperCase() || 'EPF';
  return `${prefix}/${fyOf()}/${String(s.gst.invoiceCounter).padStart(5, '0')}`;
}

/** Idempotent: returns existing invoice if already issued. */
async function issueInvoice(order) {
  if (order.taxInvoice?.number) return order.taxInvoice;
  const seller = await EptoFreshSeller.findById(order.seller).lean();
  if (!seller) return null;
  const g = seller.gst || {};
  const registered = !!(g.registered && g.gstin);
  const sellerRate = registered ? (Number(g.gstRate) || 0) : 0;
  // GST % is decided by the seller per product; delivery uses the seller default
  const prods = await EptoFreshProduct.find({ _id: { $in: (order.items || []).map(i => i.product) } }).select('gstRate hsnCode').lean();
  const pmap = Object.fromEntries(prods.map(p => [String(p._id), p]));
  const rateOf = it => {
    if (!registered) return 0;
    const p = pmap[String(it.product)];
    return p && p.gstRate !== undefined && p.gstRate !== null ? Number(p.gstRate) || 0 : sellerRate;
  };
  const rate = sellerRate;
  let anyTax = false;
  const sellerState = g.stateCode || stateCodeOf(seller.address?.state) || '33';
  const buyerState  = stateCodeOf(order.shippingAddress?.state) || sellerState;
  const inter = sellerState !== buyerState;

  const subtotal = (order.items || []).reduce((a, i) => a + (i.totalPrice || 0), 0) || 1;
  const disc = order.pricing?.couponDiscount || 0;
  const lines = [];
  const mk = (desc, gross, qty, uqc, hsn, rate) => {
    const taxable = r2(gross / (1 + rate / 100));
    const tax = r2(gross - taxable);
    let cgst = 0, sgst = 0, igst = 0;
    if (rate > 0) { if (inter) igst = tax; else { cgst = r2(tax / 2); sgst = r2(tax - cgst); } }
    return { description: desc, hsn, qty, uqc, rate, taxable, cgst, sgst, igst, total: r2(gross) };
  };
  for (const it of order.items || []) {
    const { qty, uqc } = lineQty(it);
    const share = disc > 0 ? ((it.totalPrice || 0) / subtotal) * disc : 0;
    const label = it.variant?.label ? ` (${it.variant.label})` : '';
    const r = rateOf(it); if (r > 0) anyTax = true;
    const hsn = pmap[String(it.product)]?.hsnCode || g.hsnDefault || '0207';
    lines.push(mk(`${it.productName}${it.cutType ? ' - ' + it.cutType : ''}${label}`, (it.totalPrice || 0) - share, qty, uqc, hsn, r));
  }
  const dc = order.pricing?.deliveryCharge || 0;
  if (dc > 0) { if (sellerRate > 0) anyTax = true; lines.push(mk('Delivery charges', dc, 1, 'NOS', '9965', sellerRate)); }

  const type = anyTax ? 'tax_invoice' : 'bill_of_supply';
  const totals = lines.reduce((t, l) => ({
    taxable: r2(t.taxable + l.taxable), cgst: r2(t.cgst + l.cgst), sgst: r2(t.sgst + l.sgst),
    igst: r2(t.igst + l.igst), total: r2(t.total + l.total),
  }), { taxable: 0, cgst: 0, sgst: 0, igst: 0, total: 0 });
  totals.roundOff = r2(Math.round(totals.total) - totals.total);
  totals.grand = Math.round(totals.total);

  order.taxInvoice = {
    number: await nextNumber(seller._id),
    issuedAt: new Date(),
    type,
    sellerSnapshot: {
      name: g.legalName || seller.shopName, brand: seller.shopName, gstin: registered ? g.gstin : undefined,
      fssai: seller.kyc?.fssaiNumber, address: seller.address, phone: seller.contact?.phone,
      stateCode: sellerState, placeOfSupply: buyerState, interState: inter,
    },
    lines, totals,
  };
  await order.save();
  return order.taxInvoice;
}

module.exports = { issueInvoice };
