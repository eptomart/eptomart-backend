// ============================================
// EPTOMART EXPRESS — POS Billing Controller
// Everything a POS user can do at the counter: browse their store's
// available products, create/hold/resume/complete/void bills. Scoped
// strictly to req.posUser.store and req.posSessionAt (see
// middleware/expressAuth.js) — a POS user can never see another POS
// user's bills, another store's data, or bills from a previous session.
// Completing a bill decrements stock exactly like an online order does.
// ============================================
const ExpressStoreProduct = require('../models/ExpressStoreProduct');
const ExpressMarginConfig = require('../models/ExpressMarginConfig');
const ExpressBill         = require('../models/ExpressBill');
const ExpressOrder        = require('../models/ExpressOrder');
const ExpressStockLog     = require('../models/ExpressStockLog');
const { computeSellingPrice } = require('../services/expressPricingService');

const fail = (res, status, message) => res.status(status).json({ success: false, message });
const MAX_HELD_BILLS = 5;

async function getMarginConfig() {
  let config = await ExpressMarginConfig.findOne({ key: 'default' });
  if (!config) config = await ExpressMarginConfig.create({ key: 'default' });
  return config;
}

const genBillNo = () => 'POS-' + Date.now().toString(36).toUpperCase();

// ── Product lookup for the billing screen ────────────────────────────────

const listProducts = async (req, res) => {
  try {
    const config = await getMarginConfig();
    const storeProducts = await ExpressStoreProduct.find({ store: req.posUser.store, isAvailable: true })
      .populate({ path: 'product', populate: { path: 'koyambeduProduct', select: 'name nameTamil images' } })
      .lean();

    const products = storeProducts
      .filter(sp => sp.product) // Koyambedu-linked or native — either sells fine at POS
      .map(sp => ({
        _id: sp.product._id,
        name: sp.product.koyambeduProduct?.name || sp.product.name,
        nameTamil: sp.product.koyambeduProduct?.nameTamil || sp.product.nameTamil || '',
        image: sp.product.koyambeduProduct
          ? (sp.product.koyambeduProduct.images?.find(i => i.isPrimary)?.url || sp.product.koyambeduProduct.images?.[0]?.url || null)
          : (sp.product.image || null),
        unit: sp.product.unit,
        stockQty: sp.stockQty,
        plu: sp.product.plu ?? null,
        // A per-store price override (set by admin when assigning this
        // product to this store) replaces the globally-computed margin
        // price for this store only — see ExpressStoreProduct.priceOverride.
        price: sp.priceOverride ?? computeSellingPrice(sp.product, config, 1).sellingPricePerUnit,
      }));
    res.json({ success: true, products });
  } catch (err) {
    console.error('[expressPOS.listProducts]', err);
    fail(res, 500, 'Failed to load products');
  }
};

// ── Bills ────────────────────────────────────────────────────────────────

const listMyBills = async (req, res) => {
  try {
    const bills = await ExpressBill.find({
      posUser: req.posUser._id,
      createdAt: { $gte: req.posSessionAt },
    }).sort({ createdAt: -1 }).lean();
    res.json({ success: true, bills });
  } catch (err) {
    console.error('[expressPOS.listMyBills]', err);
    fail(res, 500, 'Failed to load bills');
  }
};

function recalcTotals(bill) {
  bill.subtotal = bill.items.reduce((sum, i) => sum + i.price * i.quantity, 0);
  bill.discountAmount = Math.round(bill.subtotal * (bill.discountPercent || 0) / 100 * 100) / 100;
  const rawTotal = Math.max(0, bill.subtotal - bill.discountAmount);
  // Final payable amount is rounded to the nearest whole rupee — a cash
  // counter doesn't deal in paise. roundOff is kept alongside for an
  // accurate audit trail (e.g. ₹237.45 -> total ₹237, roundOff -0.45).
  bill.total = Math.round(rawTotal);
  bill.roundOff = Math.round((bill.total - rawTotal) * 100) / 100;
}

const createBill = async (req, res) => {
  try {
    // Scoped to this login session, same as listMyBills below — otherwise a
    // held bill left over from a PREVIOUS session (e.g. a crashed tab, or a
    // shift that ended without completing/voiding it) is invisible to this
    // session's UI (which correctly shows 0 held bills) yet still counted
    // here, permanently blocking new bills with a "4 held" error the
    // cashier has no way to see or resolve.
    const heldCount = await ExpressBill.countDocuments({
      posUser: req.posUser._id, status: 'held', createdAt: { $gte: req.posSessionAt },
    });
    if (heldCount >= MAX_HELD_BILLS) {
      return fail(res, 400, `You already have ${MAX_HELD_BILLS} held bills — complete or void one before starting a new bill.`);
    }

    const { customerName } = req.body;
    const customerPhone = String(req.body.customerPhone || '').replace(/\D/g, '').slice(-10);
    if (customerPhone && customerPhone.length !== 10) return fail(res, 400, 'Customer mobile number must be 10 digits (or leave it blank)');
    const bill = await ExpressBill.create({
      billNo: genBillNo(),
      store: req.posUser.store,
      posUser: req.posUser._id,
      posUserName: req.posUser.name,
      customerName: String(customerName || '').trim() || 'Walk-in Customer',
      customerPhone: customerPhone || undefined,
      items: [],
    });
    res.status(201).json({ success: true, bill });
  } catch (err) {
    console.error('[expressPOS.createBill]', err);
    fail(res, 500, 'Failed to create bill');
  }
};

const getBill = async (req, res) => {
  try {
    const bill = await ExpressBill.findOne({ _id: req.params.billId, posUser: req.posUser._id, createdAt: { $gte: req.posSessionAt } }).lean();
    if (!bill) return fail(res, 404, 'Bill not found');
    res.json({ success: true, bill });
  } catch (err) {
    console.error('[expressPOS.getBill]', err);
    fail(res, 500, 'Failed to load bill');
  }
};

// Add/update/remove one line item on a held bill. quantity <= 0 removes it.
const updateBillItem = async (req, res) => {
  try {
    const { productId, quantity } = req.body;
    if (!productId || quantity == null) return fail(res, 400, 'productId and quantity are required');
    if (!Number.isFinite(Number(quantity))) return fail(res, 400, 'quantity must be a number');

    const bill = await ExpressBill.findOne({ _id: req.params.billId, posUser: req.posUser._id, createdAt: { $gte: req.posSessionAt } });
    if (!bill) return fail(res, 404, 'Bill not found');
    if (bill.status !== 'held') return fail(res, 400, 'This bill can no longer be edited');

    const storeProduct = await ExpressStoreProduct.findOne({ store: bill.store, product: productId, isAvailable: true })
      .populate({ path: 'product', populate: { path: 'koyambeduProduct', select: 'name' } });
    if (!storeProduct || !storeProduct.product?.koyambeduProduct) return fail(res, 404, 'Product not available');
    const productName = storeProduct.product.koyambeduProduct.name;

    const existing = bill.items.find(i => String(i.product) === String(productId));
    if (Number(quantity) <= 0) {
      bill.items = bill.items.filter(i => String(i.product) !== String(productId));
    } else {
      if (storeProduct.stockQty < quantity) return fail(res, 400, `Only ${storeProduct.stockQty} of "${productName}" left in stock`);
      const config = await getMarginConfig();
      const price = storeProduct.priceOverride ?? computeSellingPrice(storeProduct.product, config, 1).sellingPricePerUnit;
      if (existing) {
        existing.quantity = Number(quantity);
        existing.price = price;
      } else {
        bill.items.push({ product: productId, name: productName, unit: storeProduct.product.unit, price, quantity: Number(quantity) });
      }
    }

    recalcTotals(bill);
    await bill.save();
    res.json({ success: true, bill });
  } catch (err) {
    console.error('[expressPOS.updateBillItem]', err);
    fail(res, 500, 'Failed to update bill');
  }
};

// Apply (or clear, with 0) an offer % discount on the bill's subtotal —
// e.g. a festival offer or a manager-approved discount at the counter.
// Only allowed while the bill is still held/editable, same as line items.
const applyDiscount = async (req, res) => {
  try {
    const { discountPercent } = req.body;
    const pct = Number(discountPercent);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) return fail(res, 400, 'discountPercent must be a number between 0 and 100');

    const bill = await ExpressBill.findOne({ _id: req.params.billId, posUser: req.posUser._id, createdAt: { $gte: req.posSessionAt } });
    if (!bill) return fail(res, 404, 'Bill not found');
    if (bill.status !== 'held') return fail(res, 400, 'This bill can no longer be edited');

    bill.discountPercent = pct;
    recalcTotals(bill);
    await bill.save();
    res.json({ success: true, bill });
  } catch (err) {
    console.error('[expressPOS.applyDiscount]', err);
    fail(res, 500, 'Failed to apply discount');
  }
};

const completeBill = async (req, res) => {
  try {
    const { paymentMethod } = req.body;
    if (!['cash', 'upi', 'card'].includes(paymentMethod)) return fail(res, 400, 'Select a payment mode (cash, UPI or card)');
    const bill = await ExpressBill.findOne({ _id: req.params.billId, posUser: req.posUser._id, createdAt: { $gte: req.posSessionAt } });
    if (!bill) return fail(res, 404, 'Bill not found');
    if (bill.status !== 'held') return fail(res, 400, 'Bill already processed');
    if (bill.items.length === 0) return fail(res, 400, 'Add at least one item before completing the sale');

    // Cash: the amount handed over must cover the total; change = tendered - total.
    // UPI / card: exact payment, no change.
    // Optional customer details captured at checkout (all optional)
    if (req.body.customerName != null) {
      const n = String(req.body.customerName).trim();
      bill.customerName = n || 'Walk-in Customer';
    }
    if (req.body.customerPhone != null) {
      const ph = String(req.body.customerPhone).replace(/\D/g, '').slice(-10);
      if (ph && ph.length !== 10) return fail(res, 400, 'Customer mobile number must be 10 digits (or leave it blank)');
      bill.customerPhone = ph || undefined;
    }
    let amountTendered = bill.total, changeReturned = 0;
    if (paymentMethod === 'cash') {
      amountTendered = Number(req.body.amountTendered);
      if (!Number.isFinite(amountTendered)) return fail(res, 400, 'Enter the amount received from the customer');
      if (amountTendered + 0.0001 < bill.total) return fail(res, 400, `Amount received (₹${amountTendered}) is less than the bill total (₹${bill.total})`);
      changeReturned = Math.round((amountTendered - bill.total) * 100) / 100;
    }

    // Atomic conditional deduction — each decrement only applies if enough
    // stock is still available at that exact moment, closing the race
    // window a separate check-then-write pair would leave open (e.g. a
    // double-tap on "Complete Sale", or two counters selling the last unit
    // at once). Roll back whatever succeeded so far if a later item fails.
    const deducted = [];
    for (const item of bill.items) {
      const updated = await ExpressStoreProduct.findOneAndUpdate(
        { store: bill.store, product: item.product, stockQty: { $gte: item.quantity } },
        { $inc: { stockQty: -item.quantity } }
      );
      if (!updated) {
        for (const d of deducted) {
          await ExpressStoreProduct.findOneAndUpdate({ store: bill.store, product: d.product }, { $inc: { stockQty: d.quantity } });
        }
        return fail(res, 400, `Not enough stock for "${item.name}"`);
      }
      deducted.push(item);
    }

    bill.status = 'completed';
    bill.paymentMethod = paymentMethod;
    bill.amountTendered = amountTendered;
    bill.changeReturned = changeReturned;
    bill.completedAt = new Date();
    await bill.save();

    res.json({ success: true, bill });
  } catch (err) {
    console.error('[expressPOS.completeBill]', err);
    fail(res, 500, 'Failed to complete sale');
  }
};

const voidBill = async (req, res) => {
  try {
    const bill = await ExpressBill.findOne({ _id: req.params.billId, posUser: req.posUser._id, createdAt: { $gte: req.posSessionAt } });
    if (!bill) return fail(res, 404, 'Bill not found');
    if (bill.status !== 'held') return fail(res, 400, 'Only held bills can be voided');
    bill.status = 'voided';
    await bill.save();
    res.json({ success: true, message: 'Bill voided' });
  } catch (err) {
    console.error('[expressPOS.voidBill]', err);
    fail(res, 500, 'Failed to void bill');
  }
};

// ── Online orders for this POS user's store (view) ──────────────────────
const listStoreOrders = async (req, res) => {
  try {
    const { status } = req.query;
    const filter = { store: req.posUser.store };
    if (status) filter.orderStatus = status;
    const orders = await ExpressOrder.find(filter)
      .populate('buyer', 'name phone')
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
    res.json({ success: true, orders });
  } catch (err) {
    console.error('[expressPOS.listStoreOrders]', err);
    fail(res, 500, 'Failed to load orders');
  }
};

// ── Today's POS activity for the whole store (all counters) ─────────────
const storeActivity = async (req, res) => {
  try {
    const IST = 5.5 * 60 * 60 * 1000;
    const nowIST = new Date(Date.now() + IST);
    const startUTC = new Date(Date.UTC(nowIST.getUTCFullYear(), nowIST.getUTCMonth(), nowIST.getUTCDate()) - IST);
    const bills = await ExpressBill.find({ store: req.posUser.store, createdAt: { $gte: startUTC } })
      .sort({ createdAt: -1 }).limit(200).lean();
    const done = bills.filter(b => b.status === 'completed');
    const sum = (arr) => Math.round(arr.reduce((t, b) => t + (b.total || 0), 0) * 100) / 100;
    const byMode = (m) => sum(done.filter(b => b.paymentMethod === m));
    res.json({
      success: true,
      totals: {
        completed: done.length, held: bills.filter(b => b.status === 'held').length, voided: bills.filter(b => b.status === 'voided').length,
        sales: sum(done), cash: byMode('cash'), upi: byMode('upi'), card: byMode('card'),
      },
      bills,
    });
  } catch (err) {
    console.error('[expressPOS.storeActivity]', err);
    fail(res, 500, 'Failed to load activity');
  }
};

// ── Camera item recognition (item on the weighing scale) ────────────────
// The POS camera frame goes to Claude vision together with this store's
// in-stock catalogue. It returns ranked candidates + the weight shown on the
// scale's display. Items that genuinely look alike (lemon / sweet lime, …)
// come back flagged `ambiguous` so the cashier picks one; clear matches are
// returned as a single confident match for the terminal to add automatically.
const LOOKALIKE_GROUPS = [
  ['lemon', 'sweet lime', 'mosambi', 'musambi', 'lime', 'எலுமிச்சை', 'சாத்துக்குடி'],
  ['coriander', 'mint', 'curry leaf', 'parsley', 'கொத்தமல்லி', 'புதினா', 'கறிவேப்பிலை'],
  ['green chilli', 'capsicum', 'பச்சை மிளகாய்', 'குடை மிளகாய்'],
  ['small onion', 'shallot', 'sambar onion', 'சின்ன வெங்காயம்', 'onion', 'பெரிய வெங்காயம்'],
  ['brinjal', 'eggplant', 'கத்தரிக்காய்'],
  ['cluster beans', 'french beans', 'beans', 'கொத்தவரங்காய்', 'பீன்ஸ்'],
  ['potato', 'sweet potato', 'உருளைக்கிழங்கு', 'சர்க்கரைவள்ளிக்கிழங்கு'],
  ['guava', 'green apple', 'கொய்யா'],
  ['pomegranate', 'apple', 'மாதுளை'],
  ['carrot', 'radish', 'கேரட்', 'முள்ளங்கி'],
];
const normName = (p) => `${p.name || ''} ${p.nameTamil || ''}`.toLowerCase();
const groupOf = (p) => {
  const n = normName(p);
  return LOOKALIKE_GROUPS.findIndex(g => g.some(k => n.includes(k)));
};

const recognizeItem = async (req, res) => {
  try {
    const { image } = req.body; // data URL or raw base64 (JPEG)
    if (!image || typeof image !== 'string') return fail(res, 400, 'Image is required');
    const b64 = image.replace(/^data:image\/\w+;base64,/, '');
    if (b64.length > 4 * 1024 * 1024) return fail(res, 413, 'Image too large');

    // Same catalogue the billing grid uses (in-stock only)
    const config = await getMarginConfig();
    const sps = await ExpressStoreProduct.find({ store: req.posUser.store, isAvailable: true, stockQty: { $gt: 0 } })
      .populate({ path: 'product', populate: { path: 'koyambeduProduct', select: 'name nameTamil' } }).lean();
    const catalogue = sps.filter(sp => sp.product).map(sp => ({
      _id: String(sp.product._id),
      name: sp.product.koyambeduProduct?.name || sp.product.name,
      nameTamil: sp.product.koyambeduProduct?.nameTamil || '',
      unit: sp.product.unit,
      plu: sp.product.plu ?? null,
      stockQty: sp.stockQty,
      price: sp.priceOverride ?? computeSellingPrice(sp.product, config, 1).sellingPricePerUnit,
    }));
    if (!catalogue.length) return fail(res, 400, 'No in-stock products to match against');

    const { callClaude } = require('../utils/claudeApi');
    const list = catalogue.map(c => `${c._id} | ${c.name}${c.nameTamil ? ' / ' + c.nameTamil : ''} | unit: ${c.unit}`).join('\n');
    const system = `You are the produce-recognition assistant for a vegetable & fruit shop billing counter in Tamil Nadu, India. The photo shows produce placed on a weighing scale (usually a digital scale with a display).
Do two things:
1. Identify which item from THIS CATALOGUE is on the scale. Return up to 3 candidates, best first, each with a confidence between 0 and 1. Use only ids from the catalogue. If the item is not in the catalogue, return an empty list.
2. Read the weight shown on the scale's display, convert it to kilograms (e.g. "1350 g" -> 1.35, "0.750" kg -> 0.75). If no display or the digits are not clearly readable, set weightKg to null. Also give "count" if the item is sold per piece/bunch/dozen and you can count how many are visible, else null.
Reply with ONLY compact JSON, no prose: {"candidates":[{"id":"...","confidence":0.0}],"weightKg":null,"weightConfidence":0.0,"count":null}

CATALOGUE (id | name / Tamil name | unit):
${list}`;
    const { text } = await callClaude({
      system,
      max_tokens: 400,
      temperature: 0,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } },
        { type: 'text', text: 'Identify the item on the scale and read the weight.' },
      ] }],
    });

    let parsed;
    try { parsed = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)); } catch { parsed = { candidates: [] }; }
    const byId = new Map(catalogue.map(c => [c._id, c]));
    let cands = (Array.isArray(parsed.candidates) ? parsed.candidates : [])
      .map(c => ({ ...byId.get(String(c.id)), confidence: Number(c.confidence) || 0 }))
      .filter(c => c._id)
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 3);

    // Items that look alike → force a human choice among the lookalikes in stock
    let ambiguous = false;
    if (cands.length) {
      const top = cands[0];
      const g = groupOf(top);
      if (g >= 0) {
        const mates = catalogue.filter(c => c._id !== top._id && groupOf(c) === g);
        if (mates.length) {
          ambiguous = true;
          const have = new Set(cands.map(c => c._id));
          mates.forEach(m => { if (!have.has(m._id) && cands.length < 4) cands.push({ ...m, confidence: 0 }); });
        }
      }
      if (!ambiguous && (top.confidence < 0.6 || (cands[1] && top.confidence - cands[1].confidence < 0.25))) ambiguous = true;
    }

    const w = Number(parsed.weightKg);
    res.json({
      success: true,
      matches: cands,
      ambiguous,
      weightKg: Number.isFinite(w) && w > 0 && Number(parsed.weightConfidence) >= 0.6 ? Math.round(w * 1000) / 1000 : null,
      count: Number.isInteger(parsed.count) && parsed.count > 0 ? parsed.count : null,
    });
  } catch (err) {
    console.error('[expressPOS.recognizeItem]', err);
    if (/ANTHROPIC_API_KEY/.test(err.message)) return fail(res, 503, 'Camera recognition is not configured yet');
    fail(res, 500, 'Could not recognise the item — please pick it manually');
  }
};

// ── Add stock from the counter (out-of-stock item arrives / was miscounted) ──
const addStockFromPOS = async (req, res) => {
  try {
    const { productId } = req.params;
    const qty = Number(req.body.qty);
    if (!Number.isFinite(qty) || qty <= 0) return fail(res, 400, 'Enter a quantity greater than 0');
    if (qty > 10000) return fail(res, 400, 'That quantity looks too large — please check');

    const existing = await ExpressStoreProduct.findOne({ store: req.posUser.store, product: productId });
    if (!existing) return fail(res, 404, 'This product is not assigned to your store');
    const previousQty = existing.stockQty || 0;
    const updated = await ExpressStoreProduct.findOneAndUpdate(
      { store: req.posUser.store, product: productId },
      { $inc: { stockQty: qty } }, { new: true });

    await ExpressStockLog.create({
      store: req.posUser.store, product: productId, type: 'addition',
      qty, previousQty, newQty: updated.stockQty,
      reason: String(req.body.note || 'Added from POS counter').slice(0, 200),
      actorType: 'pos', actorName: req.posUser.name || 'POS',
    });
    res.json({ success: true, stockQty: updated.stockQty });
  } catch (err) {
    console.error('[expressPOS.addStockFromPOS]', err);
    fail(res, 500, 'Failed to add stock');
  }
};

module.exports = {
  addStockFromPOS,
  recognizeItem,
  listStoreOrders, storeActivity,
  listProducts, listMyBills, createBill, getBill, updateBillItem, applyDiscount, completeBill, voidBill,
};
