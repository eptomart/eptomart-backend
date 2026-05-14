const Order   = require('../models/Order');
const Product = require('../models/Product');
const Seller  = require('../models/Seller');
const Invoice = require('../models/Invoice');
const Cart    = require('../models/Cart');
const { sendOrderConfirmation, sendSellerNewOrderEmail } = require('../utils/sendEmail');
const { notifyUser, notifications } = require('../utils/pushNotification');
const { sendOrderPlacedWhatsApp, sendAdminNewOrderAlert, sendSellerNewOrderWhatsApp } = require('../utils/sendWhatsApp');
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
    // Populate buyer info for the email
    const User = require('../models/User');
    const buyer = await User.findById(order.user).select('name email phone').lean();

    // Full shipping address string
    const addr = order.shippingAddress;
    const fullAddress = [
      addr?.addressLine1,
      addr?.addressLine2,
      addr?.city,
      addr?.state,
      addr?.pincode,
    ].filter(Boolean).join(', ');

    // Group items by seller
    const sellerMap = {};
    for (const item of order.items) {
      const product = await Product.findById(item.product)
        .populate('seller', 'contact businessName user')
        .lean();
      if (!product?.seller) {
        console.warn(`[Notify Seller] Product ${item.product} has no seller — skipping`);
        continue;
      }
      const sid = product.seller._id.toString();
      if (!sellerMap[sid]) sellerMap[sid] = { seller: product.seller, items: [] };
      sellerMap[sid].items.push({ name: item.name, qty: item.quantity, price: item.price });
    }

    const sellerCount = Object.keys(sellerMap).length;
    console.log(`[Notify Seller] Order #${order.orderId} — notifying ${sellerCount} seller(s)`);

    for (const { seller, items } of Object.values(sellerMap)) {
      const total = items.reduce((s, i) => s + (i.price || 0) * i.qty, 0);

      // Email with full buyer details + address
      if (seller?.contact?.email) {
        sendSellerNewOrderEmail(seller.contact.email, {
          businessName:  seller.businessName,
          orderId:       order.orderId,
          items,
          total,
          buyerName:     buyer?.name || addr?.fullName || 'Customer',
          buyerPhone:    addr?.phone || buyer?.phone || '—',
          buyerAddress:  fullAddress || '—',
          paymentMethod: order.paymentMethod?.toUpperCase() || '—',
          paymentStatus: order.paymentStatus || 'pending',
        }).then(async (result) => {
          console.log(`[Notify Seller] ✅ Email sent to ${seller.contact.email} for order #${order.orderId}`);
          const NotificationLog = require('../models/NotificationLog');
          await NotificationLog.findOneAndUpdate(
            { orderId: order._id, type: 'seller_new_order', sentTo: seller.contact.email },
            { $setOnInsert: { orderId: order._id, userId: order.user, type: 'seller_new_order', sentTo: seller.contact.email, status: result.success ? 'sent' : 'failed' } },
            { upsert: true, new: true }
          ).catch(() => {});
        }).catch(async err => {
          console.error(`[Notify Seller] ❌ Email failed for ${seller.contact.email}:`, err.message);
          // Log failure — use a separate key per seller to allow multiple sellers per order
          const NotificationLog = require('../models/NotificationLog');
          await NotificationLog.create({
            orderId: order._id, userId: order.user, type: 'seller_new_order',
            sentTo: seller.contact.email, status: 'failed', error: err.message,
          }).catch(() => {});
        });
      } else {
        console.warn(`[Notify Seller] Seller ${seller.businessName} has no contact email — push only`);
      }

      // WhatsApp notification to seller
      if (seller?.contact?.phone) {
        sendSellerNewOrderWhatsApp(seller.contact.phone, {
          businessName:  seller.businessName,
          orderId:       order.orderId,
          items,
          total,
          buyerName:     buyer?.name || addr?.fullName || 'Customer',
          paymentMethod: order.paymentMethod,
        }).then(r => {
          if (r.success) console.log(`[Notify Seller] ✅ WhatsApp sent to ${seller.contact.phone} for order #${order.orderId}`);
          else           console.warn(`[Notify Seller] ⚠️  WhatsApp not sent to ${seller.contact.phone}:`, r.error || 'unknown');
        }).catch(err => console.error('[Notify Seller] WhatsApp error:', err.message));
      }

      // In-app push notification
      if (seller?.user) {
        notifyUser(seller.user, {
          title: `📦 New Order #${order.orderId}`,
          body:  `${items.length} item(s) · ₹${total.toLocaleString('en-IN')} — Confirm in your dashboard.`,
          icon:  '/icons/icon-192x192.png',
          url:   '/seller/orders',
          tag:   `order-${order.orderId}`,
        }).catch(err => console.error('[Notify Seller] Push failed:', err.message));
      }
    }
  } catch (err) {
    console.error('[Notify Seller] Fatal error:', err.message);
  }
};

// ── POST /api/orders ──────────────────────────────────────
const placeOrder = async (req, res) => {
  const { items, shippingAddress, paymentMethod, notes, shipping: clientShipping } = req.body;
  if (!items?.length) {
    return res.status(400).json({ success: false, message: 'Order items are required' });
  }

  // ── Buyer name mandatory ─────────────────────────────────
  const buyerName = shippingAddress?.fullName?.trim() || req.user?.name?.trim();
  if (!buyerName) {
    return res.status(400).json({ success: false, message: 'Your full name is required before placing an order. Please update your profile or enter your name at checkout.' });
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

    // Use variant price if sent from client, otherwise fall back to product base price
    const basePrice   = product.discountPrice || product.price;
    const price       = (item.price && item.price > 0) ? item.price : basePrice;
    const gstRate     = product.gstRate || 18;
    const priceExGst  = extractBasePrice(price, gstRate);
    const sellerState = product.seller?.address?.state || business.state;

    validatedItems.push({
      product:      product._id,
      name:         product.name,
      image:        product.images?.[0]?.url || '',
      price,
      quantity:     item.quantity,
      variantLabel: item.variantLabel || undefined,
    });

    gstLineItems.push({ unitPriceExGst: priceExGst, gstRate, quantity: item.quantity, sellerState });
  }

  // GST calculation
  const gst = calcOrderGst(gstLineItems, business.state, buyerState);

  // Free shipping threshold — always override if cart total >= ₹1499
  const FREE_SHIPPING_THRESHOLD = 1499;
  const shipping = gst.grandTotal >= FREE_SHIPPING_THRESHOLD
    ? 0
    : (typeof clientShipping === 'number' && clientShipping >= 0)
      ? clientShipping
      : 0;

  const total = gst.grandTotal + shipping;

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
    }).then(result => {
      if (!result?.success) {
        console.error(`[WhatsApp] Order placed message failed for ${customerPhone}:`, result?.error || 'unknown error');
      } else {
        console.log(`[WhatsApp] Order placed message sent to ${customerPhone} for order ${order.orderId}`);
      }
    }).catch(err => {
      console.error(`[WhatsApp] Order placed message exception for ${customerPhone}:`, err.message);
    });
  } else {
    console.warn(`[WhatsApp] No phone number found for order ${order.orderId} — skipping WhatsApp`);
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
    // Create Shiprocket shipment immediately for COD (no payment gateway step)
    _createShiprocketCOD(order).catch(e => console.error('[Shiprocket COD] Error:', e.message));
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

  // ── WhatsApp cancellation notice to customer ──────────
  setImmediate(() => {
    try {
      const { sendOrderStatusWhatsApp } = require('../utils/sendWhatsApp');
      const phone = order.shippingAddress?.phone || req.user?.phone;
      const name  = order.shippingAddress?.fullName || order.shippingAddress?.name || req.user?.name;
      if (phone) {
        sendOrderStatusWhatsApp(phone, {
          status:       'cancelled',
          orderId:      order.orderId,
          name,
          refundStatus: order.refund?.status,
          note:         reason,
        }).catch(() => {});
      }
    } catch (e) { /* non-critical */ }
  });

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

  // Hide unpaid orders from sellers — only show paid or COD orders
  const filter = {
    'items.product': { $in: productIds },
    $or: [{ paymentStatus: 'paid' }, { paymentMethod: 'cod' }],
  };

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

// ── Shiprocket shipment for COD orders (fire-and-forget) ─
const _createShiprocketCOD = async (order) => {
  if (!process.env.SHIPROCKET_EMAIL || !process.env.SHIPROCKET_PASSWORD) return;
  try {
    const { createShipment } = require('../utils/shiprocket');
    const populatedOrder = await Order.findById(order._id)
      .populate({
        path: 'items.product',
        select: 'seller name hsnCode gstRate',
        populate: { path: 'seller', model: 'Seller', select: 'businessName address contact gstNumber' },
      })
      .lean();
    if (!populatedOrder) return;

    const seller = populatedOrder.items?.[0]?.product?.seller || null;
    if (seller) console.log('[Shiprocket COD] Using pickup from seller:', seller.businessName);

    const result = await createShipment(populatedOrder, populatedOrder.shippingAddress, seller);
    const srOrderId   = result?.order_id    || result?.data?.order_id;
    const srShipId    = result?.shipment_id || result?.data?.shipment_id;
    const awb         = result?.awb_code    || result?.data?.awb_code    || '';
    const courier     = result?.courier_name|| result?.data?.courier_name || '';
    const trackingUrl = awb ? `https://shiprocket.co/tracking/${awb}` : '';

    if (srOrderId) {
      await Order.findByIdAndUpdate(order._id, {
        shiprocket: {
          orderId:    String(srOrderId),
          shipmentId: String(srShipId || ''),
          awb,
          courier,
          trackingUrl,
          status:     'created',
          createdAt:  new Date(),
        },
        trackingNumber:  awb,
        deliveryPartner: courier,
      });
      console.log('[Shiprocket COD] Order created:', srOrderId, 'AWB:', awb || '(pending)');
    }
  } catch (err) {
    console.error('[Shiprocket COD] Failed to create order:', err.message);
  }
};

// ── POST /api/orders/:id/package-images — seller uploads packaging photos ─
// Body: side = 'front' | 'back' | 'left' | 'right'  (one photo per request)
const PACKAGING_SIDES = ['front', 'back', 'left', 'right'];
const SIDE_LABELS = { front: 'Front', back: 'Back', left: 'Left', right: 'Right' };
const SIDE_EMOJIS = { front: '🔵', back: '🟢', left: '🟡', right: '🟠' };

const uploadPackageImages = async (req, res) => {
  const sellerDocId = req.user.sellerProfile || null;
  if (!sellerDocId) return res.status(403).json({ success: false, message: 'Seller profile not found' });

  const order = await Order.findById(req.params.id).populate('user', '_id name');
  if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

  // Verify this seller owns items in this order
  const sellerProducts = await Product.find({ seller: sellerDocId }).select('_id').lean();
  const productIdSet   = new Set(sellerProducts.map(p => p._id.toString()));
  if (!order.items.some(i => productIdSet.has(i.product.toString()))) {
    return res.status(403).json({ success: false, message: 'Not authorized for this order' });
  }

  if (!['confirmed', 'processing'].includes(order.orderStatus)) {
    return res.status(400).json({ success: false, message: 'Packaging images can only be uploaded after order is confirmed' });
  }

  const files = req.files || [];
  if (files.length < 1) return res.status(400).json({ success: false, message: 'Please upload at least 1 packaging image' });

  // Determine the side for this upload (from body or query)
  const side = (req.body.side || req.query.side || '').toLowerCase();
  if (side && !PACKAGING_SIDES.includes(side)) {
    return res.status(400).json({ success: false, message: `side must be one of: ${PACKAGING_SIDES.join(', ')}` });
  }

  const wasRejected   = order.packaging?.status === 'rejected';
  // When resubmitting after rejection, wipe old rejected photos so we start clean
  if (wasRejected) {
    const { deleteImage } = require('../config/cloudinary');
    const oldImages = order.packaging?.images || [];
    Promise.all(oldImages.filter(i => i.publicId).map(i => deleteImage(i.publicId).catch(() => {}))).catch(() => {});
  }
  const existing      = wasRejected ? [] : (order.packaging?.images || []);
  const wasFirstPhoto = existing.length === 0;

  // Build new image objects with optional side label
  const newImages = files.map(f => ({
    url:        f.path,
    publicId:   f.filename,
    side:       side || null,
    uploadedAt: new Date(),
  }));

  const allImages = [...existing, ...newImages];

  // Which sides are now covered?
  const coveredSides = new Set(allImages.map(img => img.side).filter(Boolean));
  const missingSides = PACKAGING_SIDES.filter(s => !coveredSides.has(s));
  const allSidesDone = coveredSides.size >= 4 || allImages.length >= 4;

  const statusNow = allSidesDone ? 'pending_review' : 'not_submitted';
  const wasAlreadySubmitted = order.packaging?.status === 'pending_review';

  order.packaging = {
    ...order.packaging,
    images:      allImages,
    status:      statusNow,
    submittedAt: statusNow === 'pending_review' && !wasAlreadySubmitted
                   ? new Date()
                   : order.packaging?.submittedAt,
  };
  await order.save();

  // ── Fire notifications (non-blocking) ─────────────────────────────────
  setImmediate(async () => {
    try {
      const User = require('../models/User');

      // 1️⃣ Notify the SELLER about their own upload progress
      const sellerDoc = await Seller.findById(sellerDocId).select('user').lean();
      if (sellerDoc?.user) {
        const uploadedSideLabel = side ? SIDE_LABELS[side] : `Photo ${allImages.length}`;
        const emoji = side ? SIDE_EMOJIS[side] : '📷';

        if (allSidesDone && !wasAlreadySubmitted) {
          // All 4 sides done — tell seller it's submitted
          await notifyUser(sellerDoc.user, {
            title: `✅ All packaging photos submitted — #${order.orderId}`,
            body:  `All 4 sides uploaded. Admin will review and release your AWB label shortly.`,
            url:   '/seller/orders',
            tag:   `pkg-seller-${order.orderId}`,
          });
        } else if (!allSidesDone) {
          // Partial upload — nudge for missing sides
          const nextMissing = missingSides[0];
          const nextLabel   = nextMissing ? `Upload ${SIDE_LABELS[nextMissing]} side next.` : '';
          await notifyUser(sellerDoc.user, {
            title: `${emoji} ${uploadedSideLabel} side photo uploaded — #${order.orderId}`,
            body:  missingSides.length > 0
              ? `${allImages.length}/4 photos done. ${nextLabel} Missing: ${missingSides.map(s => SIDE_LABELS[s]).join(', ')}.`
              : `${allImages.length} photos uploaded.`,
            url:   '/seller/orders',
            tag:   `pkg-seller-${order.orderId}`,
          });
        }
      }

      // 2️⃣ Notify the CUSTOMER — only when first photo is uploaded (packaging started)
      if (wasFirstPhoto && order.user?._id) {
        await notifyUser(order.user._id, {
          title: `📷 Your order #${order.orderId} is being packaged`,
          body:  `Your seller has started packaging your order with care. You'll be notified when it ships!`,
          url:   '/orders',
          tag:   `pkg-customer-${order.orderId}`,
        });
      }

      // 3️⃣ Notify all ADMINS — only when all sides done (newly submitted for review)
      if (allSidesDone && !wasAlreadySubmitted) {
        const admins = await User.find({ role: 'admin', isActive: true }).select('_id').lean();
        await Promise.all(admins.map(admin =>
          notifyUser(admin._id, {
            title: `📦 Packaging ready for review — #${order.orderId}`,
            body:  `Seller uploaded all ${allImages.length} packaging photos (Front, Back, Left, Right). Review to release AWB.`,
            url:   '/admin/orders',
            tag:   `pkg-admin-${order.orderId}`,
          })
        ));
      }
    } catch (notifErr) {
      console.error('[PackageImg] Notification error:', notifErr.message);
    }
  });
  // ──────────────────────────────────────────────────────────────────────

  const sideStatus = PACKAGING_SIDES.map(s => ({
    side: s,
    label: SIDE_LABELS[s],
    done: coveredSides.has(s) || (!side && allImages.length >= PACKAGING_SIDES.indexOf(s) + 1),
  }));

  res.json({
    success: true,
    message: allSidesDone && !wasAlreadySubmitted
      ? '✅ All packaging photos submitted for admin review!'
      : allSidesDone
        ? 'Photos updated. Already under review.'
        : `${allImages.length}/4 photos uploaded. ${missingSides.length > 0 ? `Still needed: ${missingSides.map(s => SIDE_LABELS[s]).join(', ')}.` : ''}`,
    packaging:  order.packaging,
    sideStatus,
    coveredSides: [...coveredSides],
    missingSides,
  });
};

// ── GET /api/orders/pending-payments ──────────────────────
const getPendingPaymentOrders = async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const sellerDocId = req.user.sellerProfile || null;
  if (!sellerDocId) return res.json({ success: true, orders: [], total: 0 });

  // Find all product IDs belonging to this seller
  const sellerProducts = await Product.find({ seller: sellerDocId }).select('_id').lean();
  const productIds = sellerProducts.map(p => p._id);
  if (productIds.length === 0) return res.json({ success: true, orders: [], total: 0 });

  // Filter orders: payment not paid AND payment method is not COD
  const filter = {
    'items.product': { $in: productIds },
    paymentStatus: { $ne: 'paid' },
    paymentMethod: { $ne: 'cod' },
  };

  const [orders, total] = await Promise.all([
    Order.find(filter)
      .populate('user', 'name email phone')
      .populate('items.product', 'name images')
      .sort('-createdAt')
      .skip((Number(page) - 1) * Number(limit))
      .limit(Number(limit))
      .lean(),
    Order.countDocuments(filter),
  ]);

  // Keep only this seller's items in each order
  const productIdSet = new Set(productIds.map(p => p.toString()));
  const result = orders.map(o => ({
    ...o,
    items: o.items.filter(item => productIdSet.has(item.product._id.toString())),
  }));

  res.json({ success: true, orders: result, total, totalPages: Math.ceil(total / Number(limit)) });
};

// Export processRefund so adminController can reuse it
const processRefundForOrder = processRefund;

module.exports = {
  placeOrder, getMyOrders, getOrder, cancelOrder, createInvoice,
  notifySeller, getSellerOrders, sellerConfirmOrder, processRefundForOrder,
  uploadPackageImages, getPendingPaymentOrders,
};
