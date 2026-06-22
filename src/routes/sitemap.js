/**
 * EPTOMART SITEMAP — Multi-sub-app sitemap generator
 * Covers: Main App, Koyambedu Daily, EptoFresh, Uzhavar
 * Routes:
 *   GET /sitemap.xml             → sitemap index
 *   GET /sitemap/main.xml        → main Eptomart pages + products
 *   GET /sitemap/koyambedu.xml   → Koyambedu Daily pages + products
 *   GET /sitemap/eptofresh.xml   → EptoFresh pages + sellers
 *   GET /sitemap/uzhavar.xml     → Uzhavar pages + farmers
 *   GET /robots.txt              → robots with all sitemap links
 */
const express  = require('express');
const router   = express.Router();

// Models
const Product           = require('../models/Product');
const Category          = require('../models/Category');
const KoyambeduProduct  = require('../models/KoyambeduProduct');
const KoyambeduCategory = require('../models/KoyambeduCategory');
const EptoFreshSeller   = require('../models/EptoFreshSeller');

const BASE = 'https://www.eptomart.com';

// ── Helpers ─────────────────────────────────────────────────────────────────
const urlEntry = (loc, { priority = '0.5', freq = 'weekly', lastmod } = {}) =>
  `  <url>
    <loc>${loc}</loc>
    <lastmod>${(lastmod ? new Date(lastmod) : new Date()).toISOString().split('T')[0]}</lastmod>
    <changefreq>${freq}</changefreq>
    <priority>${priority}</priority>
  </url>`;

const wrapUrlset = (entries) =>
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.join('\n')}
</urlset>`;

const wrapIndex = (sitemaps) =>
  `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemaps.map(s => `  <sitemap>\n    <loc>${s}</loc>\n    <lastmod>${new Date().toISOString().split('T')[0]}</lastmod>\n  </sitemap>`).join('\n')}
</sitemapindex>`;

const xmlHeader = (res) => {
  res.header('Content-Type', 'application/xml');
  res.header('Cache-Control', 'public, max-age=3600');
};

// ── Sitemap Index ────────────────────────────────────────────────────────────
router.get('/sitemap.xml', (req, res) => {
  xmlHeader(res);
  res.send(wrapIndex([
    `${BASE}/sitemap/main.xml`,
    `${BASE}/sitemap/koyambedu.xml`,
    `${BASE}/sitemap/eptofresh.xml`,
    `${BASE}/sitemap/uzhavar.xml`,
  ]));
});

// ── Main Eptomart Sitemap ────────────────────────────────────────────────────
router.get('/sitemap/main.xml', async (req, res) => {
  try {
    const [products, categories] = await Promise.all([
      Product.find({ isActive: true, approvalStatus: 'approved' })
        .select('slug updatedAt').sort({ updatedAt: -1 }).limit(1000).lean(),
      Category.find({ isActive: true })
        .select('slug updatedAt').lean(),
    ]);

    const staticPages = [
      urlEntry(`${BASE}/`,               { priority: '1.0', freq: 'daily' }),
      urlEntry(`${BASE}/shop`,            { priority: '0.9', freq: 'daily' }),
      urlEntry(`${BASE}/categories`,      { priority: '0.8', freq: 'weekly' }),
      urlEntry(`${BASE}/about`,           { priority: '0.5', freq: 'monthly' }),
      urlEntry(`${BASE}/contact`,         { priority: '0.5', freq: 'monthly' }),
      urlEntry(`${BASE}/faq`,             { priority: '0.5', freq: 'monthly' }),
      urlEntry(`${BASE}/shipping-policy`, { priority: '0.3', freq: 'monthly' }),
      urlEntry(`${BASE}/return-policy`,   { priority: '0.3', freq: 'monthly' }),
      urlEntry(`${BASE}/privacy-policy`,  { priority: '0.3', freq: 'monthly' }),
      urlEntry(`${BASE}/terms-of-service`,{ priority: '0.3', freq: 'monthly' }),
    ];

    const categoryUrls = categories.map(c =>
      urlEntry(`${BASE}/shop/${c.slug}`, { priority: '0.8', freq: 'daily', lastmod: c.updatedAt })
    );
    const productUrls = products.map(p =>
      urlEntry(`${BASE}/product/${p.slug}`, { priority: '0.7', freq: 'weekly', lastmod: p.updatedAt })
    );

    xmlHeader(res);
    res.send(wrapUrlset([...staticPages, ...categoryUrls, ...productUrls]));
  } catch (err) {
    console.error('[sitemap/main]', err);
    res.status(500).send('<?xml version="1.0"?><urlset></urlset>');
  }
});

// ── Koyambedu Daily Sitemap ──────────────────────────────────────────────────
router.get('/sitemap/koyambedu.xml', async (req, res) => {
  try {
    const [products, categories] = await Promise.all([
      KoyambeduProduct.find({ isAvailable: true })
        .select('_id updatedAt').sort({ updatedAt: -1 }).limit(500).lean(),
      KoyambeduCategory.find({ isActive: true, status: 'approved' })
        .select('slug updatedAt').lean(),
    ]);

    const staticPages = [
      urlEntry(`${BASE}/koyambedu`,            { priority: '0.9', freq: 'daily' }),
      urlEntry(`${BASE}/koyambedu/shop`,        { priority: '0.9', freq: 'daily' }),
      urlEntry(`${BASE}/koyambedu/seller/register`, { priority: '0.4', freq: 'monthly' }),
    ];

    const categoryUrls = categories.map(c =>
      urlEntry(`${BASE}/koyambedu/shop?category=${c.slug}`, { priority: '0.7', freq: 'daily', lastmod: c.updatedAt })
    );
    const productUrls = products.map(p =>
      urlEntry(`${BASE}/koyambedu/product/${p._id}`, { priority: '0.7', freq: 'daily', lastmod: p.updatedAt })
    );

    xmlHeader(res);
    res.send(wrapUrlset([...staticPages, ...categoryUrls, ...productUrls]));
  } catch (err) {
    console.error('[sitemap/koyambedu]', err);
    // Return minimal valid sitemap on error (model may not exist yet in staging)
    xmlHeader(res);
    res.send(wrapUrlset([
      urlEntry(`${BASE}/koyambedu`,     { priority: '0.9', freq: 'daily' }),
      urlEntry(`${BASE}/koyambedu/shop`,{ priority: '0.9', freq: 'daily' }),
    ]));
  }
});

// ── EptoFresh Sitemap ────────────────────────────────────────────────────────
router.get('/sitemap/eptofresh.xml', async (req, res) => {
  try {
    const sellers = await EptoFreshSeller.find({ isActive: true, isApproved: true })
      .select('_id updatedAt').sort({ updatedAt: -1 }).limit(200).lean();

    const staticPages = [
      urlEntry(`${BASE}/eptofresh`,                    { priority: '0.9', freq: 'daily' }),
      urlEntry(`${BASE}/eptofresh/seller/register`,    { priority: '0.4', freq: 'monthly' }),
    ];

    const sellerUrls = sellers.map(s =>
      urlEntry(`${BASE}/eptofresh/shop/${s._id}`, { priority: '0.7', freq: 'weekly', lastmod: s.updatedAt })
    );

    xmlHeader(res);
    res.send(wrapUrlset([...staticPages, ...sellerUrls]));
  } catch (err) {
    console.error('[sitemap/eptofresh]', err);
    xmlHeader(res);
    res.send(wrapUrlset([
      urlEntry(`${BASE}/eptofresh`, { priority: '0.9', freq: 'daily' }),
    ]));
  }
});

// ── Uzhavar Sitemap ──────────────────────────────────────────────────────────
router.get('/sitemap/uzhavar.xml', async (req, res) => {
  // Uzhavar farmer model may not have a dedicated schema yet; graceful fallback
  try {
    const staticPages = [
      urlEntry(`${BASE}/uzhavar`,                  { priority: '0.8', freq: 'weekly' }),
      urlEntry(`${BASE}/uzhavar/subscribe`,         { priority: '0.5', freq: 'monthly' }),
      urlEntry(`${BASE}/uzhavar/farmer/register`,   { priority: '0.4', freq: 'monthly' }),
    ];

    // Attempt to load farmer model dynamically (non-fatal if not present)
    let farmerUrls = [];
    try {
      const Farmer = require('../models/UzhavarFarmer');
      const farmers = await Farmer.find({ isActive: true })
        .select('_id updatedAt').sort({ updatedAt: -1 }).limit(200).lean();
      farmerUrls = farmers.map(f =>
        urlEntry(`${BASE}/uzhavar/farmer/${f._id}`, { priority: '0.6', freq: 'weekly', lastmod: f.updatedAt })
      );
    } catch (_) { /* model not loaded yet — skip */ }

    xmlHeader(res);
    res.send(wrapUrlset([...staticPages, ...farmerUrls]));
  } catch (err) {
    console.error('[sitemap/uzhavar]', err);
    xmlHeader(res);
    res.send(wrapUrlset([
      urlEntry(`${BASE}/uzhavar`, { priority: '0.8', freq: 'weekly' }),
    ]));
  }
});

// ── robots.txt ───────────────────────────────────────────────────────────────
router.get('/robots.txt', (req, res) => {
  res.header('Content-Type', 'text/plain');
  res.send(`User-agent: *
Allow: /
Allow: /koyambedu
Allow: /koyambedu/shop
Allow: /koyambedu/product/
Allow: /eptofresh
Allow: /eptofresh/shop/
Allow: /uzhavar
Allow: /uzhavar/farmer/
Allow: /shop
Allow: /categories
Allow: /product/
Allow: /about
Allow: /contact
Allow: /faq
Allow: /shipping-policy
Allow: /return-policy
Allow: /privacy-policy
Allow: /terms-of-service

Disallow: /admin
Disallow: /admin/*
Disallow: /checkout
Disallow: /cart
Disallow: /profile
Disallow: /orders
Disallow: /seller
Disallow: /seller/*
Disallow: /koyambedu/seller
Disallow: /koyambedu/seller-admin
Disallow: /eptofresh/seller
Disallow: /uzhavar/my-orders
Disallow: /api/
Disallow: /login
Disallow: /delete-account
Disallow: /wishlist

Crawl-delay: 1

Sitemap: ${BASE}/sitemap.xml
Sitemap: ${BASE}/sitemap/main.xml
Sitemap: ${BASE}/sitemap/koyambedu.xml
Sitemap: ${BASE}/sitemap/eptofresh.xml
Sitemap: ${BASE}/sitemap/uzhavar.xml`);
});

module.exports = router;
