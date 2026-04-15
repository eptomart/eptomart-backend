const Order   = require('../models/Order');
const Product = require('../models/Product');
const Seller  = require('../models/Seller');
const Invoice = require('../models/Invoice');
const Cart    = require('../models/Cart');
const { sendOrderConfirmation } = require('../utils/sendEmail');
const { calcOrderGst, extractBasePrice } = require('../utils/gstCalculator');
const { generateInvoicePDF, uploadInvoicePDF } = require('../utils/generateInvoicePDF');
const { generateInvoiceNumber } = require('../utils/invoiceNumber');
const business = require('../../config/business');

// ── POST /api/orders ──────────────────────────────────────
const placeOrder = async (req, res) => {
  const { items, shippingAddress, paymentMethod, notes } = req.body;
  if (!items?.length) {
    return res.status(400).json({ success: false, message: 'Order items are required' });
  }

  const buyerState = shippingAddress?.state || business.state;
  let validatedItems = [];
  const gstLineItems = [];

  for (const item of items) {
    const product = await Product.findById(item.product)
      .populate('seller', 'businessName gstNumber address')
      .lean();

    if (!product || !product.isActive) {
      return res.status(400).json({ success: false, message: `Product "${item.product}" is not available` });
    }
    if (product.stock < item.quantity) {
      return res.status(400).json({ success: false, message: `Insufficient stock for "${product.name}"` });
    }

    const price       = product.discountPrice || product.price;
    const gstRate     = product.gstRate || 18;
    const priceExGst  = extractBasePrice(price, gstRate);
    const sellerState = product.seller?.address?.state || business.state;

    validatedItems.push({
      product:  product._id,
      name:     product.name,
      image:    product.images?.[0]?.url || '',
      price,
      quantity: item.quantity,
    });

    gstLineItems.push({ unitPriceExGst: priceExGst, gstRate, quantity: item.quantity, sellerState });
  }

  // GST calculation
  const gst      = calcOrderGst(gstLineItems, business.state, buyerState);
  const shipping = (gst.grandTotal >= 499) ? 0 : 49;
  const total    = gst.grandTotal + shipping;

  const order = await Order.create({
    user:            req.user._id,
    items:           validatedItems,
    shippingAddress,
    pricing: {
      subtotal: gst.subtotal,
      discount: 0,
      shipping,
      tax:      gst.gstTotal,
      total:    parseFloat(total.toFixed(2)),
    },
    gstBreakdown: {
      subtotalExGst: gst.subtotal,
      cgstTotal:     gst.cgstTotal,
      sgstTotal:     gst.sgstTotal,
      igstTotal:     gst.igstTotal,
      gstTotal:      gst.gstTotal,
      gstType:       gst.gstType,
      sellerState:   business.state,
      customerState: buyerState,
    },
    paymentMethod,
    notes,
  });

  // Reduce stock + update metrics
  for (const item of validatedItems) {
    await Product.findByIdAndUpdate(item.product, {
      $inc: { stock: -item.quantity, soldCount: item.quantity },
    });
  }

  // Clear server-side cart
  await Cart.findOneAndUpdate({ user: req.user._id }, { items: [] });

  // Generate invoice asynchronously (don't block response)
  let invoice = null;
  try {
    invoice = await createInvoice(order, req.user, gst, shipping);
    await Order.findByIdAndUpdate(order._id, { invoice: invoice._id });
  } catch (err) {
    console.error('[Invoice] Failed to generate:', err.message);
  }

  // Email confirmation
  if (req.user.email) {
    sendOrderConfirmation(req.user.email, order).catch(() => {});
  }

  const populated = await Order.findById(order._id).populate('items.product', 'name images');
  res.status(201).json({
    success: true,
    message: 'Order placed successfully!',
    order: populated,
    invoice: invoice ? {
      _id:           invoice._id,
      invoiceNumber: invoice.invoiceNumber,
      pdfUrl:        invoice.pdfUrl,
      grandTotal:    invoice.grandTotal,
    } : null,
  });
};

// ── Internal: generate and store invoice ─────────────────
const createInvoice = async (order, user, gst, shipping) => {
  const invoiceNumber = await generateInvoiceNumber();
  const buyerState    = order.shippingAddress?.state || business.state;

  // Build invoice line items with full GST detail
  const lineItems = await Promise.all(order.items.map(async (item, idx) => {
    const product     = await Product.findById(item.product).populate('seller','businessName gstNumber address').lean();
    const gstRate     = product?.gstRate || 18;
    const priceExGst  = extractBasePrice(item.price, gstRate);
    const sellerState = product?.seller?.address?.state || business.state;
    const line        = require('../utils/gstCalculator').calcLineGst(priceExGst, gstRate, item.quantity, sellerState, buyerState);

    return {
      productId:      item.product,
      productName:    item.name,
      sku:            product?.sku || '',
      hsnCode:        product?.hsnCode || '',
      sellerId:       product?.seller?._id,
      sellerName:     product?.seller?.businessName || 'Eptomart',
      sellerGstNo:    product?.seller?.gstNumber || '',
      quantity:       item.quantity,
      unitPriceExGst: priceExGst,
      gstRate,
      cgstRate:       line.cgstRate,
      sgstRate:       line.sgstRate,
      igstRate:       line.igstRate,
      cgstAmount:     line.cgstAmount,
      sgstAmount:     line.sgstAmount,
      igstAmount:     line.igstAmount,
      gstAmount:      line.gstAmount,
      lineTotal:      line.lineBase,
      lineGrandTotal: line.lineGrandTotal,
    };
  }));

  const invoice = await Invoice.create({
    invoiceNumber,
    order:           order._id,
    customer:        user._id,
    items:           lineItems,
    billingAddress:  order.shippingAddress,
    shippingAddress: order.shippingAddress,
    subtotal:        gst.subtotal,
    cgstTotal:       gst.cgstTotal,
    sgstTotal:       gst.sgstTotal,
    igstTotal:       gst.igstTotal,
    gstTotal:        gst.gstTotal,
    shipping,
    grandTotal:      parseFloat((gst.grandTotal + shipping).toFixed(2)),
    gstType:         gst.gstType,
    sellerState:     business.state,
    customerState:   buyerState,
    business: {
      name:    business.name,
      address: business.address,
      phone:   business.phone,
      email:   business.email,
      website: business.website,
      gstNo:   business.gstNo || '',
    },
  });

  // Generate PDF and upload to Cloudinary
  try {
    const pdfBuf = await generateInvoicePDF({ ...invoice.toObject(), order });
    const { url, publicId } = await uploadInvoicePDF(pdfBuf, invoiceNumber);
    invoice.pdfUrl      = url;
    invoice.pdfPublicId = publicId;
    await invoice.save();
  } catch (pdfErr) {
    console.error('[PDF] Upload failed:', pdfErr.message);
  }

  return invoice;
};

// ── GET /api/orders ───────────────────────────────────────
const getMyOrders = async (req, res) => {
  const { page = 1, limit = 10 } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  const [orders, total] = await Promise.all([
    Order.find({ user: req.user._id })
      .sort('-createdAt')
      .skip(skip)
      .limit(Number(limit))
      .populate('items.product', 'name images')
      .populate('invoice', 'invoiceNumber pdfUrl grandTotal'),
    Order.countDocuments({ user: req.user._id }),
  ]);

  res.json({ success: true, orders, total, totalPages: Math.ceil(total / Number(limit)) });
};

// ── GET /api/orders/:id ───────────────────────────────────
const getOrder = async (req, res) => {
  const order = await Order.findOne({ _id: req.params.id, user: req.user._id })
    .populate('items.product', 'name images slug')
    .populate('invoice', 'invoiceNumber pdfUrl grandTotal gstTotal');

  if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
  res.json({ success: true, order });
};

// ── PUT /api/orders/:id/cancel ────────────────────────────
const cancelOrder = async (req, res) => {
  const order = await Order.findOne({ _id: req.params.id, user: req.user._id });
  if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
  if (!['placed', 'confirmed'].includes(order.orderStatus)) {
    return res.status(400).json({ success: false, message: 'Order cannot be cancelled at this stage' });
  }
  order.orderStatus = 'cancelled';
  order.statusHistory.push({ status: 'cancelled', note: req.body.reason || 'Cancelled by user' });
  await order.save();
  for (const item of order.items) {
    await Product.findByIdAndUpdate(item.product, { $inc: { stock: item.quantity, soldCount: -item.quantity } });
  }
  res.json({ success: true, message: 'Order cancelled', order });
};

module.exports = { placeOrder, getMyOrders, getOrder, cancelOrder, createInvoice };
