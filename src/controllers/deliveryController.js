const Product  = require('../models/Product');
const Seller   = require('../models/Seller');
const { estimate, geocode } = require('../utils/deliveryEstimator');

// ── Estimate for a single product + buyer pincode ────────
const estimateDelivery = async (req, res) => {
  const { productId, sellerId, buyerPincode } = req.body;

  if (!buyerPincode) {
    return res.status(400).json({ success: false, message: 'buyerPincode is required' });
  }

  let sellerPincode, sellerCoords;

  if (sellerId) {
    const seller = await Seller.findById(sellerId).select('address').lean();
    if (seller?.address?.pincode) {
      sellerPincode = seller.address.pincode;
      if (seller.address.lat && seller.address.lng) {
        sellerCoords = { lat: seller.address.lat, lng: seller.address.lng };
      }
    }
  } else if (productId) {
    const product = await Product.findById(productId).select('location seller').lean();
    if (product?.location?.pincode) {
      sellerPincode = product.location.pincode;
    } else if (product?.seller) {
      const seller = await Seller.findById(product.seller).select('address').lean();
      sellerPincode = seller?.address?.pincode;
    }
  }

  if (!sellerPincode) {
    return res.json({
      success: true,
      estimate: { distanceKm: null, min: 3, max: 7, label: 'Delivered in 3-7 days', tier: 'unknown' },
    });
  }

  const result = await estimate(sellerPincode, buyerPincode, sellerCoords);
  res.json({ success: true, estimate: result });
};

// ── Estimate for entire cart ─────────────────────────────
const estimateCart = async (req, res) => {
  const { items, buyerPincode } = req.body;
  if (!buyerPincode || !items?.length) {
    return res.status(400).json({ success: false, message: 'items and buyerPincode required' });
  }

  const results = await Promise.all(
    items.map(async (item) => {
      let sellerPincode;
      if (item.sellerId) {
        const s = await Seller.findById(item.sellerId).select('address businessName').lean();
        sellerPincode = s?.address?.pincode;
        const result = await estimate(sellerPincode, buyerPincode);
        return { sellerId: item.sellerId, sellerName: s?.businessName, ...result };
      }
      return { sellerId: null, label: 'Delivered in 3-7 days', min: 3, max: 7 };
    })
  );

  res.json({ success: true, estimates: results });
};

// ── Geocode a pincode ────────────────────────────────────
const geocodePincode = async (req, res) => {
  const { pincode } = req.params;
  if (!pincode) return res.status(400).json({ success: false, message: 'pincode required' });
  const result = await geocode(pincode);
  if (!result) return res.status(404).json({ success: false, message: 'Pincode not found' });
  res.json({ success: true, ...result });
};

module.exports = { estimateDelivery, estimateCart, geocodePincode };
