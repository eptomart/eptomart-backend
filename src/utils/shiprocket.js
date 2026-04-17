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

// ── Create a Shiprocket order + shipment ────
const createShipment = async (order, shippingAddress) => {
  const h = await headers();

  // Map Eptomart order to Shiprocket format
  const payload = {
    order_id:           order.orderId || order._id.toString(),
    order_date:         new Date(order.createdAt).toISOString().split('T')[0],
    pickup_location:    process.env.SHIPROCKET_PICKUP_LOCATION || 'Primary',
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
  return data;
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

module.exports = { createShipment, trackShipment, trackByAWB, cancelShipment, getServiceability };
