const Order   = require('../models/Order');
const Product = require('../models/Product');
const Seller  = require('../models/Seller');
const Invoice = require('../models/Invoice');
const Cart    = require('../models/Cart');
const { sendOrderConfirmation, sendSellerNewOrderEmail } = require('../utils/sendEmail');
const { notifyUser, notifications } = require('../utils/pushNotification');
const { sendOrderPlacedWhatsApp, sendAdminNewOrderAlert } = require('../utils/sendWhatsApp');
const { calcOrderGst, extractBasePrice } = require('../utils/gstCalculator');
const { generateInvoicePDF, uploadInvoicePDF } = require('../utils/generateInvoicePDF');
const { generateInvoiceNumber } = require('../utils/invoiceNumber');
const business = require('../../config/business');

// ── Refund helper ─────────────────────────────────────────
const processRefund = async (order) => {
  const { paymentMethod, paymentStatus, paymentDetails, pricing, _id, orderId, user } = order;

  // COD — nothing to refund
  if (paymentMethod === 'cod') {
    order.refund = { status: 'not_applicable', method: 'cod_none', note: 'COD order — no payment collected online' };
    return;
  }

  // Not yet paid — nothing to refund
  if (paymentStatus !== 'paid') {
    order.refund = { status: 'not_applicable', method: paymentMethod, note: 'Payment was not completed' };
    return;
  }

  // ── Razorpay — automatic refund via API ──────────────
  if (paymentMethod === 'razorpay') {
    const rzpKeyId     = process.env.RAZORPAY_KEY_ID;
    const rzpKeySecret = process.env.RAZORPAY_KEY_SECRET;

    if (!rzpKeyId || !rzpKeySecret) {
      order.refund = { status: 'manual_required', method: 'razorpay', note: 'Razorpay keys not configured — refund manually' };
      return;
    }

    const paymentId = paymentDetails?.transactionId;
    if (!paymentId) {
      order.refund = { status: 'manual_required', method: 'razorpay', note: 'Transaction ID missing — refund manually via Razorpay dashboard' };
      return;
    }

    try {
      const https  = require('https');
      const amount = Math.round(pricing.total * 100); // paise
      const body   = JSON.stringify({ amount, speed: 'normal', notes: { orderId } });
      const auth   = Buffer.from(`${rzpKeyId}:${rzpKeySecret}`).toString('base64');

      const refundData = await new Promise((resolve, reject) => {
        const req = https.request({
          hostname: 'api.razorpay.com',
          path:     `/v1/payments/${paymentId}/refund`,
          method:   'POST',
          headers:  { 'Content-Type': 'application/json', 'Authorization': `Basic ${auth}`, 'Content-Length': Buffer.byteLength(body) },
        }, (res) => {
          let data = '';
          res.on('data', chunk => { data += chunk; });
          res.on('end', () => {
            try { resolve(JSON.parse(data)); }
            catch { resolve({ error: { description: 'Invalid response' } }); }
          });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
      });

      if (refundData.id) {
        order.refund = {
          status:           'initiated',
          method:           'razorpay',
          razorpayRefundId: refundData.id,
          amount:           pricing.total,
          initiatedAt:      new Date(),
          note:             `Refund ID: ${refundData.id} — will credit in 5-7 business days`,
        };
        order.paymentStatus = 'refunded';
        console.log(`[Refund] Razorpay refund initiated: ${refundData.id} for order ${orderId}`);

        // Push notify customer
        notifyUser(user, {
          title: '💰 Refund Initiated',
          body:  `₹${Number(pricing.total).toLocaleString('en-IN')} refund for order #${orderId} has been initiated. Expected in 5-7 business days.`,
          icon:  '/icons/icon-192x192.png',
          url:   '/orders',
          tag:   `refund-${orderId}`,
        }).catch(() => {});

      } else {
        const errMsg = refundData.error?.description || 'Unknown error';
        order.refund = { status: 'failed', method: 'razorpay', note: `Auto-refund failed: ${errMsg}. Refund manually via Razorpay dashboard.`, initiatedAt: new Date() };
        console.error(`[Refund] Razorpay refund failed for ${orderId}:`, errMsg);
      }
    } catch (err) {
      order.refund = { status: 'failed', method: 'razorpay', note: `Auto-refund error: ${err.message}. Refund manually.`, initiatedAt: new Date() };
      console.error(`[Refund] Exception for ${orderId}:`, err.message);
    }
    return;
  }

  // ── UPI — manual refund required ────────────────────
  if (paymentMethod === 'upi') {
    order.refund = {
      status:      'manual_required',
      method:      'upi_manual',
      amount:      pricing.total,
      initiatedAt: new Date(),
      note:        `UPI payment of ₹${pricing.total}. Admin must manually transfer to customer's UPI. Ref: ${paymentDetails?.upiRef || '—'}`,
    };

    // Push notify customer
    notifyUser(user, {
      title: '🔄 Refund in Progress',
      body:  `₹${Number(pricing.total).toLocaleString('en-IN')} will be refunded to your UPI within 2-3 business days for order #${orderId}.`,
      icon:  '/icons/icon-192x192.png',
      url:   '/orders',
      tag:   `refund-${orderId}`,
    }).catch(() => {});
  }
};

// ── Notify seller of new order (async, fire-and-forget) ──
const notifySeller = async (order) => {
  try {
    // Group items by seller
    const sellerMap = {};
    for (const item of order.items) {
      const product = await Product.findById(item.product)
        .populate('seller', 'contact businessName user')
        .lean();
      if (!product?.seller) continue;
      const sid = product.seller._id.toString();
      if (!sellerMap[sid]) sellerMap[sid] = { seller: product.seller, items: [] };
      sellerMap[sid].items.push({ name: item.name, qty: item.quantity, price: item.price });
    }

    for (const { seller, items } of Object.values(sellerMap)) {
      const total = items.reduce((s, i) => s + (i.price || 0) * i.qty, 0);

      // Email notification (proper seller order email, not OTP template)
      if (seller?.contact?.email) {
        sendSellerNewOrderEmail(seller.contact.email, {
          businessName: seller.businessName,
          orderId:      order.orderId,
          items,
          total,
        }).catch(() => {});
      }

      // In-app push notification to seller's browser
      if (seller?.user) {
        notifyUser(seller.user, {
          title: `📦 New Order #${order.orderId}`,
          body:  `${items.length} item(s) · ₹${total.toLocaleString('en-IN')} — Confirm in your dashboard.`,
          icon:  '/icons/icon-192x192.png',
          url:   '/seller/orders',
          tag:   `order-${order.orderId}`,
        }).catch(() => {});
      }
    }
  } catch (err) {
    console.error('[Order Notify Seller] Error:', err.message);
  }
};

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

  // Invoice is generated after successful Razorpay payment (in paymentController)
  // For now just send order confirmation email without PDF
  if (req.user.email) {
    sendOrderConfirmation(req.user.email, order, {
      userName:      req.user.name || '',
      invoicePdfBuf: null,
      invoiceNumber: '',
    }).catch(() => {});
  }

  // Push notification to customer (free, no 3rd party — VAPID web push)
  notifyUser(req.user._id, notifications.orderPlaced(order.orderId)).catch(() => {});

  // WhatsApp confirmation to customer (fires when META_WHATSAPP_TOKEN is set)
  const customerPhone = req.user.phone || order.shippingAddress?.phone;
  if (customerPhone) {
    sendOrderPlacedWhatsApp(customerPhone, {
      orderId:       order.orderId,
      total:         order.pricing.total,
      paymentMethod: order.paymentMethod,
      items:         order.items,
    }).catch(() => {});
  }

  // WhatsApp alert to admin
  sendAdminNewOrderAlert({
    orderId:      order.orderId,
    customerName: req.user.name,
    total:        order.pricing.total,
    paymentMethod: order.paymentMethod,
  }).catch(() => {});

  // Notify seller(s) only for COD — online-payment orders notify after payment is confirmed
  if (order.paymentMethod === 'cod') {
    notifySeller(order).catch(() => {});
  }

  const populated = await Order.findById(order._id).populate('items.product', 'name images');
  res.status(201).json({
    success: true,
    message: 'Order placed successfully!',
    order: populated,
    invoice: null, // Invoice generated after payment confirmation
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

  // Map fullName → name (Invoice addressSnapshotSchema uses `name`, User address uses `fullName`)
  const addrSnap = {
    name:         order.shippingAddress?.fullName || order.shippingAddress?.name || user.name || '',
    phone:        order.shippingAddress?.phone || '',
    addressLine1: order.shippingAddress?.addressLine1 || '',
    addressLine2: order.shippingAddress?.addressLine2 || '',
    city:         order.shippingAddress?.city || '',
    state:        order.shippingAddress?.state || '',
    pincode:      order.shippingAddress?.pincode || '',
  };

  const invoice = await Invoice.create({
    invoiceNumber,
    order:           order._id,
    customer:        user._id,
    items:           lineItems,
    billingAddress:  addrSnap,
    shippingAddress: addrSnap,
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
  let pdfBuf = null;
  try {
    pdfBuf = await generateInvoicePDF({ ...invoice.toObject(), order });
    const { url, publicId } = await uploadInvoicePDF(pdfBuf, invoiceNumber);
    invoice.pdfUrl      = url;
    invoice.pdfPublicId = publicId;
    await invoice.save();
  } catch (pdfErr) {
    console.error('[PDF] Upload failed:', pdfErr.message);
    pdfBuf = null;
  }

  // Return both invoice + PDF buffer (buffer used for email attachment)
  return { invoice, pdfBuf };
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

  const reason = req.body.reason || 'Cancelled by user';
  order.orderStatus = 'cancelled';
  order.statusHistory.push({ status: 'cancelled', note: reason, updatedBy: 'user' });

  // Restore stock
  for (const item of order.items) {
    await Product.findByIdAndUpdate(item.product, { $inc: { stock: item.quantity, soldCount: -item.quantity } });
  }

  // Process refund based on payment method
  await processRefund(order);
  await order.save();

  const refundMsg = order.refund?.status === 'initiated'
    ? ' Refund has been initiated and will credit in 5-7 business days.'
    : order.refund?.status === 'manual_required'
    ? ' A manual refund will be processed by our team within 2-3 business days.'
    : '';

  res.json({ success: true, message: `Order cancelled.${refundMsg}`, order, refund: order.refund });
};

// ── GET /api/orders/seller/mine ─────────────────────────
const getSellerOrders = async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const sellerDocId = req.user.sellerProfile || null;
  if (!sellerDocId) return res.json({ success: true, orders: [], total: 0 });

  // Find all product IDs belonging to this seller
  const sellerProducts = await Product.find({ seller: sellerDocId }).select('_id').lean();
  const productIds = sellerProducts.map(p => p._id);
  if (productIds.length === 0) return res.json({ success: true, orders: [], total: 0 });

  const filter = { 'items.product': { $in: productIds } };

  const [orders, total] = await Promise.all([
    Order.find(filter)
      .populate('user', 'name email phone')
      .sort('-createdAt')
      .skip((Number(page) - 1) * Number(limit))
      .limit(Number(limit))
      .lean(),
    Order.countDocuments(filter),
  ]);

  // Keep only this seller's items in each order (hide other sellers' items)
  const productIdSet = new Set(productIds.map(p => p.toString()));
  const result = orders.map(o => ({
    ...o,
    items: o.items.filter(item => productIdSet.has(item.product.toString())),
  }));

  res.json({ success: true, orders: result, total, totalPages: Math.ceil(total / Number(limit)) });
};

// ── PATCH /api/orders/:id/seller-confirm ─────────────────
const sellerConfirmOrder = async (req, res) => {
  const sellerDocId = req.user.sellerProfile || null;
  if (!sellerDocId) return res.status(403).json({ success: false, message: 'Seller profile not found' });

  const { pickupAddressId } = req.body;
  if (!pickupAddressId) {
    return res.status(400).json({ success: false, message: 'Please select a pickup address before confirming' });
  }

  const order = await Order.findById(req.params.id);
  if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

  if (order.orderStatus !== 'placed') {
    return res.status(400).json({ success: false, message: `Order is already ${order.orderStatus}` });
  }

  // Verify this seller has at least one product in this order
  const sellerProducts = await Product.find({ seller: sellerDocId }).select('_id').lean();
  const productIdSet   = new Set(sellerProducts.map(p => p._id.toString()));
  const hasItems       = order.items.some(item => productIdSet.has(item.product.toString()));
  if (!hasItems) return res.status(403).json({ success: false, message: 'Not authorized for this order' });

  // Resolve the chosen pickup address
  const sellerDoc = await Seller.findById(sellerDocId).lean();
  let pickupSnapshot = null;

  if (pickupAddressId === 'main') {
    pickupSnapshot = {
      addressId:  'main',
      label:      'Main Address',
      street:     sellerDoc.address?.street  || '',
      city:       sellerDoc.address?.city    || '',
      state:      sellerDoc.address?.state   || '',
      pincode:    sellerDoc.address?.pincode || '',
      sellerId:   sellerDocId,
      sellerName: sellerDoc.businessName,
      adminAcknowledged: false,
    };
  } else {
    const addr = sellerDoc.pickupAddresses?.find(
      a => a._id.toString() === pickupAddressId && a.status === 'approved'
    );
    if (!addr) {
      return res.status(400).json({ success: false, message: 'Selected address not found or not yet approved by admin' });
    }
    pickupSnapshot = {
      addressId:  pickupAddressId,
      label:      addr.label,
      street:     addr.street,
      city:       addr.city,
      state:      addr.state,
      pincode:    addr.pincode,
      phone:      addr.phone || '',
      sellerId:   sellerDocId,
      sellerName: sellerDoc.businessName,
      adminAcknowledged: false,
    };
  }

  order.sellerPickup = pickupSnapshot;
  order.orderStatus  = 'confirmed';
  order.statusHistory.push({
    status:    'confirmed',
    note:      `Confirmed by seller — pickup: ${pickupSnapshot.label}, ${pickupSnapshot.city}`,
    updatedBy: 'seller',
  });
  await order.save();

  res.json({ success: true, message: 'Order confirmed. Admin will acknowledge the pickup location.', order });
};

// Export processRefund so adminController can reuse it
const processRefundForOrder = processRefund;

module.exports = { placeOrder, getMyOrders, getOrder, cancelOrder, createInvoice, notifySeller, getSellerOrders, sellerConfirmOrder, processRefundForOrder };
