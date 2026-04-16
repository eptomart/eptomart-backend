const express  = require('express');
const router   = express.Router();
const Product  = require('../models/Product');
const Category = require('../models/Category');

const BASE = 'https://www.eptomart.com';

const url = (loc, priority = '0.5', freq = 'weekly', lastmod) =>
  `  <url>
    <loc>${loc}</loc>
    <lastmod>${(lastmod || new Date()).toISOString().split('T')[0]}</lastmod>
    <changefreq>${freq}</changefreq>
    <priority>${priority}</priority>
  </url>`;

router.get('/sitemap.xml', async (req, res) => {
  try {
    const [products, categories] = await Promise.all([
      Product.find({ isActive: true, approvalStatus: 'approved' })
        .select('slug updatedAt')
        .sort({ updatedAt: -1 })
        .limit(1000)
        .lean(),
      Category.find({ isActive: true })
        .select('slug updatedAt')
        .lean(),
    ]);

    const staticPages = [
      url(`${BASE}/`,       '1.0', 'daily'),
      url(`${BASE}/shop`,   '0.9', 'daily'),
      url(`${BASE}/login`,  '0.3', 'monthly'),
      url(`${BASE}/cart`,   '0.3', 'monthly'),
    ];

    const categoryUrls = categories.map(c =>
      url(`${BASE}/shop/${c.slug}`, '0.8', 'daily', c.updatedAt)
    );

    const productUrls = products.map(p =>
      url(`${BASE}/product/${p.slug}`, '0.7', 'weekly', p.updatedAt)
    );

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${[...staticPages, ...categoryUrls, ...productUrls].join('\n')}
</urlset>`;

    res.header('Content-Type', 'application/xml');
    res.header('Cache-Control', 'public, max-age=3600'); // cache 1 hour
    res.send(xml);
  } catch (err) {
    res.status(500).send('<?xml version="1.0"?><urlset></urlset>');
  }
});

router.get('/robots.txt', (req, res) => {
  res.header('Content-Type', 'text/plain');
  res.send(`User-agent: *
Allow: /
Disallow: /admin
Disallow: /seller
Disallow: /checkout
Disallow: /orders
Disallow: /profile
Disallow: /cart
Disallow: /wishlist

Sitemap: ${BASE}/sitemap.xml`);
});

module.exports = router;
