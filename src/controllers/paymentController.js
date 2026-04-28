// ============================================
// PAYMENT CONTROLLER — Razorpay only
// ============================================
const Order   = require('../models/Order');
const Razorpay = require('razorpay');
const crypto  = require('crypto');
// Import lazily to avoid circular-dependency issues at startup
const getNotifySeller   = () => require('./orderController').notifySeller;
const getCreateInvoice  = () => require('./orderController').createInvoice;
const { createShipment } = require('../utils/shiprocket');
const { sendOrderSms }   = require('../utils/sendSMS');
const { sendOrderPaidWhatsApp } = require('../utils/sendWhatsApp');

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

  const order = await Order.findById(orderId).populate('user');
  if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

  order.paymentStatus = 'paid';
  order.paymentDetails = { transactionId: razorpay_payment_id, gatewayOrderId: razorpay_order_id, paidAt: new Date() };
  await order.save();

  // ── Notify customer of payment confirmation ──────────────────────────
  const User = require('../models/User');
  const buyer = await User.findById(order.user).select('name email phone').lean();
  if (buyer) {
    const total = order.pricing?.total;

    // SMS
    if (buyer.phone) {
      sendOrderSms(buyer.phone, order.orderId, total).catch(() => {});
    }

    // WhatsApp
    const customerPhone = buyer.phone || order.shippingAddress?.phone;
    if (customerPhone && typeof sendOrderPaidWhatsApp === 'function') {
      sendOrderPaidWhatsApp(customerPhone, { orderId: order.orderId, total, name: buyer.name }).catch(() => {});
    }
  }

  // Payment verified — notify seller(s)
  getNotifySeller()(order).catch(() => {});

  // Generate invoice now that payment is confirmed (if not already generated)
  if (!order.invoice) {
    _postPaymentTasks(order).catch(e => console.error('[PostPayment] Error:', e.message));
  } else {
    // Shiprocket only — invoice already exists
    _createShiprocketOrder(order).catch(e => console.error('[Shiprocket] Error:', e.message));
  }

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
      getNotifySeller()(order).catch(() => {});
      if (!order.invoice) {
        _postPaymentTasks(order).catch(e => console.error('[PostPayment Webhook] Error:', e.message));
      } else {
        _createShiprocketOrder(order).catch(() => {});
      }
    }
  }
  res.status(200).json({ received: true });
};

// ── Post-payment async tasks: invoice + Shiprocket ────────
async function _postPaymentTasks(order) {
  try {
    const User = require('../models/User');
    const populatedOrder = await Order.findById(order._id).lean();
    const user = await User.findById(populatedOrder.user).lean();
    if (!user) return;

    const gst = {
      subtotal:  populatedOrder.pricing.subtotal,
      cgstTotal: populatedOrder.gstBreakdown?.cgstTotal || 0,
      sgstTotal: populatedOrder.gstBreakdown?.sgstTotal || 0,
      igstTotal: populatedOrder.gstBreakdown?.igstTotal || 0,
      gstTotal:  populatedOrder.pricing.tax || 0,
      grandTotal:populatedOrder.pricing.total - (populatedOrder.pricing.shipping || 0),
      gstType:   populatedOrder.gstBreakdown?.gstType || 'intra',
    };

    const { invoice } = await getCreateInvoice()(populatedOrder, user, gst, populatedOrder.pricing.shipping || 0);
    await Order.findByIdAndUpdate(order._id, { invoice: invoice._id });
    console.log('[Invoice] Generated after payment:', invoice.invoiceNumber);
  } catch (err) {
    console.error('[Invoice] Post-payment generation failed:', err.message);
  }
  // Attempt Shiprocket regardless of invoice result
  await _createShiprocketOrder(order);
}

async function _createShiprocketOrder(order) {
  if (!process.env.SHIPROCKET_EMAIL || !process.env.SHIPROCKET_PASSWORD) return;
  try {
    // Populate seller data so we can use their address as the pickup location
    const Seller = require('../models/Seller');
    const populatedOrder = await Order.findById(order._id)
      .populate({ path: 'items.product', select: 'seller name hsnCode', populate: { path: 'seller', model: 'Seller', select: 'businessName address contact' } })
      .lean();
    if (!populatedOrder) return;

    // Determine seller: use the first item's seller (assumes single-seller orders;
    // for multi-seller, each seller's items would ideally get separate shipments)
    const seller = populatedOrder.items?.[0]?.product?.seller || null;
    if (seller) {
      console.log('[Shiprocket] Using pickup from seller:', seller.businessName, '→', seller.address?.city, seller.address?.pincode);
    }

    const result = await createShipment(populatedOrder, populatedOrder.shippingAddress, seller);
    // Extract Shiprocket data from response
    const srOrderId  = result?.order_id   || result?.data?.order_id;
    const srShipId   = result?.shipment_id || result?.data?.shipment_id;
    const awb        = result?.awb_code    || result?.data?.awb_code   || '';
    const courier    = result?.courier_name|| result?.data?.courier_name|| '';
    const trackingUrl= awb ? `https://shiprocket.co/tracking/${awb}` : '';
    if (srOrderId) {
      await Order.findByIdAndUpdate(order._id, {
        shiprocket: { orderId: String(srOrderId), shipmentId: String(srShipId || ''), awb, courier, trackingUrl, status: 'created', createdAt: new Date() },
        trackingNumber: awb,
        deliveryPartner: courier,
      });
      console.log('[Shiprocket] Order created:', srOrderId, 'AWB:', awb, 'Seller pickup:', seller?.businessName || 'default');
    }
  } catch (err) {
    console.error('[Shiprocket] Failed to create order:', err.message);
  }
}

module.exports = { initiatePayment, confirmUpiPayment, adminVerifyUpi, createRazorpayOrder, verifyRazorpayPayment, razorpayWebhook };
