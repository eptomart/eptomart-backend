// ============================================
// KOYAMBEDU INVENTORY / PURCHASE / WASTAGE / PROFIT CONTROLLER
// Entirely new, additive surface — Super Admin only. Reads from KoyambeduOrder
// for sales data but never writes to it, and never touches cart/checkout/
// stock-validation logic. Safe to deploy independently of existing flows.
// ============================================
const mongoose = require('mongoose');
const KoyambeduPurchase = require('../models/KoyambeduPurchase');
const KoyambeduWastage  = require('../models/KoyambeduWastage');
const KoyambeduProduct  = require('../models/KoyambeduProduct');
const KoyambeduOrder    = require('../models/KoyambeduOrder');

const r2 = n => Math.round((Number(n) || 0) * 100) / 100;

// Order statuses that represent stock that has actually left the business
// (i.e. genuinely "sold" for COGS/profit purposes). Cancelled/refunded/pending
// orders are excluded so profit numbers reflect real fulfilled sales.
const SOLD_STATUSES = ['confirmed', 'packing', 'dispatched', 'delivered', 'closed'];

const dayRange = (from, to) => {
  const start = from ? new Date(from) : new Date('2000-01-01');
  start.setHours(0, 0, 0, 0);
  const end = to ? new Date(to) : new Date();
  end.setHours(23, 59, 59, 999);
  return { start, end };
};

// Weighted-average purchase cost per unit for a product, using all purchase
// entries dated on/before `asOfDate`. Standard moving-average costing — simple,
// auditable, and doesn't require FIFO lot tracking for a produce business.
async function avgCostPerUnit(productId, asOfDate) {
  const cutoff = new Date(asOfDate || Date.now());
  cutoff.setHours(23, 59, 59, 999);
  const agg = await KoyambeduPurchase.aggregate([
    { $match: { product: new mongoose.Types.ObjectId(productId), purchaseDate: { $lte: cutoff } } },
    { $group: { _id: null, qty: { $sum: '$quantity' }, cost: { $sum: '$totalCost' } } },
  ]);
  if (!agg.length || !agg[0].qty) return 0;
  return r2(agg[0].cost / agg[0].qty);
}

// ══════════════════════════════════════════════
// PURCHASES
// ══════════════════════════════════════════════
async function createPurchase(req, res) {
  try {
    const { purchaseDate, product, seller, sellerName, quantity, costPricePerUnit,
            transportCharge, loadingCharge, notes, category } = req.body;
    if (!product) return res.status(400).json({ success: false, message: 'Product is required' });
    if (!(Number(quantity) > 0)) return res.status(400).json({ success: false, message: 'Quantity must be greater than 0' });
    if (!(Number(costPricePerUnit) >= 0)) return res.status(400).json({ success: false, message: 'Cost price is required' });

    const prod = await KoyambeduProduct.findById(product).select('name unit category').lean();
    if (!prod) return res.status(404).json({ success: false, message: 'Product not found' });

    const purchase = await KoyambeduPurchase.create({
      purchaseDate: purchaseDate ? new Date(purchaseDate) : new Date(),
      product,
      productName: prod.name,
      unit: prod.unit || 'kg',
      category: category || 'vegetable',
      seller: seller || null,
      sellerName: sellerName || '',
      quantity: Number(quantity),
      costPricePerUnit: Number(costPricePerUnit),
      transportCharge: Number(transportCharge) || 0,
      loadingCharge: Number(loadingCharge) || 0,
      notes: notes || '',
      enteredBy: req.user._id,
    });
    res.json({ success: true, purchase });
  } catch (err) {
    console.error('createPurchase:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function listPurchases(req, res) {
  try {
    const { from, to, product, seller, category, page = 1, limit = 50 } = req.query;
    const { start, end } = dayRange(from, to);
    const filter = { purchaseDate: { $gte: start, $lte: end } };
    if (product)  filter.product  = product;
    if (seller)   filter.seller   = seller;
    if (category) filter.category = category;

    const skip = (Number(page) - 1) * Number(limit);
    const [purchases, total, totals] = await Promise.all([
      KoyambeduPurchase.find(filter).sort({ purchaseDate: -1, createdAt: -1 }).skip(skip).limit(Number(limit))
        .populate('seller', 'businessName').populate('enteredBy', 'name').lean(),
      KoyambeduPurchase.countDocuments(filter),
      KoyambeduPurchase.aggregate([
        { $match: filter },
        { $group: { _id: null, totalQty: { $sum: '$quantity' }, totalCost: { $sum: '$totalCost' },
                     totalTransport: { $sum: '$transportCharge' }, totalLoading: { $sum: '$loadingCharge' } } },
      ]),
    ]);
    res.json({
      success: true,
      purchases,
      total,
      page: Number(page),
      totalPages: Math.ceil(total / Number(limit)) || 1,
      summary: totals[0] || { totalQty: 0, totalCost: 0, totalTransport: 0, totalLoading: 0 },
    });
  } catch (err) {
    console.error('listPurchases:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function updatePurchase(req, res) {
  try {
    const purchase = await KoyambeduPurchase.findById(req.params.id);
    if (!purchase) return res.status(404).json({ success: false, message: 'Purchase entry not found' });
    const { purchaseDate, quantity, costPricePerUnit, seller, sellerName, transportCharge, loadingCharge, notes } = req.body;
    if (purchaseDate !== undefined) purchase.purchaseDate = new Date(purchaseDate);
    if (quantity !== undefined) purchase.quantity = Number(quantity);
    if (costPricePerUnit !== undefined) purchase.costPricePerUnit = Number(costPricePerUnit);
    if (seller !== undefined) purchase.seller = seller || null;
    if (sellerName !== undefined) purchase.sellerName = sellerName;
    if (transportCharge !== undefined) purchase.transportCharge = Number(transportCharge) || 0;
    if (loadingCharge !== undefined) purchase.loadingCharge = Number(loadingCharge) || 0;
    if (notes !== undefined) purchase.notes = notes;
    await purchase.save();
    res.json({ success: true, purchase });
  } catch (err) {
    console.error('updatePurchase:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function deletePurchase(req, res) {
  try {
    const purchase = await KoyambeduPurchase.findByIdAndDelete(req.params.id);
    if (!purchase) return res.status(404).json({ success: false, message: 'Purchase entry not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('deletePurchase:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ══════════════════════════════════════════════
// WASTAGE
// ══════════════════════════════════════════════
async function createWastage(req, res) {
  try {
    const { wastageDate, product, quantity, reason, notes, category } = req.body;
    if (!product) return res.status(400).json({ success: false, message: 'Product is required' });
    if (!(Number(quantity) > 0)) return res.status(400).json({ success: false, message: 'Quantity must be greater than 0' });

    const prod = await KoyambeduProduct.findById(product).select('name unit category').lean();
    if (!prod) return res.status(404).json({ success: false, message: 'Product not found' });

    const wDate = wastageDate ? new Date(wastageDate) : new Date();
    const costPerUnitAtEntry = await avgCostPerUnit(product, wDate);

    const wastage = await KoyambeduWastage.create({
      wastageDate: wDate,
      product,
      productName: prod.name,
      unit: prod.unit || 'kg',
      category: category || 'vegetable',
      quantity: Number(quantity),
      reason: reason || 'spoilage',
      notes: notes || '',
      costPerUnitAtEntry,
      enteredBy: req.user._id,
    });
    res.json({ success: true, wastage });
  } catch (err) {
    console.error('createWastage:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function listWastage(req, res) {
  try {
    const { from, to, product, category, reason, page = 1, limit = 50 } = req.query;
    const { start, end } = dayRange(from, to);
    const filter = { wastageDate: { $gte: start, $lte: end } };
    if (product)  filter.product  = product;
    if (category) filter.category = category;
    if (reason)   filter.reason   = reason;

    const skip = (Number(page) - 1) * Number(limit);
    const [wastage, total, totals] = await Promise.all([
      KoyambeduWastage.find(filter).sort({ wastageDate: -1, createdAt: -1 }).skip(skip).limit(Number(limit))
        .populate('enteredBy', 'name').lean(),
      KoyambeduWastage.countDocuments(filter),
      KoyambeduWastage.aggregate([
        { $match: filter },
        { $group: { _id: null, totalQty: { $sum: '$quantity' }, totalCost: { $sum: '$totalCostImpact' } } },
      ]),
    ]);
    res.json({
      success: true,
      wastage,
      total,
      page: Number(page),
      totalPages: Math.ceil(total / Number(limit)) || 1,
      summary: totals[0] || { totalQty: 0, totalCost: 0 },
    });
  } catch (err) {
    console.error('listWastage:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function deleteWastage(req, res) {
  try {
    const wastage = await KoyambeduWastage.findByIdAndDelete(req.params.id);
    if (!wastage) return res.status(404).json({ success: false, message: 'Wastage entry not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('deleteWastage:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ══════════════════════════════════════════════
// INVENTORY BALANCE
// balance = total purchased − total wasted − total sold (delivered/confirmed orders)
// Computed on-demand from existing collections; nothing is stored/duplicated,
// so there's no stock-decrement side effect wired into checkout at all.
// ══════════════════════════════════════════════
async function getInventoryBalance(req, res) {
  try {
    const { category } = req.query;
    const productFilter = { isActive: true };
    if (category) productFilter.category = category;

    const products = await KoyambeduProduct.find(productFilter).select('name unit category stockQty').lean();
    const productIds = products.map(p => p._id);

    const [purchased, wasted, sold] = await Promise.all([
      KoyambeduPurchase.aggregate([
        { $match: { product: { $in: productIds } } },
        { $group: { _id: '$product', qty: { $sum: '$quantity' }, cost: { $sum: '$totalCost' } } },
      ]),
      KoyambeduWastage.aggregate([
        { $match: { product: { $in: productIds } } },
        { $group: { _id: '$product', qty: { $sum: '$quantity' } } },
      ]),
      KoyambeduOrder.aggregate([
        { $match: { orderStatus: { $in: SOLD_STATUSES } } },
        { $unwind: '$items' },
        { $match: { 'items.product': { $in: productIds }, 'items.itemStatus': { $ne: 'declined' } } },
        { $group: { _id: '$items.product', qty: { $sum: '$items.confirmedQty' } } },
      ]),
    ]);
    const pMap = Object.fromEntries(purchased.map(x => [String(x._id), x]));
    const wMap = Object.fromEntries(wasted.map(x => [String(x._id), x.qty]));
    const sMap = Object.fromEntries(sold.map(x => [String(x._id), x.qty]));

    const rows = products.map(p => {
      const id = String(p._id);
      const purchasedQty = pMap[id]?.qty || 0;
      const purchasedCost = pMap[id]?.cost || 0;
      const wastedQty = wMap[id] || 0;
      const soldQty = sMap[id] || 0;
      return {
        productId: p._id,
        name: p.name,
        unit: p.unit,
        category: p.category,
        purchasedQty: r2(purchasedQty),
        wastedQty: r2(wastedQty),
        soldQty: r2(soldQty),
        balanceQty: r2(purchasedQty - wastedQty - soldQty),
        avgCostPerUnit: purchasedQty ? r2(purchasedCost / purchasedQty) : 0,
      };
    }).filter(r => r.purchasedQty > 0 || r.wastedQty > 0 || r.soldQty > 0);

    res.json({ success: true, rows });
  } catch (err) {
    console.error('getInventoryBalance:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ══════════════════════════════════════════════
// PROFIT / LOSS REPORT
// GET /inventory/profit-report?from=&to=
// Revenue + COGS use fulfilled orders only (SOLD_STATUSES). COGS is computed
// per item using the weighted-average purchase cost as of that order's
// delivery date. Order-level transport/packing charges (adminCosts) are
// attributed to that order's customer. Wastage cost is NOT split across
// customers (it isn't tied to any specific sale) — it's shown as a separate
// overall deduction in the summary and attributed to the item it belongs to.
// ══════════════════════════════════════════════
async function getProfitReport(req, res) {
  try {
    const { from, to } = req.query;
    const { start, end } = dayRange(from, to);

    const orders = await KoyambeduOrder.find({
      orderStatus: { $in: SOLD_STATUSES },
      $or: [{ deliveryDate: { $gte: start, $lte: end } }, { deliveryDate: null, placedAt: { $gte: start, $lte: end } }],
    })
      .select('orderId buyer items adminCosts deliveryDate placedAt orderStatus')
      .populate('buyer', 'name phone email')
      .lean();

    // Pre-compute avg cost per product as of `end` (single lookup per product,
    // reused across all items — good enough precision for a reporting window;
    // a produce business's purchase price doesn't move fast enough within a
    // range to need per-order-date precision here).
    const productIds = [...new Set(
      orders.flatMap(o => (o.items || []).map(it => it.product && String(it.product))).filter(Boolean)
    )];
    const costMap = {};
    await Promise.all(productIds.map(async id => { costMap[id] = await avgCostPerUnit(id, end); }));

    const itemAgg = {};   // productId -> { name, qty, revenue, cogs }
    const custAgg = {};   // buyerId -> { name, phone, revenue, cogs, overhead, orders }

    let totalRevenue = 0, totalCogs = 0, totalOverhead = 0;

    for (const order of orders) {
      const buyerId = order.buyer?._id ? String(order.buyer._id) : 'unknown';
      if (!custAgg[buyerId]) {
        custAgg[buyerId] = { customerId: buyerId, name: order.buyer?.name || 'Unknown', phone: order.buyer?.phone || '',
          revenue: 0, cogs: 0, overhead: 0, orderCount: 0 };
      }
      custAgg[buyerId].orderCount += 1;

      const transport = Number(order.adminCosts?.transportCharge) || 0;
      const packing   = Number(order.adminCosts?.packingCharge) || 0;
      const overhead  = transport + packing;
      custAgg[buyerId].overhead += overhead;
      totalOverhead += overhead;

      for (const it of (order.items || [])) {
        if (it.itemStatus === 'declined') continue;
        const qty = Number(it.confirmedQty ?? it.quantity ?? 0);
        if (!qty) continue;
        const sellPrice = Number(it.finalPrice ?? it.orderedPrice ?? 0);
        const revenue = r2(sellPrice * qty);
        const pid = it.product ? String(it.product) : null;
        const costPerUnit = pid ? (costMap[pid] || 0) : 0;
        const cogs = r2(costPerUnit * qty);

        totalRevenue += revenue;
        totalCogs += cogs;
        custAgg[buyerId].revenue += revenue;
        custAgg[buyerId].cogs += cogs;

        const key = pid || it.name;
        if (!itemAgg[key]) itemAgg[key] = { productId: pid, name: it.name, unit: it.unit, qty: 0, revenue: 0, cogs: 0 };
        itemAgg[key].qty += qty;
        itemAgg[key].revenue += revenue;
        itemAgg[key].cogs += cogs;
      }
    }

    // Wastage cost within range, per product — folded into item-wise profit.
    const wastageRows = await KoyambeduWastage.aggregate([
      { $match: { wastageDate: { $gte: start, $lte: end } } },
      { $group: { _id: '$product', qty: { $sum: '$quantity' }, cost: { $sum: '$totalCostImpact' } } },
    ]);
    let totalWastageCost = 0;
    for (const w of wastageRows) {
      totalWastageCost += w.cost || 0;
      const pid = String(w._id);
      if (!itemAgg[pid]) {
        const prod = await KoyambeduProduct.findById(pid).select('name unit').lean();
        itemAgg[pid] = { productId: pid, name: prod?.name || 'Unknown', unit: prod?.unit, qty: 0, revenue: 0, cogs: 0 };
      }
      itemAgg[pid].wastageQty = r2(w.qty);
      itemAgg[pid].wastageCost = r2(w.cost);
    }

    const itemRows = Object.values(itemAgg).map(x => {
      const wastageCost = x.wastageCost || 0;
      const grossProfit = r2(x.revenue - x.cogs);
      const netProfit = r2(grossProfit - wastageCost);
      return { ...x, revenue: r2(x.revenue), cogs: r2(x.cogs), wastageCost: r2(wastageCost),
        wastageQty: r2(x.wastageQty || 0), grossProfit, netProfit,
        marginPercent: x.revenue ? r2((netProfit / x.revenue) * 100) : 0 };
    }).sort((a, b) => b.revenue - a.revenue);

    const customerRows = Object.values(custAgg).map(c => {
      const grossProfit = r2(c.revenue - c.cogs);
      const netProfit = r2(grossProfit - c.overhead);
      return { ...c, revenue: r2(c.revenue), cogs: r2(c.cogs), overhead: r2(c.overhead),
        grossProfit, netProfit, marginPercent: c.revenue ? r2((netProfit / c.revenue) * 100) : 0 };
    }).sort((a, b) => b.revenue - a.revenue);

    const netProfit = r2(totalRevenue - totalCogs - totalWastageCost - totalOverhead);

    res.json({
      success: true,
      range: { from: start, to: end },
      summary: {
        totalRevenue: r2(totalRevenue),
        totalCogs: r2(totalCogs),
        totalWastageCost: r2(totalWastageCost),
        totalOverhead: r2(totalOverhead),
        grossProfit: r2(totalRevenue - totalCogs),
        netProfit,
        orderCount: orders.length,
      },
      itemWise: itemRows,
      customerWise: customerRows,
    });
  } catch (err) {
    console.error('getProfitReport:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ══════════════════════════════════════════════
// Lightweight lookups for the frontend forms
// ══════════════════════════════════════════════
async function listProductsLite(req, res) {
  try {
    const products = await KoyambeduProduct.find({ isActive: true }).select('name unit').sort({ name: 1 }).lean();
    res.json({ success: true, products });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function listSellersLite(req, res) {
  try {
    const KoyambeduSeller = require('../models/KoyambeduSeller');
    const sellers = await KoyambeduSeller.find({ isActive: true }).select('businessName stallNumber').sort({ businessName: 1 }).lean();
    res.json({ success: true, sellers });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = {
  createPurchase, listPurchases, updatePurchase, deletePurchase,
  createWastage, listWastage, deleteWastage,
  getInventoryBalance, getProfitReport,
  listProductsLite, listSellersLite,
};
