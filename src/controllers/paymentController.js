// ============================================
// PAYMENT CONTROLLER — Phase 1 (COD + UPI)
// Phase 2: Razorpay/Cashfree ready
// ============================================
const Order = require('../models/Order');

/**
 * @route   POST /api/payment/initiate
 * @desc    Initiate payment (COD or UPI QR)
 * @access  Private
 */
const initiatePayment = async (req, res) => {
  const { orderId, method } = req.body;

  const order = await Order.findOne({ _id: orderId, user: req.user._id });
  if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

  if (method === 'cod') {
    order.paymentMethod = 'cod';
    order.paymentStatus = 'pending';
    await order.save();

    return res.json({
      success: true,
      message: 'Cash on Delivery confirmed',
      paymentType: 'cod',
      order: { orderId: order.orderId, total: order.pricing.total },
    });
  }

  if (method === 'upi') {
    // Generate UPI payment link/QR
    const upiId = process.env.MERCHANT_UPI_ID || 'merchant@upi';
    const amount = order.pricing.total;
    const upiLink = `upi://pay?pa=${upiId}&pn=Eptomart&am=${amount}&cu=INR&tn=Order%20${order.orderId}`;

    return res.json({
      success: true,
      message: 'Scan QR code or use UPI link to pay',
      paymentType: 'upi',
      upiLink,
      upiId,
      amount,
      orderId: order.orderId,
      instructions: 'After payment, enter your UPI transaction ID to confirm.',
    });
  }

  res.status(400).json({ success: false, message: 'Invalid payment method' });
};

/**
 * @route   POST /api/payment/confirm-upi
 * @desc    User submits UPI transaction reference
 * @access  Private
 */
const confirmUpiPayment = async (req, res) => {
  const { orderId, upiRef } = req.body;

  if (!upiRef) {
    return res.status(400).json({ success: false, message: 'UPI Transaction ID is required' });
  }

  const order = await Order.findOne({ _id: orderId, user: req.user._id });
  if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

  // Save UPI reference for admin to verify
  order.paymentDetails.upiRef = upiRef;
  order.paymentStatus = 'pending'; // Admin will verify and change to 'paid'
  order.orderStatus = 'confirmed';
  await order.save();

  res.json({
    success: true,
    message: 'Payment reference submitted. Admin will verify within 1 hour.',
    order: { orderId: order.orderId, upiRef },
  });
};

/**
 * @route   POST /api/payment/admin-verify-upi/:orderId
 * @desc    Admin verifies UPI payment
 * @access  Admin
 */
const adminVerifyUpi = async (req, res) => {
  const { verified } = req.body;
  const order = await Order.findById(req.params.orderId);
  if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

  if (verified) {
    order.paymentStatus = 'paid';
    order.paymentDetails.paidAt = new Date();
    order.orderStatus = 'processing';
  } else {
    order.paymentStatus = 'failed';
    order.orderStatus = 'placed'; // Revert to allow retry
  }

  await order.save();
  res.json({ success: true, message: verified ? 'Payment verified' : 'Payment rejected', order });
};

// ═══════════════════════════════════════════
// PHASE 2: RAZORPAY INTEGRATION (READY)
// Uncomment when you add RAZORPAY_KEY_ID and
// RAZORPAY_KEY_SECRET to .env
// ═══════════════════════════════════════════

/*
const Razorpay = require('razorpay');
const crypto = require('crypto');

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

const createRazorpayOrder = async (req, res) => {
  const { orderId } = req.body;
  const order = await Order.findById(orderId);
  if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

  const razorpayOrder = await razorpay.orders.create({
    amount: order.pricing.total * 100, // in paise
    currency: 'INR',
    receipt: order.orderId,
    notes: { orderId: order._id.toString() }
  });

  order.paymentDetails.gatewayOrderId = razorpayOrder.id;
  await order.save();

  res.json({
    success: true,
    razorpayOrderId: razorpayOrder.id,
    amount: razorpayOrder.amount,
    currency: razorpayOrder.currency,
    keyId: process.env.RAZORPAY_KEY_ID,
  });
};

const verifyRazorpayPayment = async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, orderId } = req.body;

  const body = razorpay_order_id + '|' + razorpay_payment_id;
  const expectedSignature = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(body)
    .digest('hex');

  if (expectedSignature !== razorpay_signature) {
    return res.status(400).json({ success: false, message: 'Payment verification failed' });
  }

  const order = await Order.findById(orderId);
  order.paymentStatus = 'paid';
  order.paymentDetails = {
    transactionId: razorpay_payment_id,
    gatewayOrderId: razorpay_order_id,
    paidAt: new Date(),
  };
  order.orderStatus = 'confirmed';
  await order.save();

  res.json({ success: true, message: 'Payment successful', order });
};
*/

module.exports = { initiatePayment, confirmUpiPayment, adminVerifyUpi };
