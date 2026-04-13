// ============================================
// ORDER CONTROLLER
// ============================================
const Order = require('../models/Order');
const Product = require('../models/Product');
const { sendOrderConfirmation } = require('../utils/sendEmail');

/**
 * @route   POST /api/orders
 * @desc    Place new order
 * @access  Private
 */
const placeOrder = async (req, res) => {
  const { items, shippingAddress, paymentMethod, notes } = req.body;

  if (!items?.length) {
    return res.status(400).json({ success: false, message: 'Order items are required' });
  }

  // Validate items and calculate pricing
  let subtotal = 0;
  const validatedItems = [];

  for (const item of items) {
    const product = await Product.findById(item.product);
    if (!product || !product.isActive) {
      return res.status(400).json({ success: false, message: `Product "${item.product}" is not available` });
    }
    if (product.stock < item.quantity) {
      return res.status(400).json({ success: false, message: `Insufficient stock for "${product.name}"` });
    }

    const price = product.discountPrice || product.price;
    subtotal += price * item.quantity;

    validatedItems.push({
      product: product._id,
      name: product.name,
      image: product.images[0]?.url || '',
      price,
      quantity: item.quantity,
    });
  }

  // Calculate totals
  const shipping = subtotal >= 499 ? 0 : 49; // Free shipping above ₹499
  const tax = Math.round(subtotal * 0.05); // 5% GST
  const total = subtotal + shipping + tax;

  const order = await Order.create({
    user: req.user._id,
    items: validatedItems,
    shippingAddress,
    pricing: { subtotal, discount: 0, shipping, tax, total },
    paymentMethod,
    notes,
  });

  // Reduce stock
  for (const item of validatedItems) {
    await Product.findByIdAndUpdate(item.product, {
      $inc: { stock: -item.quantity, soldCount: item.quantity },
    });
  }

  // Send confirmation email
  const user = req.user;
  if (user.email) {
    sendOrderConfirmation(user.email, order).catch(() => {});
  }

  const populatedOrder = await Order.findById(order._id).populate('items.product', 'name images');

  res.status(201).json({ success: true, message: 'Order placed successfully!', order: populatedOrder });
};

/**
 * @route   GET /api/orders
 * @desc    Get user's orders
 * @access  Private
 */
const getMyOrders = async (req, res) => {
  const { page = 1, limit = 10 } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  const [orders, total] = await Promise.all([
    Order.find({ user: req.user._id })
      .sort('-createdAt')
      .skip(skip)
      .limit(Number(limit))
      .populate('items.product', 'name images'),
    Order.countDocuments({ user: req.user._id }),
  ]);

  res.json({ success: true, orders, total, totalPages: Math.ceil(total / Number(limit)) });
};

/**
 * @route   GET /api/orders/:id
 * @desc    Get single order
 * @access  Private
 */
const getOrder = async (req, res) => {
  const order = await Order.findOne({
    _id: req.params.id,
    user: req.user._id,
  }).populate('items.product', 'name images slug');

  if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

  res.json({ success: true, order });
};

/**
 * @route   PUT /api/orders/:id/cancel
 * @desc    Cancel order (user)
 * @access  Private
 */
const cancelOrder = async (req, res) => {
  const order = await Order.findOne({ _id: req.params.id, user: req.user._id });
  if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

  if (!['placed', 'confirmed'].includes(order.orderStatus)) {
    return res.status(400).json({ success: false, message: 'Order cannot be cancelled at this stage' });
  }

  order.orderStatus = 'cancelled';
  order.statusHistory.push({ status: 'cancelled', note: req.body.reason || 'Cancelled by user' });
  await order.save();

  // Restore stock
  for (const item of order.items) {
    await Product.findByIdAndUpdate(item.product, {
      $inc: { stock: item.quantity, soldCount: -item.quantity },
    });
  }

  res.json({ success: true, message: 'Order cancelled', order });
};

module.exports = { placeOrder, getMyOrders, getOrder, cancelOrder };
