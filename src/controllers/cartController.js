const Cart    = require('../models/Cart');
const Product = require('../models/Product');
const Seller  = require('../models/Seller');
const { calcOrderGst, extractBasePrice } = require('../utils/gstCalculator');
const business = require('../../config/business');

const buildCartSummary = (items, buyerState = business.state) => {
  const lineItems = items.map(item => {
    const p       = item.priceSnapshot || {};
    const price   = p.price   || 0;
    const gstRate = p.gstRate || 18;
    const unitPriceExGst = extractBasePrice(price, gstRate);
    const seller  = item.seller;
    const sellerState = seller?.address?.state || business.state;
    const { gstAmount, lineGrandTotal, cgstAmount, sgstAmount, igstAmount, gstType } =
      require('../utils/gstCalculator').calcLineGst(unitPriceExGst, gstRate, item.quantity, sellerState, buyerState);

    return {
      _id:           item._id,
      product:       item.product,
      seller:        item.seller,
      quantity:      item.quantity,
      name:          p.name,
      image:         p.image,
      stock:         p.stock,
      codAvailable:  p.codAvailable,
      price,
      gstRate,
      unitPriceExGst,
      gstPerUnit:    parseFloat((gstAmount / item.quantity).toFixed(2)),
      lineTotal:     parseFloat((unitPriceExGst * item.quantity).toFixed(2)),
      lineGst:       parseFloat(gstAmount.toFixed(2)),
      lineGrandTotal:parseFloat(lineGrandTotal.toFixed(2)),
      cgstAmount, sgstAmount, igstAmount, gstType,
    };
  });

  const subtotalExGst = lineItems.reduce((s, l) => s + l.lineTotal, 0);
  const cgstTotal     = lineItems.reduce((s, l) => s + l.cgstAmount, 0);
  const sgstTotal     = lineItems.reduce((s, l) => s + l.sgstAmount, 0);
  const igstTotal     = lineItems.reduce((s, l) => s + l.igstAmount, 0);
  const gstTotal      = parseFloat((cgstTotal + sgstTotal + igstTotal).toFixed(2));
  const shipping      = subtotalExGst + gstTotal >= 499 ? 0 : 49;
  const grandTotal    = parseFloat((subtotalExGst + gstTotal + shipping).toFixed(2));
  const itemCount     = lineItems.reduce((s, l) => s + l.quantity, 0);

  return {
    items: lineItems,
    summary: {
      subtotalExGst: parseFloat(subtotalExGst.toFixed(2)),
      cgstTotal:     parseFloat(cgstTotal.toFixed(2)),
      sgstTotal:     parseFloat(sgstTotal.toFixed(2)),
      igstTotal:     parseFloat(igstTotal.toFixed(2)),
      gstTotal,
      shipping,
      grandTotal,
      itemCount,
    },
  };
};

// ── GET /api/cart ─────────────────────────────────────────
const getCart = async (req, res) => {
  let cart = await Cart.findOne({ user: req.user._id })
    .populate({
      path: 'items.product',
      select: 'name slug price discountPrice gstRate images stock codAvailable isActive approvalStatus',
    })
    .populate({ path: 'items.seller', select: 'businessName address.state address.city' })
    .lean();

  if (!cart) return res.json({ success: true, cart: { items: [], summary: { itemCount: 0, grandTotal: 0 } } });

  // Remove items with inactive/deleted products
  const validItems = cart.items.filter(i => i.product?.isActive && i.product?.approvalStatus === 'approved');
  const { items, summary } = buildCartSummary(validItems, req.user.defaultAddress?.state);

  res.json({ success: true, cart: { items, summary } });
};

// ── POST /api/cart/add ────────────────────────────────────
const addToCart = async (req, res) => {
  const { productId, sellerId, quantity = 1 } = req.body;
  if (!productId) return res.status(400).json({ success: false, message: 'productId required' });

  const product = await Product.findById(productId).lean();
  if (!product || !product.isActive) {
    return res.status(404).json({ success: false, message: 'Product not available' });
  }
  if (product.stock < quantity) {
    return res.status(400).json({ success: false, message: `Only ${product.stock} units available` });
  }

  let cart = await Cart.findOne({ user: req.user._id });
  if (!cart) cart = await Cart.create({ user: req.user._id, items: [] });

  const existingIdx = cart.items.findIndex(
    i => i.product.toString() === productId &&
         (sellerId ? i.seller?.toString() === sellerId : true)
  );

  const snapshot = {
    price:       product.discountPrice || product.price,
    gstRate:     product.gstRate || 18,
    name:        product.name,
    image:       product.images?.[0]?.url || '',
    stock:       product.stock,
    codAvailable: product.codAvailable !== false,
  };

  if (existingIdx >= 0) {
    const newQty = cart.items[existingIdx].quantity + quantity;
    if (newQty > product.stock) {
      return res.status(400).json({ success: false, message: `Max ${product.stock} units allowed` });
    }
    cart.items[existingIdx].quantity = newQty;
    cart.items[existingIdx].priceSnapshot = snapshot;
  } else {
    cart.items.push({ product: productId, seller: sellerId || undefined, quantity, priceSnapshot: snapshot });
  }

  await cart.save();
  res.json({ success: true, message: 'Added to cart', itemCount: cart.items.reduce((s, i) => s + i.quantity, 0) });
};

// ── PUT /api/cart/item/:itemId ────────────────────────────
const updateCartItem = async (req, res) => {
  const { quantity } = req.body;
  if (!quantity || quantity < 1) {
    return res.status(400).json({ success: false, message: 'quantity must be >= 1' });
  }

  const cart = await Cart.findOne({ user: req.user._id });
  if (!cart) return res.status(404).json({ success: false, message: 'Cart not found' });

  const item = cart.items.id(req.params.itemId);
  if (!item) return res.status(404).json({ success: false, message: 'Cart item not found' });

  const product = await Product.findById(item.product).select('stock').lean();
  if (product && quantity > product.stock) {
    return res.status(400).json({ success: false, message: `Only ${product.stock} units available` });
  }

  item.quantity = quantity;
  await cart.save();
  res.json({ success: true, message: 'Quantity updated' });
};

// ── DELETE /api/cart/item/:itemId ─────────────────────────
const removeCartItem = async (req, res) => {
  const cart = await Cart.findOne({ user: req.user._id });
  if (!cart) return res.status(404).json({ success: false, message: 'Cart not found' });
  cart.items = cart.items.filter(i => i._id.toString() !== req.params.itemId);
  await cart.save();
  res.json({ success: true, message: 'Item removed' });
};

// ── DELETE /api/cart ──────────────────────────────────────
const clearCart = async (req, res) => {
  await Cart.findOneAndUpdate({ user: req.user._id }, { items: [] });
  res.json({ success: true, message: 'Cart cleared' });
};

// ── POST /api/cart/sync (guest → server) ─────────────────
const syncCart = async (req, res) => {
  const { items } = req.body;
  if (!items?.length) return res.json({ success: true, message: 'Nothing to sync' });

  let cart = await Cart.findOne({ user: req.user._id });
  if (!cart) cart = await Cart.create({ user: req.user._id, items: [] });

  for (const guestItem of items) {
    const product = await Product.findById(guestItem._id).lean();
    if (!product || !product.isActive) continue;
    const exists = cart.items.find(i => i.product.toString() === guestItem._id);
    if (!exists) {
      cart.items.push({
        product:  guestItem._id,
        quantity: Math.min(guestItem.quantity, product.stock),
        priceSnapshot: {
          price: product.discountPrice || product.price,
          gstRate: product.gstRate || 18,
          name: product.name,
          image: product.images?.[0]?.url || '',
          stock: product.stock,
          codAvailable: product.codAvailable !== false,
        },
      });
    }
  }

  await cart.save();
  res.json({ success: true, message: 'Cart synced', itemCount: cart.items.reduce((s, i) => s + i.quantity, 0) });
};

module.exports = { getCart, addToCart, updateCartItem, removeCartItem, clearCart, syncCart };
