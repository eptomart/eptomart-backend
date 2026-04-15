const https = require('https');

const TIERS = [
  { maxKm: 15,       min: 0, max: 0,  tier: 'same_day' },
  { maxKm: 100,      min: 1, max: 2,  tier: 'local'    },
  { maxKm: 500,      min: 2, max: 4,  tier: 'regional' },
  { maxKm: 1500,     min: 4, max: 6,  tier: 'national' },
  { maxKm: Infinity, min: 6, max: 9,  tier: 'remote'   },
];

const haversineKm = (lat1, lng1, lat2, lng2) => {
  const R    = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a    = Math.sin(dLat / 2) ** 2 +
               Math.cos(lat1 * Math.PI / 180) *
               Math.cos(lat2 * Math.PI / 180) *
               Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const fmtDate = (d) =>
  d.toLocaleDateString('en-IN', { weekday: 'short', month: 'short', day: 'numeric' });

const buildLabel = (min, max) => {
  const today = new Date();
  const d1 = new Date(today); d1.setDate(today.getDate() + min);
  const d2 = new Date(today); d2.setDate(today.getDate() + max);
  if (min === 0)       return 'Delivered Today by 9 PM';
  if (min === max)     return `Delivered by ${fmtDate(d1)}`;
  return `Delivered by ${fmtDate(d1)} – ${fmtDate(d2)}`;
};

// In-memory geocode cache (cleared on server restart — acceptable for free tier)
const cache = new Map();

const nominatim = (pincode) => new Promise((resolve) => {
  const url = `https://nominatim.openstreetmap.org/search?postalcode=${pincode}&country=India&format=json&limit=1`;
  const opts = { headers: { 'User-Agent': 'Eptomart/1.0 (support@eptomart.com)' } };
  https.get(url, opts, (res) => {
    let raw = '';
    res.on('data', c => raw += c);
    res.on('end', () => {
      try {
        const arr = JSON.parse(raw);
        if (!arr.length) return resolve(null);
        const r = arr[0];
        const parts = r.display_name.split(',');
        resolve({
          lat: parseFloat(r.lat),
          lng: parseFloat(r.lon),
          city:  parts[0]?.trim() || '',
          state: parts[parts.length - 2]?.trim() || '',
        });
      } catch { resolve(null); }
    });
  }).on('error', () => resolve(null));
});

const geocode = async (pincode) => {
  if (!pincode) return null;
  const key = pincode.toString().trim();
  if (cache.has(key)) return cache.get(key);
  const result = await nominatim(key);
  if (result) cache.set(key, result);
  return result;
};

// Fallback when geocoding fails: compare first 3 digits
const fallback = (pin1, pin2) => {
  const p1 = String(pin1).slice(0, 3);
  const p2 = String(pin2).slice(0, 3);
  const tier = p1 === p2 ? TIERS[1] : TIERS[3];
  return { distanceKm: null, ...tier, label: buildLabel(tier.min, tier.max) };
};

const estimate = async (sellerPincode, buyerPincode, cachedSellerCoords = null) => {
  if (!sellerPincode || !buyerPincode) {
    return { distanceKm: null, min: 3, max: 7, tier: 'unknown', label: 'Delivered in 3-7 days' };
  }

  const [seller, buyer] = await Promise.all([
    cachedSellerCoords ? Promise.resolve(cachedSellerCoords) : geocode(sellerPincode),
    geocode(buyerPincode),
  ]);

  if (!seller || !buyer) return fallback(sellerPincode, buyerPincode);

  const km   = haversineKm(seller.lat, seller.lng, buyer.lat, buyer.lng);
  const tier = TIERS.find(t => km <= t.maxKm);

  return {
    distanceKm:  Math.round(km),
    min:         tier.min,
    max:         tier.max,
    tier:        tier.tier,
    label:       buildLabel(tier.min, tier.max),
    sellerCity:  seller.city,
    buyerCity:   buyer.city,
  };
};

module.exports = { estimate, geocode, haversineKm };
