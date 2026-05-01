// ============================================
// SHIPROCKET INTEGRATION UTILITY
// ============================================
// Set these in your .env:
//   SHIPROCKET_EMAIL=your@email.com
//   SHIPROCKET_PASSWORD=yourpassword
// API docs: https://apiv2.shiprocket.in/v1/external
// ============================================
const axios = require('axios');

const BASE_URL = 'https://apiv2.shiprocket.in/v1/external';

let _cachedToken = null;
let _tokenExpiry = null;

// ── Authenticate and get Bearer token ──────────────────────
const getToken = async () => {
  if (_cachedToken && _tokenExpiry && Date.now() < _tokenExpiry) {
    return _cachedToken;
  }
  const { data } = await axios.post(`${BASE_URL}/auth/login`, {
    email:    process.env.SHIPROCKET_EMAIL,
    password: process.env.SHIPROCKET_PASSWORD,
  });
  if (!data.token) throw new Error('Shiprocket auth failed — check SHIPROCKET_EMAIL / SHIPROCKET_PASSWORD in .env');
  _cachedToken = data.token;
  _tokenExpiry = Date.now() + 22 * 60 * 60 * 1000; // 22 hours
  return _cachedToken;
};

const headers = async () => ({
  Authorization: `Bearer ${await getToken()}`,
  'Content-Type': 'application/json',
});

// ── Get or create a pickup location for a seller ──────────
const getOrCreatePickupLocation = async (seller) => {
  if (!seller?.address?.pincode) {
    return process.env.SHIPROCKET_PICKUP_LOCATION || 'Primary';
  }
  const h = await headers();
  const locationName = (seller.businessName || `Seller_${seller._id}`)
    .replace(/[^a-zA-Z0-9 ]/g, '')
    .trim()
    .substring(0, 30);

  try {
    const { data: existing } = await axios.get(`${BASE_URL}/settings/company/pickup`, { headers: h });
    const locations = existing?.data?.shipping_address || [];
    const found = locations.find(
      loc => loc.pickup_location?.toLowerCase() === locationName.toLowerCase()
    );
    if (found) return found.pickup_location;

    const payload = {
      pickup_location: locationName,
      name:            seller.businessName || locationName,
      email:           seller.contact?.email || process.env.CONTACT_EMAIL || 'eptosicare@gmail.com',
      phone:           seller.contact?.phone || '',
      address:         seller.address.street || seller.address.city,
      address_2:       '',
      city:            seller.address.city,
      state:           seller.address.state,
      country:         'India',
      pin_code:        seller.address.pincode,
    };
    await axios.post(`${BASE_URL}/settings/company/addpickup`, payload, { headers: h });
    console.log('[Shiprocket] Created pickup location:', locationName);
    return locationName;
  } catch (err) {
    console.error('[Shiprocket] getOrCreatePickupLocation failed:', err?.response?.data || err.message);
    return process.env.SHIPROCKET_PICKUP_LOCATION || 'Primary';
  }
};

// ── Create a Shiprocket order + shipment ────────────────────
// Returns: { order_id, shipment_id, awb_code, courier_name, shippingCharge, trackingUrl, raw }
const createShipment = async (order, shippingAddress, seller = null) => {
  const h = await headers();
  const pickupLocation = await getOrCreatePickupLocation(seller);

  const payload = {
    order_id:           order.orderId || order._id.toString(),
    order_date:         new Date(order.createdAt).toISOString().split('T')[0],
    pickup_location:    pickupLocation,
    channel_id:         '',
    comment:            '',
    billing_customer_name:  shippingAddress.fullName,
    billing_last_name:      '',
    billing_address:        shippingAddress.addressLine1,
    billing_address_2:      shippingAddress.addressLine2 || '',
    billing_city:           shippingAddress.city,
    billing_pincode:        shippingAddress.pincode,
    billing_state:          shippingAddress.state,
    billing_country:        'India',
    billing_email:          order.user?.email || '',
    billing_phone:          shippingAddress.phone || order.user?.phone || '',
    shipping_is_billing:    true,
    order_items: order.items.map(item => {
      const gstRate   = item.gstRate || 18;
      const { extractBasePrice } = require('./gstCalculator');
      const unitBase  = typeof extractBasePrice === 'function'
        ? extractBasePrice(item.price, gstRate)
        : item.price / (1 + gstRate / 100);
      const taxAmount = parseFloat((unitBase * gstRate / 100 * item.quantity).toFixed(2));
      return {
        name:          item.name,
        sku:           item.product?.toString() || item.name.substring(0, 20),
        units:         item.quantity,
        selling_price: item.price,
        discount:      '',
        tax:           taxAmount,
        hsn:           item.hsnCode || '',
      };
    }),
    payment_method:      order.paymentMethod === 'cod' ? 'COD' : 'Prepaid',
    shipping_charges:    order.pricing?.shipping || 0,
    giftwrap_charges:    0,
    transaction_charges: 0,
    total_discount:      0,
    sub_total:           order.pricing?.subtotal || order.gstBreakdown?.subtotalExGst || 0,
    ioss_number:         '',
    seller_gst_tin:      seller?.gstNumber || '',
    taxable_value:       order.gstBreakdown?.subtotalExGst || order.pricing?.subtotal || 0,
    cgst:                order.gstBreakdown?.cgstTotal || 0,
    sgst:                order.gstBreakdown?.sgstTotal || 0,
    igst:                order.gstBreakdown?.igstTotal || 0,
    cess:                0,
    length:              15,   // cm
    breadth:             15,
    height:              10,
    weight:              0.5   // kg
  };

  console.log('[Shiprocket] Creating order for:', order.orderId || order._id);
  const { data } = await axios.post(`${BASE_URL}/orders/create/adhoc`, payload, { headers: h });

  // Shiprocket returns the shipment_id in the top-level response
  const srOrderId  = data?.order_id  || data?.payload?.order_id;
  const shipmentId = data?.shipment_id || data?.payload?.shipment_id;

  if (!shipmentId) {
    console.error('[Shiprocket] No shipment_id returned. Full response:', JSON.stringify(data));
    return { ...data, awb_code: '', courier_name: '', shippingCharge: 0 };
  }

  console.log('[Shiprocket] Order created. SR OrderId:', srOrderId, 'ShipmentId:', shipmentId);

  // Step 2: Auto-assign courier — Shiprocket picks the best available courier
  let awb = '';
  let courierName = '';
  let shippingCharge = 0;

  try {
    const { data: awbData } = await axios.post(
      `${BASE_URL}/courier/assign/awb`,
      { shipment_id: [String(shipmentId)] },
      { headers: h }
    );

    // Response shape: { response: { data: { awb_code, courier_name, ... } } }
    const awbPayload = awbData?.response?.data || awbData?.data || awbData;
    awb          = awbPayload?.awb_code    || awbPayload?.awb          || '';
    courierName  = awbPayload?.courier_name || awbPayload?.courier      || '';
    shippingCharge = parseFloat(awbPayload?.freight_charge || awbPayload?.rate || 0);

    if (awb) {
      console.log('[Shiprocket] AWB assigned:', awb, '| Courier:', courierName, '| Charge: ₹', shippingCharge);
    } else {
      console.warn('[Shiprocket] AWB assignment returned no AWB. Response:', JSON.stringify(awbData));
    }
  } catch (awbErr) {
    const errMsg = awbErr?.response?.data?.message || awbErr.message;
    console.error('[Shiprocket] AWB assignment failed:', errMsg);
    // Not fatal — admin can refresh AWB later
  }

  // Step 3: Request pickup schedule (non-fatal if it fails)
  if (awb) {
    try {
      await axios.post(
        `${BASE_URL}/courier/generate/pickup`,
        { shipment_id: [String(shipmentId)] },
        { headers: h }
      );
      console.log('[Shiprocket] Pickup requested for shipment:', shipmentId);
    } catch (pickupErr) {
      console.warn('[Shiprocket] Pickup request failed (non-fatal):', pickupErr?.response?.data?.message || pickupErr.message);
    }
  }

  const trackingUrl = awb ? `https://shiprocket.co/tracking/${awb}` : '';
  return {
    ...data,
    order_id:      srOrderId,
    shipment_id:   shipmentId,
    awb_code:      awb,
    courier_name:  courierName,
    shippingCharge,
    trackingUrl,
  };
};

// ── Assign AWB to an already-created shipment ────────────
// Call from admin panel when AWB shows blank after shipment creation.
const assignAWB = async (shipmentId) => {
  const h = await headers();
  const { data } = await axios.post(
    `${BASE_URL}/courier/assign/awb`,
    { shipment_id: [String(shipmentId)] },
    { headers: h }
  );
  const payload = data?.response?.data || data?.data || data;
  const awb     = payload?.awb_code || payload?.awb || '';
  const courier = payload?.courier_name || payload?.courier || '';
  const charge  = parseFloat(payload?.freight_charge || payload?.rate || 0);

  if (awb) {
    // Also request pickup when AWB is freshly assigned
    try {
      await axios.post(
        `${BASE_URL}/courier/generate/pickup`,
        { shipment_id: [String(shipmentId)] },
        { headers: h }
      );
      console.log('[Shiprocket] Pickup scheduled for shipment:', shipmentId);
    } catch (_) {}
  }

  return { awb, courier, shippingCharge: charge, raw: data };
};

// ── Request pickup for an existing shipment ──────────────
const requestPickup = async (shipmentId) => {
  const h = await headers();
  const { data } = await axios.post(
    `${BASE_URL}/courier/generate/pickup`,
    { shipment_id: [String(shipmentId)] },
    { headers: h }
  );
  return data;
};

// ── Generate shipping label PDF URL ─────────────────────
const generateLabel = async (shipmentId) => {
  const h = await headers();
  const { data } = await axios.post(
    `${BASE_URL}/courier/generate/label`,
    { shipment_id: [String(shipmentId)] },
    { headers: h }
  );
  return data?.label_url || data?.response?.label_url || '';
};

// ── Track a shipment ──────────────────────────────────────
const trackShipment = async (shiprocketOrderId) => {
  const h = await headers();
  const { data } = await axios.get(`${BASE_URL}/orders/show/${shiprocketOrderId}`, { headers: h });
  return data;
};

// ── Track by AWB (airway bill number) ────────────────────
const trackByAWB = async (awb) => {
  const h = await headers();
  const { data } = await axios.get(`${BASE_URL}/courier/track/awb/${awb}`, { headers: h });
  return data;
};

// ── Cancel a shipment ─────────────────────────────────────
const cancelShipment = async (awbs) => {
  const h = await headers();
  const { data } = await axios.post(`${BASE_URL}/orders/cancel`, { awbs }, { headers: h });
  return data;
};

// ── Get serviceable couriers for a pincode ────────────────
const getServiceability = async ({ pickupPincode, deliveryPincode, weight = 0.5, cod = false }) => {
  const h = await headers();
  const { data } = await axios.get(`${BASE_URL}/courier/serviceability/`, {
    headers: h,
    params: {
      pickup_postcode:   pickupPincode,
      delivery_postcode: deliveryPincode,
      weight,
      cod: cod ? 1 : 0,
    },
  });
  return data;
};

// ── Get shipment details including actual freight charge ────
const getShipmentCharge = async (shipmentId) => {
  const h = await headers();
  const { data } = await axios.get(`${BASE_URL}/shipments`, {
    headers: h,
    params: { id: shipmentId },
  });
  // Extract freight_charge from the response
  // Response structure: { data: { shipments: [{ freight_charge, ... }] } } or similar
  const shipmentData = data?.data?.shipments?.[0] || data?.shipments?.[0] || data?.data || data;
  const freightCharge = parseFloat(shipmentData?.freight_charge || shipmentData?.shippingCharge || 0);
  return {
    shipmentId,
    freightCharge,
    raw: data,
  };
};

module.exports = {
  createShipment,
  assignAWB,
  requestPickup,
  generateLabel,
  trackShipment,
  trackByAWB,
  cancelShipment,
  getServiceability,
  getShipmentCharge,
};
