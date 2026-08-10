// ============================================
// KOYAMBEDU INVENTORY / PURCHASE / WASTAGE / PROFIT CONTROLLER
// Entirely new, additive surface — Super Admin only. Reads from KoyambeduOrder
// for sales data but never writes to it, and never touches cart/checkout/
// stock-validation logic. Safe to deploy independently of existing flows.
// ============================================
const mongoose = require('mongoose');
const KoyambeduPurchase      = require('../models/KoyambeduPurchase');
const KoyambeduWastage       = require('../models/KoyambeduWastage');
const KoyambeduProduct       = require('../models/KoyambeduProduct');
const KoyambeduOrder         = require('../models/KoyambeduOrder');
const KoyambeduMaterialUsage = require('../models/KoyambeduMaterialUsage');
const { deleteImage } = require('../config/cloudinary');

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
    const { purchaseDate, itemType, product, itemName, seller, sellerName, quantity, costPricePerUnit,
            transportCharge, loadingCharge, notes } = req.body;
    if (!(Number(quantity) > 0)) return res.status(400).json({ success: false, message: 'Quantity must be greater than 0' });
    if (!(Number(costPricePerUnit) >= 0)) return res.status(400).json({ success: false, message: 'Cost price is required' });

    const type = ['produce', 'packing_material', 'other'].includes(itemType) ? itemType : 'produce';
    let resolvedName, resolvedCategory, resolvedUnit = 'kg';

    if (type === 'produce') {
      // Item name & category are auto-populated from the live, active Koyambedu
      // Daily catalog — admin only picks the product, nothing is typed by hand.
      if (!product) return res.status(400).json({ success: false, message: 'Select a product' });
      const prod = await KoyambeduProduct.findById(product).select('name unit category').populate('category', 'name').lean();
      if (!prod) return res.status(404).json({ success: false, message: 'Product not found' });
      resolvedName = prod.name;
      resolvedCategory = prod.category?.name || 'Uncategorized';
      resolvedUnit = prod.unit || 'kg';
    } else {
      if (!itemName || !itemName.trim()) return res.status(400).json({ success: false, message: 'Enter an item name' });
      resolvedName = itemName.trim();
      resolvedCategory = type === 'packing_material' ? 'Packing Material' : 'Other';
      resolvedUnit = (req.body.unit || 'pcs').trim();
    }

    const purchase = await KoyambeduPurchase.create({
      purchaseDate: purchaseDate ? new Date(purchaseDate) : new Date(),
      itemType: type,
      product: type === 'produce' ? product : null,
      itemName: resolvedName,
      category: resolvedCategory,
      unit: resolvedUnit,
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

// POST /inventory/purchases/:id/bill — optional bill/receipt attachment.
// Uses multer(uploadKoyambeduBill).single('bill') as route middleware, so the
// uploaded file is already on Cloudinary by the time this handler runs.
async function uploadPurchaseBill(req, res) {
  try {
    const purchase = await KoyambeduPurchase.findById(req.params.id);
    if (!purchase) return res.status(404).json({ success: false, message: 'Purchase entry not found' });
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });

    // Replace any previously attached bill.
    if (purchase.billPublicId) {
      await deleteImage(purchase.billPublicId, 'auto').catch(() => {});
    }
    purchase.billUrl = req.file.path || req.file.secure_url || '';
    purchase.billPublicId = req.file.filename || req.file.public_id || '';
    await purchase.save();
    res.json({ success: true, purchase });
  } catch (err) {
    console.error('uploadPurchaseBill:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function listPurchases(req, res) {
  try {
    const { from, to, product, seller, category, itemType, page = 1, limit = 50 } = req.query;
    const { start, end } = dayRange(from, to);
    const filter = { purchaseDate: { $gte: start, $lte: end } };
    if (product)  filter.product  = product;
    if (seller)   filter.seller   = seller;
    if (category) filter.category = category;
    if (itemType) filter.itemType = itemType;

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
    const { wastageDate, product, quantity, reason, notes } = req.body;
    if (!product) return res.status(400).json({ success: false, message: 'Product is required' });
    if (!(Number(quantity) > 0)) return res.status(400).json({ success: false, message: 'Quantity must be greater than 0' });

    // Item name & category auto-populated from the live, active product — same
    // catalog-driven approach as Purchases, nothing typed by hand.
    const prod = await KoyambeduProduct.findById(product).select('name unit category').populate('category', 'name').lean();
    if (!prod) return res.status(404).json({ success: false, message: 'Product not found' });

    const wDate = wastageDate ? new Date(wastageDate) : new Date();
    const costPerUnitAtEntry = await avgCostPerUnit(product, wDate);

    const wastage = await KoyambeduWastage.create({
      wastageDate: wDate,
      product,
      productName: prod.name,
      unit: prod.unit || 'kg',
      category: prod.category?.name || 'Uncategorized',
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
    const { categoryId } = req.query;
    const productFilter = { isActive: { $ne: false } };
    if (categoryId) productFilter.category = categoryId;

    const products = await KoyambeduProduct.find(productFilter).select('name unit category stockQty')
      .populate('category', 'name').lean();
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
        category: p.category?.name || '',
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
// MATERIAL USAGE — packing materials (or other non-produce purchases) linked
// to the specific customer order they were consumed for.
// ══════════════════════════════════════════════

// GET /inventory/orders/lookup?orderId=EPT-KBD-... — small helper so the
// admin can find the right order to attach a material-usage entry to.
async function lookupOrder(req, res) {
  try {
    const { orderId } = req.query;
    if (!orderId || !orderId.trim()) return res.json({ success: true, orders: [] });
    const orders = await KoyambeduOrder.find({ orderId: { $regex: orderId.trim(), $options: 'i' } })
      .select('orderId buyer deliveryDate orderStatus').populate('buyer', 'name phone')
      .sort({ createdAt: -1 }).limit(10).lean();
    res.json({ success: true, orders });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// List packing_material/other purchase batches — used to populate the "which
// material" dropdown when logging usage against an order.
async function listMaterialPurchases(req, res) {
  try {
    const purchases = await KoyambeduPurchase.find({ itemType: { $in: ['packing_material', 'other'] } })
      .sort({ purchaseDate: -1 }).limit(200).select('itemName unit quantity costPricePerUnit purchaseDate').lean();
    res.json({ success: true, purchases });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function createMaterialUsage(req, res) {
  try {
    const { orderId, purchase, materialName, unit, quantity, costPerUnit, usageDate, notes } = req.body;
    if (!orderId) return res.status(400).json({ success: false, message: 'Order is required' });
    if (!(Number(quantity) > 0)) return res.status(400).json({ success: false, message: 'Quantity must be greater than 0' });

    const order = await KoyambeduOrder.findById(orderId).select('orderId').lean();
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    let resolvedName = materialName, resolvedUnit = unit || 'pcs', resolvedCost = Number(costPerUnit) || 0;
    if (purchase) {
      const p = await KoyambeduPurchase.findById(purchase).select('itemName unit costPricePerUnit').lean();
      if (p) {
        resolvedName = resolvedName || p.itemName;
        resolvedUnit = unit || p.unit;
        resolvedCost = costPerUnit !== undefined && costPerUnit !== '' ? Number(costPerUnit) : p.costPricePerUnit;
      }
    }
    if (!resolvedName || !resolvedName.trim()) return res.status(400).json({ success: false, message: 'Material name is required' });

    const usage = await KoyambeduMaterialUsage.create({
      order: order._id,
      orderIdLabel: order.orderId,
      purchase: purchase || null,
      materialName: resolvedName.trim(),
      unit: resolvedUnit,
      quantity: Number(quantity),
      costPerUnit: resolvedCost,
      usageDate: usageDate ? new Date(usageDate) : new Date(),
      notes: notes || '',
      enteredBy: req.user._id,
    });
    res.json({ success: true, usage });
  } catch (err) {
    console.error('createMaterialUsage:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function listMaterialUsage(req, res) {
  try {
    const { from, to, orderId, page = 1, limit = 50 } = req.query;
    const filter = {};
    if (from || to) { const { start, end } = dayRange(from, to); filter.usageDate = { $gte: start, $lte: end }; }
    if (orderId) filter.orderIdLabel = { $regex: orderId, $options: 'i' };

    const skip = (Number(page) - 1) * Number(limit);
    const [usage, total, totals] = await Promise.all([
      KoyambeduMaterialUsage.find(filter).sort({ usageDate: -1, createdAt: -1 }).skip(skip).limit(Number(limit))
        .populate('enteredBy', 'name').lean(),
      KoyambeduMaterialUsage.countDocuments(filter),
      KoyambeduMaterialUsage.aggregate([
        { $match: filter },
        { $group: { _id: null, totalQty: { $sum: '$quantity' }, totalCost: { $sum: '$totalCost' } } },
      ]),
    ]);
    res.json({
      success: true, usage, total, page: Number(page), totalPages: Math.ceil(total / Number(limit)) || 1,
      summary: totals[0] || { totalQty: 0, totalCost: 0 },
    });
  } catch (err) {
    console.error('listMaterialUsage:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function deleteMaterialUsage(req, res) {
  try {
    const usage = await KoyambeduMaterialUsage.findByIdAndDelete(req.params.id);
    if (!usage) return res.status(404).json({ success: false, message: 'Usage entry not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('deleteMaterialUsage:', err);
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

    // Order-linked packing-material usage cost, grouped per order — folded
    // into that order's (customer's) overhead alongside the flat transport/
    // packing charges from adminCosts.
    const orderIds = orders.map(o => o._id);
    const materialUsageByOrder = {};
    if (orderIds.length) {
      const usageRows = await KoyambeduMaterialUsage.aggregate([
        { $match: { order: { $in: orderIds } } },
        { $group: { _id: '$order', cost: { $sum: '$totalCost' } } },
      ]);
      usageRows.forEach(u => { materialUsageByOrder[String(u._id)] = u.cost || 0; });
    }

    const itemAgg = {};   // productId -> { name, qty, revenue, cogs }
    const custAgg = {};   // buyerId -> { name, phone, revenue, cogs, overhead, orders }

    let totalRevenue = 0, totalCogs = 0, totalOverhead = 0, totalMaterialUsage = 0;

    for (const order of orders) {
      const buyerId = order.buyer?._id ? String(order.buyer._id) : 'unknown';
      if (!custAgg[buyerId]) {
        custAgg[buyerId] = { customerId: buyerId, name: order.buyer?.name || 'Unknown', phone: order.buyer?.phone || '',
          revenue: 0, cogs: 0, overhead: 0, orderCount: 0 };
      }
      custAgg[buyerId].orderCount += 1;

      const transport = Number(order.adminCosts?.transportCharge) || 0;
      const packing   = Number(order.adminCosts?.packingCharge) || 0;
      const materialUsage = materialUsageByOrder[String(order._id)] || 0;
      const overhead  = transport + packing + materialUsage;
      custAgg[buyerId].overhead += overhead;
      totalOverhead += overhead;
      totalMaterialUsage += materialUsage;

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
        totalMaterialUsage: r2(totalMaterialUsage),
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
    // Match the same defensive pattern used elsewhere in this codebase (see
    // koyambeduController.js product-listing queries): some legacy product
    // docs never had `isActive` explicitly written, so a strict `{isActive:
    // true}` match silently excludes them. Treat "missing" the same as
    // "true" — only an explicit `false` should hide an item here.
    const products = await KoyambeduProduct.find({ isActive: { $ne: false } }).select('name unit').sort({ name: 1 }).lean();
    res.json({ success: true, products });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function listSellersLite(req, res) {
  try {
    const KoyambeduSeller = require('../models/KoyambeduSeller');
    const sellers = await KoyambeduSeller.find({ isActive: { $ne: false } }).select('businessName stallNumber').sort({ businessName: 1 }).lean();
    res.json({ success: true, sellers });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = {
  createPurchase, uploadPurchaseBill, listPurchases, updatePurchase, deletePurchase,
  createWastage, listWastage, deleteWastage,
  getInventoryBalance, getProfitReport,
  listProductsLite, listSellersLite,
  lookupOrder, listMaterialPurchases,
  createMaterialUsage, listMaterialUsage, deleteMaterialUsage,
};
