// ============================================
// KOYAMBEDU BULK HARVEST — Controller
// Ad board, not a shoppable product — no cart/price/checkout logic here.
// Public teaser (crop, quantity, price, location) is visible to everyone;
// the farmer's phone number is only ever returned by revealContact, which
// requires login and logs a 'call' event — that's the lead signal.
// ============================================
const KoyambeduBulkHarvestListing = require('../models/KoyambeduBulkHarvestListing');
const KoyambeduBulkHarvestEvent   = require('../models/KoyambeduBulkHarvestEvent');

// ══════════════════════════════════════════════
// PUBLIC (optionalAuth — req.user may or may not be set)
// ══════════════════════════════════════════════

/** GET /koyambedu/bulk-harvest — teaser list, everyone sees the same fields regardless of login */
const listActive = async (req, res) => {
  try {
    const { state, cropName } = req.query;
    const filter = { status: 'active' };
    if (state) filter['location.state'] = state;
    if (cropName) filter.cropName = new RegExp(cropName, 'i');

    const listings = await KoyambeduBulkHarvestListing.find(filter).sort({ createdAt: -1 });
    res.json({ success: true, listings: listings.map(l => l.toTeaser()) });
  } catch (err) {
    console.error('[bulkHarvest.listActive]', err);
    res.status(500).json({ success: false, message: 'Failed to load listings' });
  }
};

/** GET /koyambedu/bulk-harvest/:id — teaser detail + logs a 'view' if logged in */
const getListing = async (req, res) => {
  try {
    const listing = await KoyambeduBulkHarvestListing.findById(req.params.id);
    if (!listing || listing.status !== 'active') {
      return res.status(404).json({ success: false, message: 'Listing not found' });
    }

    if (req.user) {
      // One view per user per listing — avoid inflating the counter on repeat visits.
      const alreadyViewed = await KoyambeduBulkHarvestEvent.exists({ listing: listing._id, user: req.user._id, action: 'view' });
      if (!alreadyViewed) {
        await KoyambeduBulkHarvestEvent.create({ listing: listing._id, user: req.user._id, action: 'view' });
        listing.viewCount += 1;
        await listing.save();
      }
    }

    res.json({ success: true, listing: listing.toTeaser(), loggedIn: !!req.user });
  } catch (err) {
    console.error('[bulkHarvest.getListing]', err);
    res.status(500).json({ success: false, message: 'Failed to load listing' });
  }
};

/** POST /koyambedu/bulk-harvest/:id/reveal — requires login (protect). Returns farmer contact + logs a 'call' lead. */
const revealContact = async (req, res) => {
  try {
    const listing = await KoyambeduBulkHarvestListing.findById(req.params.id);
    if (!listing || listing.status !== 'active') {
      return res.status(404).json({ success: false, message: 'Listing not found' });
    }

    await KoyambeduBulkHarvestEvent.create({ listing: listing._id, user: req.user._id, action: 'call' });
    listing.callCount += 1;
    await listing.save();

    res.json({ success: true, farmerName: listing.farmerName, farmerPhone: listing.farmerPhone });
  } catch (err) {
    console.error('[bulkHarvest.revealContact]', err);
    res.status(500).json({ success: false, message: 'Failed to reveal contact' });
  }
};

// ══════════════════════════════════════════════
// SUPER ADMIN
// ══════════════════════════════════════════════

/** GET /koyambedu/bulk-harvest/admin — all listings, any status */
const adminList = async (req, res) => {
  try {
    const listings = await KoyambeduBulkHarvestListing.find().sort({ createdAt: -1 });
    res.json({ success: true, listings });
  } catch (err) {
    console.error('[bulkHarvest.adminList]', err);
    res.status(500).json({ success: false, message: 'Failed to load listings' });
  }
};

/** POST /koyambedu/bulk-harvest/admin — create, up to 5 images via uploadBulkHarvest.array('images', 5) */
const adminCreate = async (req, res) => {
  try {
    const {
      cropName, variety, headline, quantityAvailable, quantityUnit,
      dailyRate, dailyRateUnit, village, district, state,
      harvestStart, harvestEnd, priceText, farmerName, farmerPhone,
    } = req.body;

    if (!cropName || !quantityAvailable || !state || !farmerName || !farmerPhone) {
      return res.status(400).json({ success: false, message: 'Crop, quantity, state, farmer name and phone are required' });
    }

    const images = (req.files || []).map(f => ({ url: f.path, publicId: f.filename }));

    const listing = await KoyambeduBulkHarvestListing.create({
      cropName, variety, headline,
      quantityAvailable: Number(quantityAvailable),
      quantityUnit: quantityUnit || 'tons',
      dailyRate: dailyRate ? Number(dailyRate) : null,
      dailyRateUnit: dailyRateUnit || 'tons/day',
      location: { village: village || '', district: district || '', state },
      harvestWindow: { start: harvestStart || null, end: harvestEnd || null },
      priceText: priceText || 'Contact for price',
      images,
      farmerName, farmerPhone,
      createdBy: req.user._id,
      createdByName: req.user.name,
    });

    res.json({ success: true, listing });
  } catch (err) {
    console.error('[bulkHarvest.adminCreate]', err);
    res.status(500).json({ success: false, message: 'Failed to create listing' });
  }
};

/** PUT /koyambedu/bulk-harvest/admin/:id — update; new images (if any) are appended, capped at 5 total */
const adminUpdate = async (req, res) => {
  try {
    const listing = await KoyambeduBulkHarvestListing.findById(req.params.id);
    if (!listing) return res.status(404).json({ success: false, message: 'Listing not found' });

    const {
      cropName, variety, headline, quantityAvailable, quantityUnit,
      dailyRate, dailyRateUnit, village, district, state,
      harvestStart, harvestEnd, priceText, farmerName, farmerPhone,
    } = req.body;

    if (cropName != null) listing.cropName = cropName;
    if (variety != null) listing.variety = variety;
    if (headline != null) listing.headline = headline;
    if (quantityAvailable != null) listing.quantityAvailable = Number(quantityAvailable);
    if (quantityUnit != null) listing.quantityUnit = quantityUnit;
    if (dailyRate != null) listing.dailyRate = dailyRate === '' ? null : Number(dailyRate);
    if (dailyRateUnit != null) listing.dailyRateUnit = dailyRateUnit;
    if (village != null) listing.location.village = village;
    if (district != null) listing.location.district = district;
    if (state != null) listing.location.state = state;
    if (harvestStart != null) listing.harvestWindow.start = harvestStart || null;
    if (harvestEnd != null) listing.harvestWindow.end = harvestEnd || null;
    if (priceText != null) listing.priceText = priceText;
    if (farmerName != null) listing.farmerName = farmerName;
    if (farmerPhone != null) listing.farmerPhone = farmerPhone;

    if (req.files?.length) {
      const newImages = req.files.map(f => ({ url: f.path, publicId: f.filename }));
      listing.images = [...listing.images, ...newImages].slice(0, 5);
    }

    await listing.save();
    res.json({ success: true, listing });
  } catch (err) {
    console.error('[bulkHarvest.adminUpdate]', err);
    res.status(500).json({ success: false, message: 'Failed to update listing' });
  }
};

/** DELETE /koyambedu/bulk-harvest/admin/:id/image/:index — remove a single image by array index
 * (index, not publicId, since Cloudinary public_ids contain slashes that don't survive as a URL param) */
const adminRemoveImage = async (req, res) => {
  try {
    const listing = await KoyambeduBulkHarvestListing.findById(req.params.id);
    if (!listing) return res.status(404).json({ success: false, message: 'Listing not found' });
    const idx = Number(req.params.index);
    if (!Number.isInteger(idx) || idx < 0 || idx >= listing.images.length) {
      return res.status(400).json({ success: false, message: 'Invalid image index' });
    }
    listing.images.splice(idx, 1);
    await listing.save();
    res.json({ success: true, listing });
  } catch (err) {
    console.error('[bulkHarvest.adminRemoveImage]', err);
    res.status(500).json({ success: false, message: 'Failed to remove image' });
  }
};

/** PATCH /koyambedu/bulk-harvest/admin/:id/status — active / inactive / expired */
const adminSetStatus = async (req, res) => {
  try {
    const { status } = req.body;
    if (!['active', 'inactive', 'expired'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' });
    }
    const listing = await KoyambeduBulkHarvestListing.findByIdAndUpdate(req.params.id, { status }, { new: true });
    if (!listing) return res.status(404).json({ success: false, message: 'Listing not found' });
    res.json({ success: true, listing });
  } catch (err) {
    console.error('[bulkHarvest.adminSetStatus]', err);
    res.status(500).json({ success: false, message: 'Failed to update status' });
  }
};

/** DELETE /koyambedu/bulk-harvest/admin/:id */
const adminDelete = async (req, res) => {
  try {
    await KoyambeduBulkHarvestListing.findByIdAndDelete(req.params.id);
    await KoyambeduBulkHarvestEvent.deleteMany({ listing: req.params.id });
    res.json({ success: true });
  } catch (err) {
    console.error('[bulkHarvest.adminDelete]', err);
    res.status(500).json({ success: false, message: 'Failed to delete listing' });
  }
};

/** GET /koyambedu/bulk-harvest/admin/dashboard — visit counts + lead table */
const adminDashboard = async (req, res) => {
  try {
    const [totalListings, activeListings, totalViews, totalCalls] = await Promise.all([
      KoyambeduBulkHarvestListing.countDocuments(),
      KoyambeduBulkHarvestListing.countDocuments({ status: 'active' }),
      KoyambeduBulkHarvestEvent.countDocuments({ action: 'view' }),
      KoyambeduBulkHarvestEvent.countDocuments({ action: 'call' }),
    ]);

    const topListings = await KoyambeduBulkHarvestListing.find()
      .sort({ callCount: -1, viewCount: -1 })
      .limit(10)
      .select('cropName location viewCount callCount status');

    const leads = await KoyambeduBulkHarvestEvent.find({ action: 'call' })
      .sort({ createdAt: -1 })
      .limit(100)
      .populate('user', 'name phone')
      .populate('listing', 'cropName location');

    res.json({
      success: true,
      totals: { totalListings, activeListings, totalViews, totalCalls },
      topListings,
      leads: leads.map(e => ({
        userName: e.user?.name || 'Unknown',
        userPhone: e.user?.phone || '',
        cropName: e.listing?.cropName || 'Deleted listing',
        location: e.listing?.location || null,
        at: e.createdAt,
      })),
    });
  } catch (err) {
    console.error('[bulkHarvest.adminDashboard]', err);
    res.status(500).json({ success: false, message: 'Failed to load dashboard' });
  }
};

module.exports = {
  listActive, getListing, revealContact,
  adminList, adminCreate, adminUpdate, adminRemoveImage, adminSetStatus, adminDelete, adminDashboard,
};
