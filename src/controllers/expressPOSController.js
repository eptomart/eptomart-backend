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
const { computeSellingPrice } = require('../services/expressPricingService');

const fail = (res, status, message) => res.status(status).json({ success: false, message });
const MAX_HELD_BILLS = 4;

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
      .populate({ path: 'product', populate: { path: 'koyambeduProduct', select: 'name' } })
      .lean();

    const products = storeProducts
      .filter(sp => sp.product?.koyambeduProduct)
      .map(sp => ({
        _id: sp.product._id,
        name: sp.product.koyambeduProduct.name,
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
  bill.total = bill.subtotal;
}

const createBill = async (req, res) => {
  try {
    const heldCount = await ExpressBill.countDocuments({ posUser: req.posUser._id, status: 'held' });
    if (heldCount >= MAX_HELD_BILLS) {
      return fail(res, 400, `You already have ${MAX_HELD_BILLS} held bills — complete or void one before starting a new bill.`);
    }

    const { customerName, customerPhone } = req.body;
    const bill = await ExpressBill.create({
      billNo: genBillNo(),
      store: req.posUser.store,
      posUser: req.posUser._id,
      posUserName: req.posUser.name,
      customerName: customerName || 'Walk-in Customer',
      customerPhone,
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

const completeBill = async (req, res) => {
  try {
    const { paymentMethod } = req.body;
    const bill = await ExpressBill.findOne({ _id: req.params.billId, posUser: req.posUser._id, createdAt: { $gte: req.posSessionAt } });
    if (!bill) return fail(res, 404, 'Bill not found');
    if (bill.status !== 'held') return fail(res, 400, 'Bill already processed');
    if (bill.items.length === 0) return fail(res, 400, 'Add at least one item before completing the sale');

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
    bill.paymentMethod = paymentMethod || 'cash';
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

module.exports = {
  listProducts, listMyBills, createBill, getBill, updateBillItem, completeBill, voidBill,
};
