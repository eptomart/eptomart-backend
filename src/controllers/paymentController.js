// ============================================
// PAYMENT CONTROLLER — COD + UPI + Razorpay
// ============================================
const Order = require('../models/Order');
const Razorpay = require('razorpay');
const crypto = require('crypto');
// notifySeller is imported lazily to avoid circular-dependency issues at startup
const getNotifySeller = () => require('./orderController').notifySeller;

const getRazorpay = () => {
  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) return null;
  return new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  });
};

const initiatePayment = async (req, res) => {
  const { orderId, method } = req.body;
  const order = await Order.findOne({ _id: orderId, user: req.user._id });
  if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

  if (method === 'cod') {
    order.paymentMethod = 'cod';
    order.paymentStatus = 'pending';
    await order.save();
    return res.json({ success: true, paymentType: 'cod', order: { orderId: order.orderId, total: order.pricing.total } });
  }

  if (method === 'upi') {
    const upiId = process.env.MERCHANT_UPI_ID || 'merchant@upi';
    const upiLink = `upi://pay?pa=${upiId}&pn=Eptomart&am=${order.pricing.total}&cu=INR&tn=Order%20${order.orderId}`;
    return res.json({ success: true, paymentType: 'upi', upiLink, upiId, amount: order.pricing.total, orderId: order.orderId });
  }

  res.status(400).json({ success: false, message: 'Invalid payment method' });
};

const confirmUpiPayment = async (req, res) => {
  const { orderId, upiRef } = req.body;
  if (!upiRef) return res.status(400).json({ success: false, message: 'UPI Transaction ID is required' });
  const order = await Order.findOne({ _id: orderId, user: req.user._id });
  if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
  order.paymentDetails.upiRef = upiRef;
  order.paymentStatus = 'pending'; // stays pending until admin verifies UPI
  await order.save();
  res.json({ success: true, message: 'Payment reference submitted. Admin will verify within 1 hour.' });
};

const adminVerifyUpi = async (req, res) => {
  const order = await Order.findById(req.params.orderId);
  if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

  if (req.body.verified) {
    order.paymentStatus = 'paid';
    order.paymentDetails.paidAt = new Date();
    order.orderStatus = 'processing';
    await order.save();

    // Payment confirmed — now notify the seller(s)
    getNotifySeller()(order).catch(() => {});
  } else {
    order.paymentStatus = 'failed';
    order.orderStatus = 'placed';
    await order.save();
  }

  res.json({ success: true, order });
};

// ════════════════ RAZORPAY ════════════════

const createRazorpayOrder = async (req, res) => {
  const razorpay = getRazorpay();
  if (!razorpay) return res.status(503).json({ success: false, message: 'Razorpay not configured on server' });

  const { orderId } = req.body;
  const order = await Order.findOne({ _id: orderId, user: req.user._id });
  if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

  const rzpOrder = await razorpay.orders.create({
    amount: Math.round(order.pricing.total * 100),
    currency: 'INR',
    receipt: order.orderId,
    notes: { orderId: order._id.toString() },
  });

  order.paymentDetails = { ...order.paymentDetails, gatewayOrderId: rzpOrder.id };
  order.paymentMethod = 'razorpay';
  await order.save();

  res.json({
    success: true,
    razorpayOrderId: rzpOrder.id,
    amount: rzpOrder.amount,
    currency: rzpOrder.currency,
    keyId: process.env.RAZORPAY_KEY_ID,
    orderId: order._id,
    orderNumber: order.orderId,
  });
};

const verifyRazorpayPayment = async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, orderId } = req.body;

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({ success: false, message: 'Missing payment details' });
  }

  const expectedSignature = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest('hex');

  if (expectedSignature !== razorpay_signature) {
    return res.status(400).json({ success: false, message: 'Payment verification failed' });
  }

  const order = await Order.findById(orderId);
  if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

  order.paymentStatus = 'paid';
  order.paymentDetails = { transactionId: razorpay_payment_id, gatewayOrderId: razorpay_order_id, paidAt: new Date() };
  await order.save();

  // Payment verified — notify seller(s) now
  getNotifySeller()(order).catch(() => {});

  res.json({ success: true, message: 'Payment successful! Your order is placed and awaiting seller confirmation.', orderId: order.orderId });
};

const razorpayWebhook = async (req, res) => {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (secret) {
    const sig = req.headers['x-razorpay-signature'];
    const expected = crypto.createHmac('sha256', secret).update(JSON.stringify(req.body)).digest('hex');
    if (sig !== expected) return res.status(400).json({ error: 'Invalid signature' });
  }
  if (req.body.event === 'payment.captured') {
    const payment = req.body.payload.payment.entity;
    const order = await Order.findOne({ 'paymentDetails.gatewayOrderId': payment.order_id });
    if (order && order.paymentStatus !== 'paid') {
      order.paymentStatus = 'paid';
      order.paymentDetails.transactionId = payment.id;
      order.paymentDetails.paidAt = new Date();
      await order.save();

      // Webhook confirmed payment — notify seller(s)
      // (guard against double-notify if verifyRazorpayPayment already ran)
      getNotifySeller()(order).catch(() => {});
    }
  }
  res.status(200).json({ received: true });
};

module.exports = { initiatePayment, confirmUpiPayment, adminVerifyUpi, createRazorpayOrder, verifyRazorpayPayment, razorpayWebhook };
