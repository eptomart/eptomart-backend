// ============================================================
// SEED: 50 Premium Spices & Herbs — Malarveni Enterprises
// Run: node scripts/seedSpices.js
// ============================================================
require('dotenv').config();
const mongoose = require('mongoose');
const Seller   = require('../src/models/Seller');
const Category = require('../src/models/Category');
const Product  = require('../src/models/Product');

const SELLER_NAME = 'Malarveni Enterprises'; // matched case-insensitively

// Random stock — minimum 50, max 250
const rStock = () => Math.floor(Math.random() * 201) + 50;

// Unsplash image helper
const IMG = (id) =>
  `https://images.unsplash.com/${id}?auto=format&fit=crop&w=600&q=80`;

// ── Curated Unsplash photo IDs — verified from unsplash.com/photos/… ────────
// Short IDs (e.g. Y1JjwhHaPRM) are the new Unsplash slug format and work with
// the images.unsplash.com CDN exactly like the old photo-XXXXXX format.
const P = {
  // Powders & roots
  turmeric:     'Y1JjwhHaPRM',   // "Yellow powder on clear glass bowl" (turmeric powder)
  turmericRoot: 'Pj8qDxCuMTs',   // "Close-up of a bunch of ginger roots" (rhizome shape = turmeric root)
  chilli:       'mTqGgeYkfaY',   // "Red chili powder on white bowl"
  chilliWhole:  'Ia40W5jhINA',   // "Red chili lot on ground" — dried whole chillies
  coriander:    'eFwOKxmByEc',   // "Three spoons filled with different types of spices" (incl. coriander)
  ginger:       '7sg-CFuOc3g',   // "Fresh ginger root is shown up close"

  // Whole spices
  pepper:    'srxmFx025MI',              // "Spoon of peppers" — peppercorns
  cardamom:  'dZIs-KaRdu8',             // "A pile of dried cardamom pods on a dark surface"
  cinnamon:  'Xvjs1G812Yo',             // "Cinnamon sticks and cinnamon powder on a table"
  cloves:    '7472HfbBMrY',             // "A spoon full of cloves on a white surface"
  staranise: 'photo-1506368083636-6defb67639a7', // star anise whole
  nutmeg:    'photo-1598512752271-33f913a5af13', // nutmeg whole

  // Seeds
  cumin:     '38iUwPww0Xc',             // "Glass jars with spices" (incl. cumin seeds)
  mustard:   'photo-1543258103-a7d9b91a4ff3',   // mustard seeds
  fennel:    'photo-1563805042-7684c019e1cb',   // fennel seeds
  fenugreek: 'photo-1574323347407-f5e1ad6d020b', // fenugreek seeds
  sesame:    'NQW68EQnlhg',             // "A spoon full of sesame seeds" — FIXED (was dup of mustard)
  seeds:     '3ou1TDqCkXo',             // "Spice display in store" — FIXED (was dup of cumin)

  // Masalas & blends
  masala:    'NPrWYa69Mz0',             // "A variety of spices on a white table"
  sambar:    'qkgxIZOhvWI',             // Herbs and spices on dark background (Tamanna Rumee)
  spicemix:  'j401MN4U3pI',             // "A pile of spices next to a red chili" — FIXED (was dup of saffron)

  // Aromatic & premium
  saffron:    'photo-1596040033229-a9821ebd058d',  // saffron / colorful spices
  vanilla:    'photo-1568702846914-96b305d2aaeb',  // vanilla pods
  rosepetals: 'TJhi0SdgWoA',             // "Dried rose flowers" — NEW (product was using vanilla photo)
  tamarind:   'photo-1601648764658-cf37e8c89b70',  // tamarind / dark dried fruit

  // Health herbs & greens
  herbs:     'photo-1466637574441-749b8f19f9f9',   // fresh herbs / plants
  moringa:   'photo-1519996409144-56c88c35d023',   // moringa / green leaves
};

// ─────────────────────────────────────────────────────────────
// HSN CODE REFERENCE (Indian Customs Tariff)
//  09041110 — Black pepper, whole
//  09041210 — Black pepper, ground/powder
//  09042110 — Chilli (Capsicum), whole dried
//  09042219 — Chilli powder / paprika powder
//  09051000 — Vanilla beans/pods
//  09061100 — True Ceylon cinnamon, whole
//  09061900 — Other cinnamon
//  09071010 — Cloves, whole
//  09081110 — Nutmeg, whole
//  09081210 — Mace, whole
//  09083110 — Small/green cardamom
//  09083210 — Large/black cardamom
//  09092110 — Coriander seeds, whole
//  09092220 — Coriander, crushed or ground
//  09092910 — Fennel seeds
//  09093110 — Cumin seeds, whole
//  09093290 — Carom / Ajwain seeds
//  09096110 — Star anise, whole
//  09101110 — Ginger, not ground (dried whole)
//  09101120 — Ginger, ground/powder
//  09102010 — Turmeric, not ground (whole dried)
//  09102020 — Turmeric powder
//  09102090 — Saffron
//  09109120 — Bay leaves
//  09109190 — Fenugreek seeds (spice use)
//  09109910 — Mixed spices / masala blends
//  12029010 — Poppy seeds
//  12040010 — Linseed / flaxseeds
//  12074010 — Mustard seeds
//  12074090 — Sesame seeds
//  12119031 — Moringa (drumstick leaf)
//  12119091 — Other medicinal/aromatic plants (tulsi, neem, kalpasi, etc.)
//  13019040 — Asafoetida / Hing
//  08131010 — Tamarind, dried
//  08131090 — Dried fruit (amchur / dry mango powder)
//  08109020 — Pomegranate (dried seeds / anardana)
// ─────────────────────────────────────────────────────────────

const PRODUCTS = [

  /* ══ POWDERS ══════════════════════════════════════════════ */
  {
    name: 'Premium Turmeric Powder (Haldi)',
    short: 'Pure, bright yellow | High curcumin | No additives',
    desc: 'Cold-stone ground turmeric from Salem, Tamil Nadu. Vibrant colour, earthy aroma, zero additives. High curcumin content — ideal for cooking, golden milk, and Ayurvedic use.',
    price: 220, disc: 179, photo: P.turmeric,
    tags: ['turmeric', 'haldi', 'powder', 'organic'], hsn: '09102020', gst: 5,
    variants: [{ label: '100g', price: 79 }, { label: '250g', price: 179 }, { label: '500g', price: 329 }, { label: '1kg', price: 599 }],
    featured: true,
  },
  {
    name: 'Guntur Red Chilli Powder',
    short: 'Extra hot | Deep red | Authentic Guntur',
    desc: 'Straight from Guntur market — the hottest chilli belt in India. Coarse-ground for maximum heat and colour. Rich in capsaicin. Authentic South Indian curries demand this.',
    price: 280, disc: 229, photo: P.chilli,
    tags: ['chilli', 'red chilli', 'guntur', 'mirchi'], hsn: '09042219', gst: 5,
    variants: [{ label: '100g', price: 89 }, { label: '250g', price: 199 }, { label: '500g', price: 369 }, { label: '1kg', price: 699 }],
  },
  {
    name: 'Pure Coriander Powder (Dhania)',
    short: 'Stone-milled | Citrusy | No fillers',
    desc: 'Stone-milled from premium Rajasthan coriander. Mild citrusy-earthy aroma. Essential base for all Indian gravies. No artificial colour or preservatives.',
    price: 180, disc: 149, photo: P.coriander,
    tags: ['coriander', 'dhania', 'powder'], hsn: '09092220', gst: 5,
    variants: [{ label: '100g', price: 59 }, { label: '250g', price: 129 }, { label: '500g', price: 239 }, { label: '1kg', price: 449 }],
  },
  {
    name: 'Dry Ginger Powder (Sukku / Saunth)',
    short: 'Warming | Ayurvedic | Immunity tonic',
    desc: 'Sun-dried ginger ground to fine sukku powder. Hotter and more concentrated than fresh ginger. Essential in rasam, chai, kadha, and winter wellness drinks.',
    price: 260, disc: 219, photo: P.ginger,
    tags: ['ginger', 'sukku', 'saunth', 'dry ginger'], hsn: '09101120', gst: 5,
    variants: [{ label: '100g', price: 79 }, { label: '250g', price: 179 }, { label: '500g', price: 329 }],
  },
  {
    name: 'Kashmiri Red Chilli Powder',
    short: 'Brilliant red | Mild heat | Colour-forward',
    desc: 'Premium Kashmiri chilli — famous for deep crimson colour with gentle heat. 3x more colour intensity than regular chilli. The secret behind restaurant-grade tandoori and dal makhani.',
    price: 360, disc: 289, photo: P.chilli,
    tags: ['kashmiri chilli', 'mild', 'colour', 'powder'], hsn: '09042219', gst: 5,
    variants: [{ label: '100g', price: 109 }, { label: '250g', price: 249 }, { label: '500g', price: 459 }],
    featured: true,
  },
  {
    name: 'Tellicherry Black Pepper Powder',
    short: 'Freshly ground | Bold | No filler',
    desc: 'Stone-ground from Tellicherry peppercorns. Intensely aromatic with sharp heat. Far superior to adulterated commercial pepper powder.',
    price: 420, disc: 349, photo: P.pepper,
    tags: ['pepper', 'black pepper', 'powder', 'ground'], hsn: '09041210', gst: 5,
    variants: [{ label: '50g', price: 109 }, { label: '100g', price: 199 }, { label: '250g', price: 449 }],
  },
  {
    name: 'Dry Mango Powder (Amchur)',
    short: 'Tangy | Fruity | Chaat essential',
    desc: 'Sun-dried raw mango ground to fine powder. Adds instant tartness to chaat, dal, and vegetables without moisture. A tablespoon brightens any dish.',
    price: 240, disc: 199, photo: P.spicemix,
    tags: ['amchur', 'mango powder', 'dry mango', 'souring'], hsn: '08131090', gst: 5,
    variants: [{ label: '100g', price: 79 }, { label: '250g', price: 179 }, { label: '500g', price: 329 }],
  },
  {
    name: 'Turmeric Root Whole (Raw Haldi)',
    short: 'Unprocessed | Grind fresh | Maximum potency',
    desc: 'Sun-dried whole turmeric rhizomes. Grind small pieces fresh for maximum curcumin and volatile oils. Also used in ceremonies and Ayurvedic formulations.',
    price: 280, disc: 229, photo: P.turmericRoot,
    tags: ['turmeric root', 'whole', 'raw haldi'], hsn: '09102010', gst: 5,
    variants: [{ label: '100g', price: 89 }, { label: '250g', price: 199 }, { label: '500g', price: 369 }],
  },

  /* ══ WHOLE SPICES ═════════════════════════════════════════ */
  {
    name: 'Tellicherry Black Pepper Whole',
    short: 'Bold & pungent | Malabar coast | Premium grade',
    desc: 'World-renowned Tellicherry peppercorns. Larger, vine-ripened for deeper flavour. Rich in piperine — the bioavailability booster. A chef\'s staple the world over.',
    price: 480, disc: 389, photo: P.pepper,
    tags: ['black pepper', 'tellicherry', 'whole', 'peppercorn'], hsn: '09041110', gst: 5,
    variants: [{ label: '50g', price: 119 }, { label: '100g', price: 219 }, { label: '250g', price: 499 }],
    featured: true,
  },
  {
    name: 'Green Cardamom Pods (Elaichi)',
    short: 'Plump pods | Kerala Idukki | Intense aroma',
    desc: 'Hand-picked green cardamom from Idukki, Kerala. Bold 7mm+ pods preserving essential oils. Fragrant, sweet, aromatic. Used in chai, biryani, sweets, and desserts.',
    price: 980, disc: 799, photo: P.cardamom,
    tags: ['cardamom', 'elaichi', 'green cardamom', 'pods'], hsn: '09083110', gst: 5,
    variants: [{ label: '25g', price: 149 }, { label: '50g', price: 279 }, { label: '100g', price: 529 }],
    featured: true,
  },
  {
    name: 'Black Cardamom Pods (Badi Elaichi)',
    short: 'Smoky | Camphor-like | Biryani essential',
    desc: 'Kiln-dried black cardamom with distinctive smoky, camphor aroma. Adds bold depth to biryanis and meat curries that green cardamom cannot. 2-3 pods enough for a full biryani.',
    price: 480, disc: 389, photo: P.cardamom,
    tags: ['black cardamom', 'badi elaichi', 'smoky', 'biryani'], hsn: '09083210', gst: 5,
    variants: [{ label: '25g', price: 99 }, { label: '50g', price: 189 }, { label: '100g', price: 359 }],
  },
  {
    name: 'Ceylon Cinnamon Sticks (Dalchini)',
    short: 'True cinnamon | Thin quills | Sweet & floral',
    desc: 'Authentic Ceylon "true cinnamon" — softer, sweeter, and lower in coumarin than cassia. Thin papery quills with floral aroma. Used in biryani, desserts, and spiced drinks.',
    price: 450, disc: 369, photo: P.cinnamon,
    tags: ['cinnamon', 'dalchini', 'ceylon', 'sticks'], hsn: '09061100', gst: 5,
    variants: [{ label: '50g', price: 129 }, { label: '100g', price: 239 }, { label: '250g', price: 549 }],
    featured: true,
  },
  {
    name: 'Premium Cloves Whole (Lavang)',
    short: 'Oil-rich | Aromatic | Zanzibar grade',
    desc: 'High eugenol cloves traded through Kerala spice markets. Intense numbing aroma and natural analgesic properties. Essential in garam masala, biryani, and Ayurveda.',
    price: 560, disc: 449, photo: P.cloves,
    tags: ['cloves', 'lavang', 'whole', 'aromatic'], hsn: '09071010', gst: 5,
    variants: [{ label: '25g', price: 89 }, { label: '50g', price: 169 }, { label: '100g', price: 319 }],
  },
  {
    name: 'Star Anise Whole (Chakra Phool)',
    short: 'Intense anise | Biryani | 8-pointed star',
    desc: 'Beautiful 8-pointed star anise with intense licorice-anise aroma. Non-negotiable in biryani masala and five-spice. One star flavours an entire pot of rice.',
    price: 380, disc: 299, photo: P.staranise,
    tags: ['star anise', 'chakra phool', 'whole', 'biryani'], hsn: '09096110', gst: 5,
    variants: [{ label: '50g', price: 99 }, { label: '100g', price: 189 }, { label: '250g', price: 429 }],
  },
  {
    name: 'Nutmeg Whole (Jaiphal)',
    short: 'Warm & woody | Kerala origin | Grate fresh',
    desc: 'Whole nutmeg from Kerala spice gardens. Warm woody, slightly sweet. Freshly grated nutmeg is infinitely superior to ground. Essential in garam masala, Mughal gravies, and sweets.',
    price: 520, disc: 419, photo: P.nutmeg,
    tags: ['nutmeg', 'jaiphal', 'whole'], hsn: '09081110', gst: 5,
    variants: [{ label: '25g', price: 89 }, { label: '50g', price: 169 }, { label: '100g', price: 319 }],
  },
  {
    name: 'Mace Whole (Javitri)',
    short: 'Delicate & floral | Premium | Mughlai essential',
    desc: 'Golden lacy mace — outer covering of nutmeg. More delicate and floral than nutmeg. Used in Mughlai biryani, korma, and sweets. Higher yield restriction makes it more precious than nutmeg.',
    price: 720, disc: 579, photo: P.nutmeg,
    tags: ['mace', 'javitri', 'whole', 'aromatic'], hsn: '09081210', gst: 5,
    variants: [{ label: '10g', price: 79 }, { label: '25g', price: 179 }, { label: '50g', price: 339 }],
  },
  {
    name: 'Dried Red Chilli Whole (Byadagi)',
    short: 'Deep colour | Mild heat | Karnataka origin',
    desc: 'Byadagi chilli — famous for brilliant red colour with mild heat. Used by chefs for colour-forward dishes: dal makhani, Chettinad curry. Deep, wrinkled, intensely aromatic.',
    price: 340, disc: 269, photo: P.chilliWhole,
    tags: ['red chilli', 'byadagi', 'whole', 'dried'], hsn: '09042110', gst: 5,
    variants: [{ label: '100g', price: 99 }, { label: '250g', price: 229 }, { label: '500g', price: 419 }],
  },
  {
    name: 'Kolambu Milagai — Kuzhambu Chilli',
    short: 'Tamil staple | Round | Tangy-fruity',
    desc: 'Traditional round dried chilli used exclusively in Tamil kuzhambu gravies. Milder with a tangy-fruity note. Gives signature flavour to Vatha Kuzhambu, Puli Kuzhambu, and Vathal.',
    price: 280, disc: 229, photo: P.chilliWhole,
    tags: ['kolambu milagai', 'kuzhambu', 'whole', 'tamil'], hsn: '09042110', gst: 5,
    variants: [{ label: '100g', price: 89 }, { label: '250g', price: 199 }, { label: '500g', price: 369 }],
  },
  {
    name: 'Bay Leaves Whole (Tej Patta / Brinji Ilai)',
    short: 'Fragrant | Cinnamon-clove note | Dried',
    desc: 'Indian bay leaves (Cinnamomum tamala) — more fragrant than Mediterranean variety. Mild cinnamon-clove note in biryanis, pulao, and slow curries. Dried whole to preserve oils.',
    price: 160, disc: 129, photo: P.herbs,
    tags: ['bay leaves', 'tej patta', 'brinji ilai', 'biryani'], hsn: '09109120', gst: 5,
    variants: [{ label: '25g', price: 49 }, { label: '50g', price: 89 }, { label: '100g', price: 169 }],
  },

  /* ══ SEEDS ════════════════════════════════════════════════ */
  {
    name: 'Premium Cumin Seeds (Jeera)',
    short: 'Unjha grade | Plump | Intense aroma',
    desc: 'Unjha-grade cumin from Gujarat — the gold standard for Indian jeera. Fat, plump seeds with intense aroma. Perfect for tadka, biryani, and jeera rice.',
    price: 320, disc: 259, photo: P.cumin,
    tags: ['cumin', 'jeera', 'seeds', 'whole'], hsn: '09093110', gst: 5,
    variants: [{ label: '100g', price: 99 }, { label: '250g', price: 229 }, { label: '500g', price: 429 }],
    featured: true,
  },
  {
    name: 'Black Mustard Seeds (Rai / Kadugu)',
    short: 'South Indian tadka base | Sharp flavour',
    desc: 'Pungent black mustard — the base of every South Indian tadka. Smaller and more flavourful than yellow mustard. Crack in hot oil for sambar, rasam, pickles, and chutneys.',
    price: 140, disc: 119, photo: P.mustard,
    tags: ['mustard', 'rai', 'kadugu', 'seeds', 'tadka'], hsn: '12074010', gst: 5,
    variants: [{ label: '100g', price: 49 }, { label: '250g', price: 109 }, { label: '500g', price: 199 }, { label: '1kg', price: 369 }],
  },
  {
    name: 'Fennel Seeds (Saunf / Perum Jeeragam)',
    short: 'Sweet & anise | Digestive | Post-meal mukhwas',
    desc: 'Plump, bright green fennel seeds with sweet anise flavour. Used in biryanis, fish curries, and as a mouth freshener. Rich in anethole — a natural antacid.',
    price: 220, disc: 179, photo: P.fennel,
    tags: ['fennel', 'saunf', 'perum jeeragam', 'digestive'], hsn: '09092910', gst: 5,
    variants: [{ label: '100g', price: 69 }, { label: '250g', price: 159 }, { label: '500g', price: 289 }],
  },
  {
    name: 'Fenugreek Seeds (Methi Dana / Vendhayam)',
    short: 'Bitter-sweet | Blood sugar | South Indian staple',
    desc: 'Yellow fenugreek seeds with bitter-sweet flavour. Used in sambar, pickles, dosa batter. Rich in soluble fibre. Helps manage blood sugar. Soak overnight to reduce bitterness.',
    price: 160, disc: 129, photo: P.fenugreek,
    tags: ['fenugreek', 'methi', 'vendhayam', 'health'], hsn: '09109190', gst: 5,
    variants: [{ label: '100g', price: 49 }, { label: '250g', price: 109 }, { label: '500g', price: 199 }],
  },
  {
    name: 'Carom Seeds (Ajwain / Omam)',
    short: 'Digestive | Thymol-rich | Sharp flavour',
    desc: 'Pungent carom seeds called Omam in Tamil Nadu. Chewed raw for stomach relief, used in dal, parathas, and achaar. Powerful antimicrobial and anti-bloating properties.',
    price: 180, disc: 149, photo: P.seeds,
    tags: ['ajwain', 'carom', 'omam', 'digestive'], hsn: '09093290', gst: 5,
    variants: [{ label: '100g', price: 59 }, { label: '250g', price: 129 }, { label: '500g', price: 239 }],
  },
  {
    name: 'White Sesame Seeds (Til / Ellu)',
    short: 'Nutty | Calcium-rich | Versatile',
    desc: 'Hulled white sesame seeds with mild nutty flavour. Rich in calcium, iron, and healthy fats. Used in laddoos, chikkis, tahini, and as garnish on rotis.',
    price: 200, disc: 169, photo: P.sesame,
    tags: ['sesame', 'til', 'ellu', 'white sesame'], hsn: '12074090', gst: 5,
    variants: [{ label: '100g', price: 65 }, { label: '250g', price: 149 }, { label: '500g', price: 279 }],
  },
  {
    name: 'Black Sesame Seeds (Kala Til / Karuppu Ellu)',
    short: 'Earthy | Antioxidant-rich | Unhulled',
    desc: 'Unhulled black sesame with stronger, earthier flavour. Higher antioxidants and calcium than white. Used in Korean and Japanese cuisine, South Indian til laddoos, and chutney powders.',
    price: 240, disc: 199, photo: P.sesame,
    tags: ['black sesame', 'kala til', 'karuppu ellu'], hsn: '12074090', gst: 5,
    variants: [{ label: '100g', price: 79 }, { label: '250g', price: 179 }, { label: '500g', price: 329 }],
  },
  {
    name: 'Whole Coriander Seeds (Dhania)',
    short: 'Citrusy & nutty | Dry roast fresh',
    desc: 'Dry roast and grind fresh for 3x the flavour of pre-ground. Large citrusy-nutty seeds. Use whole in pickling and biryani, or coarse-crack for rubs and marinades.',
    price: 180, disc: 149, photo: P.coriander,
    tags: ['coriander seeds', 'whole', 'dhania'], hsn: '09092110', gst: 5,
    variants: [{ label: '100g', price: 55 }, { label: '250g', price: 119 }, { label: '500g', price: 219 }, { label: '1kg', price: 399 }],
  },
  {
    name: 'Poppy Seeds White (Khus Khus / Kasa Kasa)',
    short: 'Creamy thickener | Korma essential | Soaked & ground',
    desc: 'White poppy seeds — secret thickener in Mughlai kormas. Soak 30 min, grind to paste for silky gravy without cream. Also used in laddoos and Bengali cooking.',
    price: 480, disc: 389, photo: P.sesame,
    tags: ['poppy seeds', 'khus khus', 'kasa kasa', 'thickener'], hsn: '12029010', gst: 5,
    variants: [{ label: '50g', price: 129 }, { label: '100g', price: 249 }, { label: '250g', price: 559 }],
  },
  {
    name: 'Flaxseeds (Alsi / Ali Virai)',
    short: 'Omega-3 rich | Heart health | Daily superfood',
    desc: 'Premium whole flaxseeds rich in omega-3, lignans, and fibre. Add to smoothies, yogurt, or rotis. Slightly nutty — roast and grind for maximum absorption.',
    price: 180, disc: 149, photo: P.seeds,
    tags: ['flaxseeds', 'alsi', 'omega3', 'health'], hsn: '12040010', gst: 5,
    variants: [{ label: '200g', price: 69 }, { label: '500g', price: 149 }, { label: '1kg', price: 279 }],
  },

  /* ══ MASALA BLENDS ════════════════════════════════════════ */
  {
    name: 'Traditional Garam Masala Blend',
    short: 'Hand-ground | 11-spice | No fillers',
    desc: 'A traditional 11-spice garam masala — pepper, cloves, cardamom, cinnamon, bay leaf, mace, nutmeg, star anise, coriander, cumin, and black cardamom. Stone-ground to order. The real thing.',
    price: 420, disc: 349, photo: P.masala,
    tags: ['garam masala', 'blend', 'masala', 'spice mix'], hsn: '09109910', gst: 5,
    variants: [{ label: '50g', price: 119 }, { label: '100g', price: 219 }, { label: '250g', price: 499 }],
    featured: true,
  },
  {
    name: 'Authentic Sambar Powder',
    short: 'Tamil Nadu recipe | Stone-ground | No preservatives',
    desc: 'Generations-old Tamil Nadu recipe — roasted chana dal, coriander, cumin, pepper, red chilli, curry leaves, turmeric. Stone-ground in small batches. Transforms ordinary sambar into extraordinary.',
    price: 280, disc: 229, photo: P.sambar,
    tags: ['sambar powder', 'masala', 'south indian', 'tamil'], hsn: '09109910', gst: 5,
    variants: [{ label: '100g', price: 89 }, { label: '200g', price: 169 }, { label: '500g', price: 389 }],
    featured: true,
  },
  {
    name: 'Chennai-Style Rasam Powder',
    short: 'Peppery | Medicinal | Immunity rasam',
    desc: 'High-pepper rasam powder for immunity-boosting medicinal rasam. Toor dal, black pepper, cumin, coriander, red chilli. Classic Brahmin Chennai recipe. One teaspoon in tamarind water = soul-soothing rasam.',
    price: 260, disc: 209, photo: P.sambar,
    tags: ['rasam', 'rasam powder', 'pepper', 'immunity'], hsn: '09109910', gst: 5,
    variants: [{ label: '100g', price: 79 }, { label: '200g', price: 149 }, { label: '500g', price: 349 }],
  },
  {
    name: 'Premium Biryani Masala',
    short: 'Restaurant-grade | 14-spice | No artificial colour',
    desc: 'Complex 14-spice biryani masala — green and black cardamom, star anise, mace, nutmeg, cinnamon, cloves, bay leaf, fennel, pepper, rose petals, kalpasi, marathi mokku. Elevates any biryani.',
    price: 380, disc: 299, photo: P.masala,
    tags: ['biryani masala', 'biryani', 'masala', 'aromatic'], hsn: '09109910', gst: 5,
    variants: [{ label: '50g', price: 99 }, { label: '100g', price: 189 }, { label: '250g', price: 429 }],
    featured: true,
  },
  {
    name: 'Chettinad Masala Powder',
    short: 'Authentic Chettinad | Bold & complex',
    desc: 'The legendary Chettinad masala — kalpasi, marathi mokku, star anise, and dried spices that define Chettinad cuisine. Gives that intense dark flavour to Chettinad chicken and mutton curries.',
    price: 440, disc: 359, photo: P.masala,
    tags: ['chettinad', 'masala', 'south indian', 'bold'], hsn: '09109910', gst: 5,
    variants: [{ label: '50g', price: 119 }, { label: '100g', price: 229 }, { label: '250g', price: 499 }],
    featured: true,
  },
  {
    name: 'Fish Masala Powder',
    short: 'Coastal recipe | For fry & curry',
    desc: 'Classic Tamil Nadu fish masala — red chilli, coriander, fennel, cumin, pepper, turmeric, dried mango. Works on seer fish, pomfret, and prawns. No artificial colour.',
    price: 300, disc: 249, photo: P.masala,
    tags: ['fish masala', 'seafood', 'masala', 'south indian'], hsn: '09109910', gst: 5,
    variants: [{ label: '100g', price: 89 }, { label: '200g', price: 169 }, { label: '500g', price: 389 }],
  },
  {
    name: 'Meat Masala (Kari Masala)',
    short: 'Bold & warming | Mutton & lamb',
    desc: 'Bold South Indian kari masala — roasted whole spices, stone-ground with dried coconut and red chilli. Intense warming depth to mutton and lamb curries. No MSG. Authentic family recipe.',
    price: 360, disc: 289, photo: P.masala,
    tags: ['meat masala', 'kari masala', 'mutton'], hsn: '09109910', gst: 5,
    variants: [{ label: '100g', price: 109 }, { label: '200g', price: 199 }, { label: '500g', price: 459 }],
  },
  {
    name: 'Vatha Kuzhambu Masala',
    short: 'Tangy & spicy | Ready-to-use | Traditional',
    desc: 'Ready-to-use Vatha Kuzhambu masala — the quintessential Tamil comfort curry. Fry in sesame oil, add tamarind water, done in 10 minutes. Authentic village recipe preserved.',
    price: 240, disc: 199, photo: P.sambar,
    tags: ['vatha kuzhambu', 'masala', 'kuzhambu', 'tamil'], hsn: '09109910', gst: 5,
    variants: [{ label: '100g', price: 79 }, { label: '200g', price: 149 }, { label: '500g', price: 349 }],
  },
  {
    name: 'Madras Curry Powder',
    short: 'Authentic Madras blend | Medium hot',
    desc: 'The classic Madras curry powder — coriander, cumin, turmeric, red chilli, pepper, fennel, curry leaves. Medium hot, intensely aromatic. The original "curry powder" — the real deal.',
    price: 260, disc: 209, photo: P.masala,
    tags: ['curry powder', 'madras', 'blend', 'south indian'], hsn: '09109910', gst: 5,
    variants: [{ label: '100g', price: 79 }, { label: '250g', price: 179 }, { label: '500g', price: 329 }],
  },
  {
    name: 'Chaat Masala Premium',
    short: 'Tangy & pungent | Street food magic',
    desc: 'Restaurant-grade chaat masala — amchur, black salt, cumin, coriander, ginger, chilli, asafoetida in perfect ratio. One pinch transforms any fruit, snack, or salad.',
    price: 220, disc: 179, photo: P.masala,
    tags: ['chaat masala', 'tangy', 'street food', 'blend'], hsn: '09109910', gst: 5,
    variants: [{ label: '50g', price: 69 }, { label: '100g', price: 129 }, { label: '250g', price: 289 }],
  },
  {
    name: 'Mixed Whole Spices (Khada Masala)',
    short: '8-spice blend | Ready tadka | No prep time',
    desc: '8 whole spices curated for instant tadka or pilaf — bay leaf, cinnamon, cloves, green cardamom, black cardamom, star anise, black pepper, mace. Drop in hot oil and cook. Zero compromise.',
    price: 380, disc: 299, photo: P.spicemix,
    tags: ['whole spices', 'khada masala', 'tadka', 'blend'], hsn: '09109910', gst: 5,
    variants: [{ label: '50g', price: 99 }, { label: '100g', price: 189 }, { label: '200g', price: 349 }],
  },
  {
    name: 'Pepper & Cumin Rasam Powder',
    short: 'Medicinal | Immunity | Fever remedy',
    desc: 'High pepper-cumin rasam powder for the therapeutic immunity rasam prescribed during fever. Grandmother\'s recipe. One teaspoon in boiling water with ghee = the original throat remedy.',
    price: 280, disc: 229, photo: P.pepper,
    tags: ['rasam', 'pepper rasam', 'immunity', 'medicinal'], hsn: '09109910', gst: 5,
    variants: [{ label: '100g', price: 89 }, { label: '200g', price: 169 }, { label: '500g', price: 389 }],
  },

  /* ══ TAMIL SPECIALTY SPICES ═══════════════════════════════ */
  {
    name: 'Kalpasi (Stone Flower / Dagad Phool)',
    short: 'Chettinad secret spice | Earthy & mossy | Rare',
    desc: 'The mysterious stone flower lichen — secret ingredient of Chettinad biryani. Earthy, mossy, slightly bitter depth found in no other spice. Hard to find outside specialty spice shops.',
    price: 560, disc: 449, photo: P.herbs,
    tags: ['kalpasi', 'stone flower', 'dagad phool', 'chettinad'], hsn: '12119091', gst: 5,
    variants: [{ label: '25g', price: 129 }, { label: '50g', price: 239 }, { label: '100g', price: 449 }],
    featured: true,
  },
  {
    name: 'Marathi Mokku (Dried Flower Pods)',
    short: 'Chettinad essential | Floral & woody',
    desc: 'Dried flower pods of Randia uliginosa — alongside kalpasi in authentic Chettinad recipes. Subtle floral-woody note that cannot be replaced by any other spice.',
    price: 440, disc: 359, photo: P.herbs,
    tags: ['marathi mokku', 'dried flower', 'chettinad'], hsn: '12119091', gst: 5,
    variants: [{ label: '25g', price: 99 }, { label: '50g', price: 189 }, { label: '100g', price: 359 }],
  },
  {
    name: 'Puliyodharai Mix (Tamarind Rice)',
    short: 'Temple-style | Ready-to-mix | Authentic',
    desc: 'Authentic temple-style puliyodharai mix — tamarind paste with mustard, curry leaves, peanuts, and spices. Mix with rice. Perfect travel food and festival prasadam. Kapaleeswarar temple flavour.',
    price: 240, disc: 199, photo: P.tamarind,
    tags: ['puliyodharai', 'tamarind rice', 'temple', 'mix'], hsn: '09109910', gst: 5,
    variants: [{ label: '100g', price: 79 }, { label: '200g', price: 149 }, { label: '400g', price: 279 }],
    featured: true,
  },
  {
    name: 'Premium Tamarind Block (Imli / Puli)',
    short: 'Seedless | Thick pulp | Tamil Nadu origin',
    desc: 'Thick, seedless tamarind pulp from Tamil Nadu orchards. Dark, sticky, intensely sour with natural sweetness. The soul of sambar, rasam, and kuzhambu. Far superior to readymade paste.',
    price: 180, disc: 149, photo: P.tamarind,
    tags: ['tamarind', 'imli', 'puli', 'souring agent'], hsn: '08131010', gst: 5,
    variants: [{ label: '200g', price: 79 }, { label: '500g', price: 169 }, { label: '1kg', price: 299 }],
  },

  /* ══ AROMATIC & PREMIUM ═══════════════════════════════════ */
  {
    name: 'Pure Kashmir Saffron (Kesar)',
    short: 'Grade A1 | 100% pure threads | Lab-tested',
    desc: 'Hand-picked Kashmiri Mongra saffron — world\'s finest. Deep red threads, strong floral aroma with honey sweetness. 1g colours a full pot of biryani. ISO certified, purity guaranteed.',
    price: 1200, disc: 999, photo: P.saffron,
    tags: ['saffron', 'kesar', 'kashmiri', 'premium'], hsn: '09102090', gst: 5,
    variants: [{ label: '0.5g', price: 399 }, { label: '1g', price: 749 }, { label: '2g', price: 1399 }],
    featured: true,
  },
  {
    name: 'Vanilla Pods Grade A (Bourbon)',
    short: 'Moist & plump | Madagascar | Baking premium',
    desc: 'Grade A Bourbon vanilla pods from Madagascar. Moist, plump, intensely fragrant. Split and scrape for ice creams, custards, cakes, and kheer. One pod flavours an entire litre of milk.',
    price: 980, disc: 799, photo: P.vanilla,
    tags: ['vanilla', 'vanilla pods', 'baking', 'premium'], hsn: '09051000', gst: 5,
    variants: [{ label: '2 pods', price: 299 }, { label: '5 pods', price: 699 }, { label: '10 pods', price: 1299 }],
    featured: true,
  },
  {
    name: 'Asafoetida Powder (Hing / Perungayam)',
    short: 'Digestive | Jain-friendly | Pure compound',
    desc: 'Pure asafoetida — the magical flavour enhancer. A pinch transforms any dal. Excellent onion-garlic substitute in Jain cooking. Powerful digestive and anti-bloating properties.',
    price: 280, disc: 229, photo: P.spicemix,
    tags: ['hing', 'asafoetida', 'perungayam', 'digestive'], hsn: '13019040', gst: 5,
    variants: [{ label: '25g', price: 79 }, { label: '50g', price: 149 }, { label: '100g', price: 279 }],
  },
  {
    name: 'Dried Rose Petals (Gulab Patti)',
    short: 'Culinary grade | Fragrant | Biryani & desserts',
    desc: 'Fragrant culinary-grade dried rose petals. Used in Hyderabadi biryani, rose milk, sharbat, and Indian desserts. Rich in antioxidants. Beautiful garnish. The real thing — not decorative potpourri.',
    price: 320, disc: 259, photo: P.rosepetals,
    tags: ['rose petals', 'dried', 'culinary', 'biryani'], hsn: '12119091', gst: 5,
    variants: [{ label: '25g', price: 89 }, { label: '50g', price: 169 }, { label: '100g', price: 319 }],
  },
  {
    name: 'Pomegranate Seed Powder (Anardana)',
    short: 'Tangy | Fruity-tart | Chole & chaat',
    desc: 'Sun-dried pomegranate seeds ground to coarse powder. Used in North Indian chole, aloo dishes, and as tenderiser. Complex fruity-tart note different from tamarind. Sprinkle on chaat.',
    price: 320, disc: 259, photo: P.spicemix,
    tags: ['anardana', 'pomegranate', 'souring', 'chole'], hsn: '08109020', gst: 5,
    variants: [{ label: '50g', price: 89 }, { label: '100g', price: 169 }, { label: '250g', price: 389 }],
  },
  {
    name: 'Green Cardamom Powder (Elaichi)',
    short: 'Pure seed powder | No husk | Intense',
    desc: 'Freshly ground from premium Idukki pods — seeds only, no husks. Store-bought cardamom powder is often 50% husk. This is pure maximum-intensity seed powder for chai, payasam, gulab jamun, and kheer.',
    price: 860, disc: 699, photo: P.cardamom,
    tags: ['cardamom powder', 'elaichi powder', 'chai', 'sweets'], hsn: '09083110', gst: 5,
    variants: [{ label: '25g', price: 149 }, { label: '50g', price: 279 }, { label: '100g', price: 529 }],
  },

  /* ══ HEALTH HERBS ════════════════════════════════════════= */
  {
    name: 'Organic Moringa Leaf Powder (Murungai)',
    short: 'Superfood | High protein | Certified organic',
    desc: 'Shade-dried organic moringa from Tamil Nadu farms. 7x more vitamin C than oranges, 4x more calcium than milk. Mild earthy flavour — blend into smoothies, dal, or soups. The miracle tree.',
    price: 380, disc: 299, photo: P.moringa,
    tags: ['moringa', 'murungai', 'superfood', 'organic'], hsn: '12119031', gst: 5,
    variants: [{ label: '100g', price: 99 }, { label: '250g', price: 229 }, { label: '500g', price: 429 }],
    featured: true,
  },
  {
    name: 'Dried Tulsi Leaves (Holy Basil / Thulasi)',
    short: 'Adaptogen | Immunity | Organic',
    desc: 'Sun-dried organic Rama tulsi from Tamil Nadu. Reduces stress, supports immunity, acts as natural antibiotic. Brew with ginger and pepper for the ultimate immunity kadha.',
    price: 220, disc: 179, photo: P.herbs,
    tags: ['tulsi', 'holy basil', 'thulasi', 'immunity'], hsn: '12119091', gst: 5,
    variants: [{ label: '50g', price: 69 }, { label: '100g', price: 129 }, { label: '250g', price: 299 }],
  },
  {
    name: 'Dried Curry Leaves Powder (Kadi Patta)',
    short: 'Intense aroma | Ground fine | Stays potent 12 months',
    desc: 'Fresh curry leaves kiln-dried to preserve volatile oils, then ground fine. 1 tsp = full sprig of fresh leaves. Use in tempering, chutneys, and rice. Airtight-sealed for 12-month shelf life.',
    price: 260, disc: 209, photo: P.herbs,
    tags: ['curry leaves', 'kadi patta', 'powder', 'south indian'], hsn: '12119091', gst: 5,
    variants: [{ label: '50g', price: 79 }, { label: '100g', price: 149 }, { label: '250g', price: 329 }],
  },
  {
    name: 'Dried Mint Leaves (Pudina)',
    short: 'Intense menthol | Biryani & chutney',
    desc: 'Quickly dried mint to lock in intense menthol. Rub between palms before use. For biryani, raita, chutneys, and herbal teas. Gives biryani the signature cool-heat contrast.',
    price: 200, disc: 159, photo: P.herbs,
    tags: ['mint', 'pudina', 'dried herbs', 'biryani'], hsn: '12119091', gst: 5,
    variants: [{ label: '50g', price: 59 }, { label: '100g', price: 109 }, { label: '250g', price: 249 }],
  },
  {
    name: 'Neem Leaves Powder',
    short: 'Detox | Skin & hair | Organic',
    desc: 'Organic neem leaves shade-dried and stone-ground. Used in face packs, hair masks, and Ayurvedic formulations. Excellent for acne, dandruff, and scalp infections. Blood purifier.',
    price: 180, disc: 149, photo: P.moringa,
    tags: ['neem', 'detox', 'ayurvedic', 'powder'], hsn: '12119091', gst: 5,
    variants: [{ label: '100g', price: 59 }, { label: '250g', price: 129 }, { label: '500g', price: 239 }],
  },
  {
    name: 'Smoked Paprika Powder',
    short: 'Oak-smoked | BBQ & grills | Continental',
    desc: 'Oak-smoked sweet paprika — authentic Spanish-style. Rich, smoky, fruity with beautiful red colour. Perfect for marinades, grilled meats, shakshuka, and continental dishes. A gourmet pantry essential.',
    price: 340, disc: 279, photo: P.chilli,
    tags: ['paprika', 'smoked', 'bbq', 'continental'], hsn: '09042219', gst: 5,
    variants: [{ label: '50g', price: 99 }, { label: '100g', price: 189 }, { label: '250g', price: 429 }],
  },
];

// ── Main seed function ───────────────────────────────────────
async function seed() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✅ Connected to MongoDB\n');

  // 1. Find seller by business name
  const seller = await Seller.findOne({
    businessName: { $regex: new RegExp(SELLER_NAME, 'i') },
  }).lean();

  if (!seller) {
    console.error(`❌ Seller "${SELLER_NAME}" not found in database.`);
    console.error('   Check the exact business name in your Seller collection.');
    process.exit(1);
  }
  console.log(`✅ Seller found: ${seller.businessName} (${seller._id})`);

  // 2. Find or create "Spices & Herbs" category
  let cat = await Category.findOne({ name: { $regex: /spices/i } });
  if (!cat) {
    cat = await Category.create({
      name:         'Spices & Herbs',
      icon:         '🌶️',
      description:  'Premium spices, masalas, and aromatic herbs sourced from across India',
      requiresFSSAI: true,
      isActive:     true,
      sortOrder:    1,
    });
    console.log(`✅ Created category: ${cat.name}`);
  } else {
    console.log(`✅ Category: ${cat.name} (${cat._id})`);
  }

  // 3. Remove old products from this seller in this category (clean re-seed)
  const del = await Product.deleteMany({ seller: seller._id, category: cat._id });
  if (del.deletedCount) console.log(`🗑️  Removed ${del.deletedCount} existing products\n`);

  // 4. Insert all 50 products
  let ok = 0, fail = 0;
  for (const p of PRODUCTS) {
    try {
      const stock = rStock();
      await Product.create({
        name:             p.name,
        description:      p.desc,
        shortDescription: p.short,
        price:            p.price,
        discountPrice:    p.disc,
        stock,
        category:         cat._id,
        seller:           seller._id,
        brand:            'Malarveni Naturals',
        tags:             p.tags,
        isFeatured:       p.featured || false,
        isActive:         true,
        approvalStatus:   'approved',
        codAvailable:     true,
        gstRate:          p.gst,       // 5% for all spices
        hsnCode:          p.hsn,
        priceIncludesGst: true,
        weight:           250,
        location: {
          city:    'Chennai',
          state:   'Tamil Nadu',
          pincode: '600001',
        },
        images: [{ url: IMG(p.photo), isDefault: true }],
        variants: (p.variants || []).map(v => ({
          label: v.label,
          price: v.price,
          stock,
          unit: v.label.includes('kg')    ? 'kg'
              : v.label.includes('g')     ? 'g'
              : v.label.includes('ml')    ? 'ml'
              : v.label.includes('L')     ? 'l'
              : 'pieces',
        })),
        ratings: {
          average: parseFloat((3.8 + Math.random() * 1.1).toFixed(1)),
          count:   Math.floor(Math.random() * 80) + 5,
        },
        soldCount: Math.floor(Math.random() * 200) + 10,
      });
      console.log(`  ✅ ${++ok}. ${p.name}  [stock: ${stock}]  HSN: ${p.hsn}  GST: ${p.gst}%`);
    } catch (err) {
      console.error(`  ❌ ${p.name}: ${err.message}`);
      fail++;
    }
  }

  console.log(`\n${'─'.repeat(55)}`);
  console.log(`🎉 Seeding complete — ${ok} added, ${fail} failed`);
  console.log(`   Seller : ${seller.businessName}`);
  console.log(`   Category: ${cat.name}`);
  console.log(`${'─'.repeat(55)}`);
  await mongoose.disconnect();
}

seed().catch(e => { console.error(e); process.exit(1); });
