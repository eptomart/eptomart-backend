// ============================================
// KOYAMBEDU DELIVERY HUBS — Super Admin
// Hubs are the origins delivery distance is measured from (nearest active
// one wins). A hub can be mapped from an Express store or a custom pin.
// ============================================
const KoyambeduSettings = require('../models/KoyambeduSettings');
const ExpressStore = require('../models/ExpressStore');

// GET /admin/hubs → { hubs, expressStores }
exports.list = async (req, res) => {
  try {
    const doc = await KoyambeduSettings.getGlobal();
    const stores = await ExpressStore.find({ isArchived: false }).select('name city address location isActive').sort({ name: 1 }).lean();
    res.json({
      success: true,
      hubs: (doc.hubs || []).map(h => ({ _id: h._id, name: h.name, lat: h.lat, lng: h.lng, expressStore: h.expressStore || null, isActive: h.isActive !== false })),
      expressStores: stores.map(s => ({ _id: s._id, name: s.name, city: s.city, address: s.address, lat: s.location?.lat, lng: s.location?.lng, isActive: s.isActive })),
    });
  } catch (e) { console.error('[hubs.list]', e); res.status(500).json({ success: false, message: 'Failed to load hubs' }); }
};

// PUT /admin/hubs { hubs: [{name, lat, lng, expressStore?, isActive}] } — replaces the list
exports.save = async (req, res) => {
  try {
    const raw = Array.isArray(req.body.hubs) ? req.body.hubs : [];
    const storeIds = raw.map(h => h.expressStore).filter(Boolean);
    const stores = storeIds.length ? await ExpressStore.find({ _id: { $in: storeIds } }).select('name location').lean() : [];
    const byId = new Map(stores.map(s => [String(s._id), s]));
    const hubs = [];
    for (const h of raw) {
      const st = h.expressStore ? byId.get(String(h.expressStore)) : null;
      // Express-mapped hubs always take the store's current coordinates
      const lat = st ? st.location?.lat : Number(h.lat);
      const lng = st ? st.location?.lng : Number(h.lng);
      const name = String(h.name || st?.name || '').trim();
      if (!name) return res.status(400).json({ success: false, message: 'Every hub needs a name' });
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
        return res.status(400).json({ success: false, message: `"${name}" needs a valid latitude and longitude` });
      }
      hubs.push({ name, lat, lng, expressStore: st ? st._id : null, isActive: h.isActive !== false });
    }
    const doc = await KoyambeduSettings.findOneAndUpdate({ key: 'global' }, { $set: { hubs } }, { upsert: true, new: true, setDefaultsOnInsert: true });
    res.json({ success: true, hubs: doc.hubs });
  } catch (e) { console.error('[hubs.save]', e); res.status(500).json({ success: false, message: 'Failed to save hubs' }); }
};
