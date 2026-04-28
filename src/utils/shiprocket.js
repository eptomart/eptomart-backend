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

let _cachedToken   = null;
let _tokenExpiry   = null;

// ── Authenticate and get Bearer token ───────
const getToken = async () => {
  // Return cached token if still valid (tokens last 24h, refresh at 22h)
  if (_cachedToken && _tokenExpiry && Date.now() < _tokenExpiry) {
    return _cachedToken;
  }

  const { data } = await axios.post(`${BASE_URL}/auth/login`, {
    email:    process.env.SHIPROCKET_EMAIL,
    password: process.env.SHIPROCKET_PASSWORD,
  });

  if (!data.token) throw new Error('Shiprocket auth failed');

  _cachedToken = data.token;
  _tokenExpiry = Date.now() + 22 * 60 * 60 * 1000; // 22 hours
  return _cachedToken;
};

const headers = async () => ({
  Authorization: `Bearer ${await getToken()}`,
  'Content-Type': 'application/json',
});

// ── Get or create a pickup location for a seller ────────────────────────
// Shiprocket requires pickup addresses to be pre-registered by name.
// We use seller.businessName as the unique pickup location name.
const getOrCreatePickupLocation = async (seller) => {
  // No seller info → fall back to env default
  if (!seller?.address?.pincode) {
    return process.env.SHIPROCKET_PICKUP_LOCATION || 'Primary';
  }

  const h = await headers();

  // Sanitise name: Shiprocket location names must be alphanumeric + spaces
  const locationName = (seller.businessName || `Seller_${seller._id}`)
    .replace(/[^a-zA-Z0-9 ]/g, '')
    .trim()
    .substring(0, 30);

  try {
    // Fetch existing pickup locations
    const { data: existing } = await axios.get(`${BASE_URL}/settings/company/pickup`, { headers: h });
    const locations = existing?.data?.shipping_address || [];

    // Check if this seller's location is already registered
    const found = locations.find(
      loc => loc.pickup_location?.toLowerCase() === locationName.toLowerCase()
    );
    if (found) return found.pickup_location;

    // Create a new pickup location for this seller
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
    console.log('[Shiprocket] Created pickup location:', locationName, 'for seller:', seller.businessName);
    return locationName;
  } catch (err) {
    console.error('[Shiprocket] getOrCreatePickupLocation failed:', err.message);
    return process.env.SHIPROCKET_PICKUP_LOCATION || 'Primary';
  }
};

// ── Create a Shiprocket order + shipment ────
const createShipment = async (order, shippingAddress, seller = null) => {
  const h = await headers();

  // Resolve pickup location — seller's registered address takes priority
  const pickupLocation = await getOrCreatePickupLocation(seller);

  // Map Eptomart order to Shiprocket format
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
    order_items: order.items.map(item => ({
      name:          item.name,
      sku:           item.product?.toString() || item.name.substring(0, 20),
      units:         item.quantity,
      selling_price: item.price,
      discount:      '',
      tax:           '',
      hsn:           item.hsnCode || '',
    })),
    payment_method:    order.paymentMethod === 'cod' ? 'COD' : 'Prepaid',
    shipping_charges:  order.pricing?.shippingCharge || 0,
    giftwrap_charges:  0,
    transaction_charges: 0,
    total_discount:    0,
    sub_total:         order.pricing?.subtotal || 0,
    length:            10, // cm — default, seller should update
    breadth:           10,
    height:            10,
    weight:            0.5, // kg — default
  };

  const { data } = await axios.post(`${BASE_URL}/orders/create/adhoc`, payload, { headers: h });

  // `create/adhoc` returns order_id + shipment_id but NOT AWB yet.
  // We must call the courier auto-assign endpoint to get the AWB code.
  const shipmentId = data?.payload?.shipment_id || data?.shipment_id;
  if (shipmentId) {
    try {
      const { data: awbData } = await axios.post(
        `${BASE_URL}/courier/assign/awb`,
        { shipment_id: [String(shipmentId)] },
        { headers: h }
      );
      // Merge AWB into the response so the caller can read it from result.awb_code
      const awb     = awbData?.response?.data?.awb_code    || awbData?.awb_code    || '';
      const courier = awbData?.response?.data?.courier_name || awbData?.courier_name || '';
      return { ...data, awb_code: awb, courier_name: courier, awb_shipment_response: awbData };
    } catch (awbErr) {
      // AWB assignment can fail if courier serviceability isn't set up yet.
      // Return what we have — admin can refresh later.
      console.warn('[Shiprocket] AWB assignment failed (will need manual refresh):', awbErr?.response?.data?.message || awbErr.message);
      return data;
    }
  }

  return data;
};

// ── Assign AWB to an already-created shipment ─
// Call this if the shipment was created but AWB is still blank.
const assignAWB = async (shipmentId) => {
  const h = await headers();
  const { data } = await axios.post(
    `${BASE_URL}/courier/assign/awb`,
    { shipment_id: [String(shipmentId)] },
    { headers: h }
  );
  return {
    awb:     data?.response?.data?.awb_code    || data?.awb_code    || '',
    courier: data?.response?.data?.courier_name || data?.courier_name || '',
    raw:     data,
  };
};

// ── Track a shipment ─────────────────────────
const trackShipment = async (shiprocketOrderId) => {
  const h = await headers();
  const { data } = await axios.get(`${BASE_URL}/orders/show/${shiprocketOrderId}`, { headers: h });
  return data;
};

// ── Track by AWB (airway bill number) ────────
const trackByAWB = async (awb) => {
  const h = await headers();
  const { data } = await axios.get(`${BASE_URL}/courier/track/awb/${awb}`, { headers: h });
  return data;
};

// ── Cancel a shipment ────────────────────────
const cancelShipment = async (awbs) => {
  const h = await headers();
  const { data } = await axios.post(`${BASE_URL}/orders/cancel`, { awbs }, { headers: h });
  return data;
};

// ── Get serviceable couriers for a pincode ───
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

module.exports = { createShipment, assignAWB, trackShipment, trackByAWB, cancelShipment, getServiceability };
