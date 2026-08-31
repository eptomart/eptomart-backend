// ============================================
// REORDER SERVICE — add a past order's items
// back into the vertical's cart.
//
// koyambedu / eptofresh: server-side carts → items merged here,
//   validated against CURRENT availability and CURRENT prices.
// eptomart: cart is client-side (localStorage) → we return the
//   item list and the frontend adds them via CartContext.
// uzhavar: no persistent cart (per-farmer flow) → frontend
//   redirects to the farmer's page.
// ============================================
'use strict';

const KoyambeduOrder   = require('../../models/KoyambeduOrder');
const KoyambeduCart    = require('../../models/KoyambeduCart');
const KoyambeduProduct = require('../../models/KoyambeduProduct');
const EptoFreshOrder   = require('../../models/EptoFreshOrder');
const EptoFreshCart    = require('../../models/EptoFreshCart');
const EptoFreshProduct = require('../../models/EptoFreshProduct');
const Order            = require('../../models/Order');
const Product          = require('../../models/Product');
const UzhavarOrder     = require('../../models/UzhavarOrder');
const FruitBasketOrder   = require('../../models/FruitBasketOrder');
const FruitBasketCart    = require('../../models/FruitBasketCart');
const FruitBasketProduct = require('../../models/FruitBasketProduct');

/** Original items of an order (immutable snapshot preferred). */
function sourceItems(order) {
  if (order.itemsOrdered?.length) return order.itemsOrdered;
  return order.items || [];
}

// ── Koyambedu: merge into server cart at TODAY's price ──
async function reorderKoyambedu(userId, orderId) {
  const order = await KoyambeduOrder.findOne({ _id: orderId, buyer: userId }).lean();
  if (!order) { const e = new Error('Order not found'); e.status = 404; throw e; }

  let cart = await KoyambeduCart.findOne({ user: userId });
  if (!cart) cart = new KoyambeduCart({ user: userId, items: [] });
  // Clear existing cart so repeated reorders don't multiply quantities
  cart.items = [];

  let added = 0;
  const skipped = [];

  for (const it of sourceItems(order)) {
    const qty = Number(it.orderedQty ?? it.quantity ?? 0);
    if (!it.product || qty <= 0) continue;

    const product = await KoyambeduProduct.findOne({ _id: it.product, isActive: true, isAvailable: true })
      .populate('seller', '_id status isActive');
    if (!product || product.seller?.status !== 'approved' || !product.seller?.isActive) {
      skipped.push(it.name || 'Unknown item');
      continue;
    }

    // ── Current price: grade-specific variants → root variants → currentPrice ──
    let unitPrice = product.currentPrice || 0;
    if (it.gradeKey && product.gradesEnabled && product.grades?.length > 0) {
      // Graded product: price comes from the grade's own variant tiers
      const grade = product.grades.find(g => g.gradeKey === it.gradeKey);
      if (grade?.variants?.length > 0) {
        const v = grade.variants.find(v =>
          v.toQty ? (qty >= v.fromQty && qty <= v.toQty) : qty >= v.fromQty);
        if (v?.finalPrice) unitPrice = v.finalPrice;
        else unitPrice = grade.variants[grade.variants.length - 1]?.finalPrice || unitPrice;
      }
    } else if (product.variants?.length > 0) {
      // Non-graded variant product: standard tier lookup
      const v = product.variants.find(v =>
        v.toQty ? (qty >= v.fromQty && qty <= v.toQty) : qty >= v.fromQty);
      if (v?.finalPrice) unitPrice = v.finalPrice;
    }

    const maxQtyVal = (product.maxQty != null) ? product.maxQty : Infinity;
    // IMPORTANT: match by product _id AND gradeKey — grades are distinct line items
    const idx = cart.items.findIndex(i =>
      String(i.product) === String(product._id) &&
      (i.gradeKey || null) === (it.gradeKey || null)
    );
    const newQty = Math.min(maxQtyVal, (idx > -1 ? Number(cart.items[idx].quantity || 0) : 0) + qty);

    const itemData = {
      product:      product._id,
      seller:       product.seller._id,
      name:         product.name,
      unitPrice,
      unit:         product.unit,
      quantity:     newQty,
      deliveryType: product.isNextDay ? 'tomorrow' : 'today',
      gradeKey:     it.gradeKey  || undefined,
      gradeName:    it.gradeName || undefined,
    };
    if (idx > -1) Object.assign(cart.items[idx], itemData);
    else cart.items.push(itemData);
    added++;
  }

  await cart.save();
  return { mode: 'server', added, skipped, cartPath: '/koyambedu/cart' };
}

// ── EptoFresh Proteins: single-seller cart → replaced with this order ──
async function reorderEptoFresh(userId, orderId) {
  const order = await EptoFreshOrder.findOne({ _id: orderId, buyer: userId }).lean();
  if (!order) { const e = new Error('Order not found'); e.status = 404; throw e; }

  let added = 0;
  const skipped = [];
  const newItems = [];

  for (const it of order.items || []) {
    const qty = Number(it.quantity || 0);
    if (!it.product || qty <= 0) continue;

    const product = await EptoFreshProduct.findById(it.product).lean();
    if (!product || product.status === 'inactive' || product.isActive === false) {
      skipped.push(it.productName || 'Unknown item');
      continue;
    }

    // Match the variant by label/weight for CURRENT price
    const variants = product.variants || [];
    const v = variants.find(x => x.label === it.variant?.label) ||
              variants.find(x => Number(x.weight) === Number(it.variant?.weight)) ||
              variants[0];
    if (!v) { skipped.push(it.productName || product.name); continue; }

    newItems.push({
      product:   product._id,
      variantId: v._id,
      weight:    v.weight,
      label:     v.label,
      price:     v.price,
      quantity:  qty,
      cutType:   it.cutType || '',
      name:      product.name || it.productName,
      image:     product.images?.find?.(i => i.isPrimary)?.url || product.images?.[0]?.url || '',
    });
    added++;
  }

  if (!added) return { mode: 'server', added: 0, skipped, cartPath: '/eptofresh/cart' };

  // Hyperlocal single-seller constraint → cart is replaced by this order's seller
  await EptoFreshCart.findOneAndUpdate(
    { user: userId },
    { user: userId, seller: order.seller, items: newItems, distanceKm: order.distanceKm || 0 },
    { upsert: true, new: true },
  );
  return { mode: 'server', added, skipped, replacedCart: true, cartPath: '/eptofresh/cart' };
}

// ── Eptomart parent: client-side cart → return items for the frontend ──
async function reorderEptomart(userId, orderId) {
  const order = await Order.findOne({ _id: orderId, user: userId }).lean();
  if (!order) { const e = new Error('Order not found'); e.status = 404; throw e; }

  const items = [];
  const skipped = [];
  for (const it of sourceItems(order)) {
    const qty = Number(it.orderedQty ?? it.quantity ?? 0);
    if (!it.product || qty <= 0) continue;
    const product = await Product.findOne({ _id: it.product, isActive: { $ne: false } }).lean();
    if (!product || (product.stock != null && product.stock <= 0)) {
      skipped.push(it.name || 'Unknown item');
      continue;
    }
    items.push({ product, quantity: qty });
  }
  return { mode: 'client', items, skipped, cartPath: '/cart' };
}

// ── Farmer Fresh: per-farmer flow → redirect to the farmer's page ──
async function reorderUzhavar(userId, orderId) {
  const order = await UzhavarOrder.findOne({ _id: orderId, buyer: userId }).select('farmer').lean();
  if (!order) { const e = new Error('Order not found'); e.status = 404; throw e; }
  return {
    mode: 'redirect',
    redirect: `/uzhavar/farmer/${order.farmer}`,
    message: 'Farmer Fresh orders are placed per farmer — pick your items on the farmer’s page.',
  };
}

// ── Fruit Baskets & Hampers: merge into server cart at TODAY's price ──
async function reorderFruitBasket(userId, orderId) {
  const order = await FruitBasketOrder.findOne({ _id: orderId, buyer: userId }).lean();
  if (!order) { const e = new Error('Order not found'); e.status = 404; throw e; }

  let cart = await FruitBasketCart.findOne({ user: userId });
  if (!cart) cart = new FruitBasketCart({ user: userId, items: [] });
  cart.items = [];

  let added = 0;
  const skipped = [];

  for (const it of order.items || []) {
    const qty = Number(it.quantity || 0);
    if (!it.product || qty <= 0) continue;

    const product = await FruitBasketProduct.findOne({ _id: it.product, isAvailable: { $ne: false } }).lean();
    if (!product || (product.stock != null && product.stock <= 0)) {
      skipped.push(it.name || 'Unknown item');
      continue;
    }

    cart.items.push({
      product:        product._id,
      name:           product.name,
      price:          product.price,
      compareAtPrice: product.compareAtPrice,
      image:          product.images?.[0] || it.image || '',
      occasion:       product.occasion,
      weightKg:       product.weightKg,
      quantity:       qty,
    });
    added++;
  }

  await cart.save();
  return { mode: 'server', added, skipped, cartPath: '/fruitbaskets/shop' };
}

const HANDLERS = {
  koyambedu:   reorderKoyambedu,
  eptofresh:   reorderEptoFresh,
  eptomart:    reorderEptomart,
  uzhavar:     reorderUzhavar,
  fruitbasket: reorderFruitBasket,
};

async function reorder(userId, verticalKey, orderId) {
  const handler = HANDLERS[verticalKey];
  if (!handler) { const e = new Error(`Reorder not supported for: ${verticalKey}`); e.status = 400; throw e; }
  return handler(userId, orderId);
}

module.exports = { reorder };
