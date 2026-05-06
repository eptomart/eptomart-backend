/**
 * seedHerbsSpices.js
 * ──────────────────
 * Inserts all Eptomart Premium Herbs & Spices products into the database.
 * - Skips any product whose name already exists (safe to re-run).
 * - Auto-looks up the "Groceries" category by name.
 *
 * Run: node scripts/seedHerbsSpices.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Product  = require('../src/models/Product');
const Category = require('../src/models/Category');

// ── Raw product data from the brief ──────────────────────────
const PRODUCTS = [
  { name: 'Premium Moringa Leaves Powder',     variant: '100g',  price: 249, discountPrice: 179, hsn: '1211', short: 'Nutrient-rich moringa powder made from premium dried leaves.',         tags: ['moringa','murungai','herbal powder','wellness','leaf powder'] },
  { name: 'Premium Tulsi Leaves Powder',       variant: '100g',  price: 249, discountPrice: 189, hsn: '1211', short: 'Pure tulsi powder with natural herbal aroma and freshness.',            tags: ['tulsi','basil','herbal powder','holy basil','wellness'] },
  { name: 'Premium Dried Mint Leaves Powder',  variant: '50g',   price: 199, discountPrice: 149, hsn: '1211', short: 'Aromatic dried mint powder for beverages and cooking.',                 tags: ['mint','pudina','dried herbs','herbal powder','mint leaves'] },
  { name: 'Premium Curry Leaves Powder',       variant: '100g',  price: 199, discountPrice: 149, hsn: '1211', short: 'Freshly dried curry leaf powder for authentic flavor.',                 tags: ['curry leaves','karuveppilai','herbs','leaf powder','seasoning'] },
  { name: 'Premium Rosemary Leaves',           variant: '50g',   price: 249, discountPrice: 189, hsn: '0910', short: 'Premium rosemary leaves for seasoning and herbal use.',                 tags: ['rosemary','dried herbs','seasoning','herbal leaves'] },
  { name: 'Premium Oregano Leaves',            variant: '50g',   price: 229, discountPrice: 169, hsn: '0910', short: 'Authentic oregano seasoning for pizzas and pasta.',                     tags: ['oregano','pizza seasoning','pasta herbs','dried herbs'] },
  { name: 'Premium Thyme Leaves',              variant: '50g',   price: 249, discountPrice: 189, hsn: '0910', short: 'Premium thyme leaves with rich aroma and flavor.',                     tags: ['thyme','herbs','seasoning','premium spice'] },
  { name: 'Premium Basil Leaves',              variant: '50g',   price: 229, discountPrice: 169, hsn: '0910', short: 'Naturally dried basil leaves for Italian cooking.',                    tags: ['basil','italian herbs','seasoning','dried basil'] },
  { name: 'Premium Lemongrass Tea Cut',        variant: '50g',   price: 199, discountPrice: 149, hsn: '1211', short: 'Fresh citrusy lemongrass for tea and herbal drinks.',                  tags: ['lemongrass','tea','herbal tea','wellness'] },
  { name: 'Premium Green Cardamom Pods',       variant: '100g',  price: 599, discountPrice: 499, hsn: '0908', short: 'Bold green aromatic cardamom sourced from premium estates.',           tags: ['cardamom','elaichi','green cardamom','premium spice'] },
  { name: 'Premium Cloves',                    variant: '100g',  price: 299, discountPrice: 239, hsn: '0907', short: 'Handpicked premium cloves with strong aroma and oil content.',         tags: ['cloves','lavangam','whole spice','aromatic spice'] },
  { name: 'Premium Ceylon Cinnamon Sticks',    variant: '100g',  price: 449, discountPrice: 349, hsn: '0906', short: 'True Ceylon cinnamon with delicate sweet flavor.',                     tags: ['cinnamon','ceylon cinnamon','dalchini','premium spice'] },
  { name: 'Premium Star Anise',                variant: '100g',  price: 299, discountPrice: 239, hsn: '0909', short: 'Premium star anise with rich licorice aroma.',                         tags: ['star anise','spices','biryani spice','aromatic spice'] },
  { name: 'Premium Nutmeg',                    variant: '100g',  price: 449, discountPrice: 359, hsn: '0908', short: 'Whole premium nutmeg with strong natural fragrance.',                  tags: ['nutmeg','jaiphal','whole spice','aromatic spice'] },
  { name: 'Premium Mace',                      variant: '50g',   price: 599, discountPrice: 499, hsn: '0908', short: 'Aromatic premium mace carefully sourced and dried.',                   tags: ['mace','javitri','whole spice','premium spice'] },
  { name: 'Premium Fennel Seeds',              variant: '250g',  price: 249, discountPrice: 189, hsn: '0909', short: 'Sweet and flavorful fennel seeds for cooking and mouth freshener.',    tags: ['fennel','saunf','fennel seeds','whole spice'] },
  { name: 'Premium Cumin Seeds',               variant: '250g',  price: 299, discountPrice: 229, hsn: '0909', short: 'Bold cumin seeds with high essential oil content.',                    tags: ['cumin','jeera','cumin seeds','premium spice'] },
  { name: 'Premium Coriander Seeds',           variant: '250g',  price: 199, discountPrice: 149, hsn: '0909', short: 'Naturally dried coriander seeds with rich aroma.',                    tags: ['coriander','dhania','coriander seeds','whole spice'] },
  { name: 'Premium Black Pepper',              variant: '250g',  price: 449, discountPrice: 369, hsn: '0904', short: 'High-density premium black pepper with strong flavor.',                tags: ['black pepper','peppercorns','milagu','premium spice'] },
  { name: 'Premium Thellicherry Black Pepper', variant: '250g',  price: 599, discountPrice: 499, hsn: '0904', short: 'Export-grade bold Thellicherry peppercorns.',                          tags: ['thellicherry pepper','black pepper','export quality spice'] },
  { name: 'Premium White Pepper',              variant: '100g',  price: 399, discountPrice: 319, hsn: '0904', short: 'Premium white pepper with smooth pungent flavor.',                     tags: ['white pepper','pepper spice','aromatic spice'] },
  { name: 'Premium Fenugreek Seeds',           variant: '250g',  price: 149, discountPrice: 119, hsn: '0910', short: 'Clean premium fenugreek seeds for cooking and wellness.',              tags: ['fenugreek','methi','whole spice','seeds'] },
  { name: 'Premium Black Sesame Seeds',        variant: '250g',  price: 249, discountPrice: 189, hsn: '1207', short: 'Nutrient-rich premium black sesame seeds.',                            tags: ['black sesame','sesame seeds','ellu','seeds'] },
  { name: 'Premium White Sesame Seeds',        variant: '250g',  price: 229, discountPrice: 179, hsn: '1207', short: 'Premium naturally cleaned white sesame seeds.',                        tags: ['white sesame','ellu','sesame seeds','premium seeds'] },
  { name: 'Premium Turmeric Powder',           variant: '250g',  price: 249, discountPrice: 189, hsn: '0910', short: 'High curcumin turmeric powder with vibrant color.',                   tags: ['turmeric','manjal','turmeric powder','spice powder'] },
  { name: 'Premium Kashmiri Chilli Powder',    variant: '250g',  price: 349, discountPrice: 279, hsn: '0904', short: 'Bright red Kashmiri chilli powder with mild heat.',                   tags: ['chilli powder','kashmiri chilli','spice powder'] },
  { name: 'Premium Garam Masala',              variant: '250g',  price: 349, discountPrice: 279, hsn: '0910', short: 'Traditional garam masala with balanced spice blend.',                 tags: ['garam masala','masala powder','indian spices'] },
  { name: 'Premium Chicken Masala',            variant: '250g',  price: 349, discountPrice: 279, hsn: '0910', short: 'Rich and aromatic chicken masala blend.',                             tags: ['chicken masala','non veg masala','spice blend'] },
  { name: 'Premium Fish Curry Masala',         variant: '250g',  price: 349, discountPrice: 279, hsn: '0910', short: 'Authentic coastal fish curry masala blend.',                          tags: ['fish masala','fish curry powder','seafood spice'] },
  { name: 'Premium Sambar Powder',             variant: '250g',  price: 299, discountPrice: 239, hsn: '0910', short: 'Traditional South Indian sambar powder.',                             tags: ['sambar powder','south indian spice','masala'] },
  { name: 'Premium Rasam Powder',              variant: '250g',  price: 299, discountPrice: 239, hsn: '0910', short: 'Aromatic rasam powder with balanced spices.',                         tags: ['rasam powder','south indian spice','masala'] },
  { name: 'Premium Biryani Masala',            variant: '250g',  price: 399, discountPrice: 319, hsn: '0910', short: 'Premium biryani masala for rich authentic flavor.',                   tags: ['biryani masala','biryani spice','masala blend'] },
];

// ── Build a slug from name ────────────────────────────────────
function makeSlug(name) {
  return name.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, '-').trim()
    + '-' + Date.now().toString().slice(-5);
}

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✅ Connected to MongoDB\n');

  // Look up Groceries category
  const category = await Category.findOne({ name: { $regex: /groceries/i } });
  if (!category) {
    console.error('❌ "Groceries" category not found. Please create it first in the admin panel.');
    await mongoose.disconnect();
    process.exit(1);
  }
  console.log(`📦 Category: ${category.name} (${category._id})\n`);

  let inserted = 0;
  let skipped  = 0;

  for (const p of PRODUCTS) {
    // Skip if already exists
    const exists = await Product.findOne({ name: p.name });
    if (exists) {
      console.log(`  ⏭  Skipped (exists): ${p.name}`);
      skipped++;
      continue;
    }

    await Product.create({
      name:             p.name,
      slug:             makeSlug(p.name),
      description:      p.short,
      shortDescription: p.short,
      price:            p.price,
      discountPrice:    p.discountPrice,
      stock:            25,
      brand:            'Epto',
      category:         category._id,
      tags:             p.tags,
      gstRate:          5,
      hsnCode:          p.hsn,
      priceIncludesGst: true,
      codAvailable:     true,
      freeShippingAbove: 1499,
      isActive:         true,
      isFeatured:       false,
      approvalStatus:   'approved',
      images:           [],          // no images yet — add via admin panel
      variants: [{
        label: p.variant,
        price: p.discountPrice,
        stock: 25,
      }],
      location: {
        city:    'Chennai',
        state:   'Tamil Nadu',
        pincode: '600001',
      },
    });

    console.log(`  ✓ Inserted: ${p.name} (${p.variant}) — MRP ₹${p.price} / Selling ₹${p.discountPrice}`);
    inserted++;
  }

  console.log(`\n─────────────────────────────────`);
  console.log(`✅ Done. Inserted: ${inserted} | Skipped: ${skipped} | Total: ${PRODUCTS.length}`);
  await mongoose.disconnect();
}

run().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
