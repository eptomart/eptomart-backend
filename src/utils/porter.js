// ============================================
// PORTER API INTEGRATION
// Hyperlocal delivery for EptoFresh orders
// Docs: https://api.porter.in/v1/
// ============================================
const https = require('https');

const PORTER_BASE  = process.env.PORTER_BASE_URL || 'https://pfe-apigw-uat.porter.in';
const PORTER_KEY   = process.env.PORTER_API_KEY  || '';

/**
 * Generic Porter API call (native https — no axios needed)
 */
function porterRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(PORTER_BASE + path);
    const payload = body ? JSON.stringify(body) : null;

    const options = {
      hostname: url.hostname,
      port:     url.port || 443,
      path:     url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key':    PORTER_KEY,
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 400) {
            reject(new Error(parsed.message || `Porter API error ${res.statusCode}`));
          } else {
            resolve(parsed);
          }
        } catch {
          reject(new Error('Porter API returned non-JSON response'));
        }
      });
    });

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/**
 * Get fare estimate for a delivery
 */
async function getPorterQuote({ pickupLat, pickupLng, dropLat, dropLng }) {
  if (!PORTER_KEY) return null;
  try {
    const body = {
      pickup_details: { lat: pickupLat, lng: pickupLng },
      drop_details:   { lat: dropLat,   lng: dropLng },
      customer: { name: 'EptoFresh Customer', mobile: { country_code: '+91', number: '9999999999' } },
    };
    const result = await porterRequest('POST', '/v1/get_quote', body);
    return result;
  } catch (err) {
    console.error('[Porter] Quote error:', err.message);
    return null;
  }
}

/**
 * Create a Porter delivery order after admin approves packed photos
 * @param {Object} order  - EptoFreshOrder document
 * @param {Object} seller - EptoFreshSeller document
 */
async function createPorterOrder(order, seller) {
  if (!PORTER_KEY) {
    console.warn('[Porter] API key not configured — skipping delivery booking');
    return null;
  }

  const pickup = seller.location?.coordinates;   // [lng, lat]
  const drop   = order.shippingAddress;

  const body = {
    request_id: order.orderId,
    delivery_instructions: {
      instructions_list: [
        { type: 'text', description: `EptoFresh Order #${order.orderId}. Please handle perishable items with care.` },
      ],
    },
    pickup_details: {
      address: {
        apartment_address: seller.address?.addressLine1 || '',
        street_address1:   seller.address?.addressLine2 || '',
        city:              seller.address?.city || 'Chennai',
        state:             seller.address?.state || 'Tamil Nadu',
        pincode:           seller.address?.pincode || '',
        country:           'India',
        lat:               pickup ? pickup[1] : 0,
        lng:               pickup ? pickup[0] : 0,
        contact_details: {
          name:   seller.shopName,
          phone_number: seller.contact?.phone || '',
        },
      },
    },
    drop_details: {
      address: {
        apartment_address: drop.addressLine1 || '',
        street_address1:   drop.addressLine2 || '',
        city:              drop.city || 'Chennai',
        state:             drop.state || 'Tamil Nadu',
        pincode:           drop.pincode || '',
        country:           'India',
        lat:               drop.lat || 0,
        lng:               drop.lng || 0,
        contact_details: {
          name:   'EptoFresh Customer',          // Privacy — no real name
          phone_number: drop.phone || '',         // Delivery phone only
        },
      },
    },
  };

  try {
    const result = await porterRequest('POST', '/v1/orders', body);
    console.log('[Porter] Order created:', result.order_id);
    return result;
  } catch (err) {
    console.error('[Porter] Order creation failed:', err.message);
    throw err;
  }
}

/**
 * Get Porter order status
 */
async function getPorterOrderStatus(porterOrderId) {
  if (!PORTER_KEY || !porterOrderId) return null;
  try {
    const result = await porterRequest('GET', `/v1/orders/${porterOrderId}`);
    return result;
  } catch (err) {
    console.error('[Porter] Status fetch failed:', err.message);
    return null;
  }
}

/**
 * Cancel a Porter order
 */
async function cancelPorterOrder(porterOrderId) {
  if (!PORTER_KEY || !porterOrderId) return null;
  try {
    const result = await porterRequest('POST', `/v1/orders/${porterOrderId}/cancel`);
    return result;
  } catch (err) {
    console.error('[Porter] Cancel failed:', err.message);
    return null;
  }
}

module.exports = { getPorterQuote, createPorterOrder, getPorterOrderStatus, cancelPorterOrder };
