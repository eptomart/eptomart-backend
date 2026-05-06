// =============================================================================
// PRODUCT CONTENT CONFIGURATIONS
// Curated for Eptomart — Indian Herbs, Spices & Grocery
//
// Each entry contains:
//   patterns       — lowercase substrings that match a product name
//   imageQuery     — precise Unsplash search query (used for API call)
//   altImageQuery  — fallback query if first returns 0 results
//   shortDescription (max 300 chars)
//   description    (max 1950 chars — leave headroom for safety)
//   tags           — SEO + product-relevance tags (array of strings)
//   metaTitle      — SEO page title (max 70 chars)
//   metaDescription — SEO meta description (max 160 chars)
// =============================================================================

const PRODUCT_CONFIGS = [

  // ── TURMERIC ────────────────────────────────────────────────────────────────
  {
    patterns: ['turmeric', 'haldi'],
    imageQuery: 'turmeric powder golden yellow spice bowl',
    altImageQuery: 'turmeric spice ingredient',
    shortDescription: 'Pure golden turmeric powder bursting with curcumin. Adds vibrant colour, earthy warmth, and wellness benefits to every dish.',
    description: `Premium Turmeric Powder (Haldi) — the golden cornerstone of Indian cooking and Ayurvedic wellness.

Sourced from the finest turmeric rhizomes and stone-ground to a smooth, vivid yellow powder, our haldi retains its natural curcumin richness and distinct earthy aroma. Unlike mass-produced variants, this is single-origin, additive-free turmeric at its purest.

Key Features:
• High curcumin content for authentic golden colour and health benefits
• Stone-ground for fine, lump-free texture
• No artificial colour, preservatives, or fillers
• Rich, warm, earthy aroma — a sign of freshness
• Suitable for cooking, skincare, and golden milk (haldi doodh)

Culinary Uses:
Essential in curries, dals, rice, marinades, soups, and pickles. A pinch elevates any dish with colour and depth. Also used in turmeric latte and traditional home remedies.

Storage: Store in an airtight container away from direct sunlight and moisture. Best used within 18 months of packing.

Quality Assurance: Each batch is lab-tested for purity, heavy metals, and curcumin percentage. Packed hygienically under strict quality controls at our Chennai facility.`,
    tags: ['turmeric powder', 'haldi', 'golden spice', 'curcumin', 'anti-inflammatory', 'Indian spice', 'organic turmeric', 'haldi powder', 'curry spice', 'yellow spice', 'cooking spice', 'Ayurveda', 'eptomart', 'herbs and spices', 'pure turmeric'],
    metaTitle: 'Premium Turmeric Powder (Haldi) | Pure & Golden | Eptomart',
    metaDescription: 'Buy pure premium turmeric powder (haldi) online. High curcumin content, vibrant golden colour, no additives. Ideal for curries, dals, and wellness drinks.',
  },

  // ── RED CHILLI POWDER ───────────────────────────────────────────────────────
  {
    patterns: ['red chilli powder', 'red chili powder', 'chilli powder', 'chili powder', 'lal mirch'],
    imageQuery: 'red chili powder spice bowl vibrant',
    altImageQuery: 'red chilli spice powder dark background',
    shortDescription: 'Fiery, deep-red chilli powder with bold heat and smoky undertones. Crafted from premium dried red chillies for authentic Indian cooking.',
    description: `Premium Red Chilli Powder — bold heat, deep colour, and intense flavour in every spoonful.

Our red chilli powder is ground from carefully selected sun-dried Indian chillies known for their vivid red hue and balanced capsaicin content. Whether you prefer a slow-building heat or a bold punch, this chilli powder delivers with consistency in every batch.

Key Features:
• Deep red colour — a marker of high-quality dried chillies
• Balanced heat level — fiery without being overpowering
• No added colour, flavour enhancers, or starch
• Coarse-to-fine grind for even distribution in cooking
• Aroma-locked in food-grade, resealable packaging

Culinary Uses:
Indispensable in curries, sabzis, marinades, chutneys, achaar, tandoori dishes, and rice preparations. A staple for any Indian kitchen.

Storage: Keep sealed in a cool, dry place away from heat and humidity. Refrigerate after opening for extended shelf life.

Quality Assurance: Sourced from certified chilli-growing regions and processed in a clean, hygienic facility. No Sudan dyes or artificial colour — guaranteed.`,
    tags: ['red chilli powder', 'chili powder', 'lal mirch', 'Indian spice', 'hot spice', 'curry powder', 'cooking spice', 'red pepper powder', 'mirchi powder', 'spicy powder', 'natural chilli', 'eptomart', 'herbs and spices'],
    metaTitle: 'Red Chilli Powder | Bold & Fiery | No Artificial Colour | Eptomart',
    metaDescription: 'Shop premium red chilli powder made from sun-dried Indian chillies. Deep red colour, authentic heat, no artificial colours or additives.',
  },

  // ── CORIANDER SEEDS (whole) ──────────────────────────────────────────────────
  {
    patterns: ['coriander seed', 'dhania seed', 'coriander seeds'],
    imageQuery: 'coriander seeds whole dhania Indian spice',
    altImageQuery: 'whole coriander seeds spice bowl',
    shortDescription: 'Whole dried coriander seeds with a warm, citrusy, slightly sweet aroma. Used whole in tadka and pickling, or freshly ground for curries and chutneys.',
    description: `Premium Whole Coriander Seeds (Sabut Dhania) — the foundation of Indian spice work.

Whole coriander seeds are small, round, straw-coloured seeds with a warm, slightly citrusy, and mildly sweet fragrance. Buying whole seeds and grinding fresh delivers a significantly deeper, more aromatic coriander flavour compared to pre-ground powder.

Key Features:
• Round, pale yellow-tan seeds with clean, consistent size
• Warm, citrusy aroma — more complex than pre-ground powder
• Natural source of essential oils that are lost in pre-ground forms
• Excellent for dry-roasting and freshly grinding for maximum flavour
• Used whole in tadka, pickling, and spice blends

Culinary Uses:
Dry-roast and grind fresh for curry bases, chutneys, and spice blends. Used whole in achaar (pickle) and some coastal fish curries. A key component of panch phoron and other spice mixes. Lightly crushed seeds add texture to dry-rubbed meats and kebabs.

Storage: Airtight container, cool and dark. Whole seeds last 18–24 months; grind as needed.

Quality Assurance: Cleaned, sorted for uniform size. No bleaching or chemical treatment.`,
    tags: ['coriander seeds', 'sabut dhania', 'whole coriander', 'dhania', 'Indian spice', 'pickling spice', 'tadka spice', 'spice grinding', 'aromatic seeds', 'eptomart', 'herbs and spices'],
    metaTitle: 'Whole Coriander Seeds (Sabut Dhania) | Fresh-Grind | Eptomart',
    metaDescription: 'Buy premium whole coriander seeds (sabut dhania) for fresh grinding. Citrusy, aromatic, ideal for curry bases, tadka, pickling, and panch phoron.',
  },

  // ── CORIANDER POWDER ────────────────────────────────────────────────────────
  {
    patterns: ['coriander powder', 'dhania powder', 'coriander', 'dhania'],
    imageQuery: 'coriander powder spice ground Indian',
    altImageQuery: 'coriander seeds ground spice bowl',
    shortDescription: 'Freshly ground coriander powder with a light, citrusy fragrance and mild, nutty flavour. A base spice for every Indian kitchen.',
    description: `Premium Coriander Powder (Dhania Powder) — the aromatic backbone of Indian cooking.

Made from whole coriander seeds that are gently roasted and finely ground, our dhania powder offers a warm, slightly citrusy, earthy flavour that forms the foundation of countless Indian recipes. The freshness is immediately evident in its pale tan colour and delicate, floral aroma.

Key Features:
• Made from whole, cleaned coriander seeds — no fillers or blends
• Gentle roasting enhances natural oils and aroma
• Fine, smooth grind for seamless blending into gravies and marinades
• Mild, versatile flavour suitable for everyday and festive cooking
• Free from artificial colour, anti-caking agents, or preservatives

Culinary Uses:
A base ingredient in curries, dals, chutneys, spice blends, biryanis, and dry sabzis. Works well as a rub for meats and vegetables. Pairs beautifully with cumin, turmeric, and chilli.

Storage: Store in an airtight container in a cool, dark place. Best consumed within 12 months for full flavour.

Quality Assurance: Carefully sourced, cleaned, and processed under food-safe conditions. No added starch or artificial enhancers.`,
    tags: ['coriander powder', 'dhania powder', 'dhania', 'ground coriander', 'Indian spice', 'curry base spice', 'cooking spice', 'aromatic spice', 'eptomart', 'herbs and spices', 'pure coriander', 'spice blend'],
    metaTitle: 'Coriander Powder (Dhania) | Pure & Aromatic | Eptomart',
    metaDescription: 'Buy premium coriander powder (dhania) online. Freshly ground from whole seeds, rich aroma, no additives. The essential base spice for Indian cooking.',
  },

  // ── CUMIN SEEDS ─────────────────────────────────────────────────────────────
  {
    patterns: ['cumin seed', 'jeera', 'cumin'],
    imageQuery: 'cumin seeds jeera spice close up',
    altImageQuery: 'cumin seeds brown aromatic Indian spice',
    shortDescription: 'Whole cumin seeds with a warm, smoky aroma and earthy depth. A foundational Indian spice for tempering, curries, and spice blends.',
    description: `Premium Cumin Seeds (Jeera) — the aromatic soul of Indian tempering.

Handpicked from the finest cumin-growing belts of Rajasthan and Gujarat, our whole cumin seeds are characterised by their dark, slender shape and intensely warm, earthy aroma. When hit in hot oil, they release oils that transform a dish from ordinary to extraordinary.

Key Features:
• Long, slender seeds with deep, consistent colour — a mark of quality
• High volatile oil content for strong, authentic aroma
• Cleaned and sorted — no stones, dust, or foreign matter
• Unroasted variety retains full natural oils
• Excellent shelf life when stored correctly

Culinary Uses:
Used whole in tadka (tempering) for dals, soups, and rice. Ground to powder for curry bases, chutneys, raitas, and spice blends like garam masala and jeera powder. Also used in cumin water (jeera pani) as a digestive drink.

Storage: Store in an airtight jar away from moisture and sunlight. Best within 18 months.

Quality Assurance: Sourced from verified farms, cleaned mechanically, and packed in food-grade pouches. No chemical treatment or pesticide residue — tested per FSSAI norms.`,
    tags: ['cumin seeds', 'jeera', 'whole cumin', 'Indian spice', 'tempering spice', 'aromatic seeds', 'cooking spice', 'organic cumin', 'jeera seeds', 'dal tadka spice', 'eptomart', 'herbs and spices'],
    metaTitle: 'Cumin Seeds (Jeera) | Whole & Aromatic | Eptomart',
    metaDescription: 'Buy premium whole cumin seeds (jeera) online. Handpicked for strong aroma and full flavour. Perfect for tempering, curries, and spice blends.',
  },

  // ── MUSTARD SEEDS ───────────────────────────────────────────────────────────
  {
    patterns: ['mustard seed', 'mustard', 'sarson'],
    imageQuery: 'mustard seeds black small spice bowl',
    altImageQuery: 'black mustard seeds Indian tempering spice',
    shortDescription: 'Tiny but powerful black mustard seeds with a sharp, pungent kick. The first pop in the pan signals the start of great South Indian and Bengali cooking.',
    description: `Premium Black Mustard Seeds (Rai / Sarson) — the first spice into the pan, and the most important.

Our mustard seeds are small, round, jet-black seeds harvested from mustard plants grown in nutrient-rich soils. Their characteristic pop in hot oil releases a nutty, slightly pungent fragrance that forms the base of South Indian tadka, pickles, and seafood curries.

Key Features:
• Deep black colour indicating fully ripened, premium mustard
• Pops cleanly in oil — a sign of low moisture and freshness
• Strong, authentic pungency balanced with nuttiness
• Free from husk debris and foreign particles
• Consistent small-round size for even cooking

Culinary Uses:
Essential in South Indian tadka for sambar, rasam, chutneys, and upma. Used in Bengali panch phoron spice mix, pickles (achaar), and mustard-based curries. Also cold-pressed to make pure mustard oil.

Storage: Store in an airtight container away from moisture. Whole seeds stay fresh for up to 24 months.

Quality Assurance: Cleaned, sorted, and packed in moisture-resistant food-grade pouches. Free from artificial glazing or mineral oil coating.`,
    tags: ['mustard seeds', 'black mustard', 'rai', 'sarson', 'Indian spice', 'tempering spice', 'South Indian cooking', 'tadka spice', 'pickle spice', 'achaar masala', 'eptomart', 'herbs and spices'],
    metaTitle: 'Black Mustard Seeds (Rai) | Pure & Pungent | Eptomart',
    metaDescription: 'Shop premium black mustard seeds (rai) for authentic Indian tempering, pickles, and South Indian curries. Clean, pops perfectly in hot oil.',
  },

  // ── FENUGREEK SEEDS ─────────────────────────────────────────────────────────
  {
    patterns: ['fenugreek seed', 'methi dana', 'methi seed', 'fenugreek'],
    imageQuery: 'fenugreek seeds yellow methi spice',
    altImageQuery: 'fenugreek seeds Indian spice small yellow',
    shortDescription: 'Whole fenugreek seeds with a distinctive bitter edge and maple-like aroma. A prized spice and health aid used across Indian, Middle Eastern, and Sri Lankan cuisines.',
    description: `Premium Fenugreek Seeds (Methi Dana) — bittersweet, aromatic, and deeply nourishing.

Fenugreek seeds are small, hard, golden-yellow seeds with a unique bitter-sweet flavour profile and a faintly maple-like aroma when toasted. Used as a culinary spice and a time-honoured Ayurvedic remedy, methi dana is one of the most versatile seeds in the Indian pantry.

Key Features:
• Golden-yellow colour indicating clean, mature seeds
• Characteristic bitterness balanced with a faint sweetness on roasting
• Rich in fibre, iron, and natural compounds supporting digestion
• Cleaned, free from chaff, stones, and broken seeds
• Dual-use: culinary spice and wellness supplement

Culinary Uses:
Used in South Indian tadka, sambar, pickles (especially mango achaar), methi thepla, and spice blends. Soaked seeds used in hair-care and digestive tonics. Lightly roasted and powdered for curry pastes.

Storage: Store in an airtight container in a cool, dry place. Shelf life: 24 months.

Quality Assurance: Sourced from clean, well-maintained farms. No artificial bleaching or chemical treatment. Cleaned and sorted to remove debris before packing.`,
    tags: ['fenugreek seeds', 'methi dana', 'methi seeds', 'Indian spice', 'bitter spice', 'Ayurveda herb', 'digestive spice', 'pickle spice', 'achaar masala', 'eptomart', 'herbs and spices', 'natural fenugreek'],
    metaTitle: 'Fenugreek Seeds (Methi Dana) | Pure & Natural | Eptomart',
    metaDescription: 'Buy premium fenugreek seeds (methi dana) online. Golden-yellow, bitter-sweet, naturally aromatic. Perfect for tadka, pickles, and Ayurvedic wellness.',
  },

  // ── BLACK PEPPER ────────────────────────────────────────────────────────────
  {
    patterns: ['black pepper', 'kali mirch', 'pepper corn', 'peppercorn'],
    imageQuery: 'black pepper corns whole spice dark',
    altImageQuery: 'peppercorns black whole Indian spice',
    shortDescription: 'Bold, aromatic whole black peppercorns from Kerala\'s spice gardens. The king of spices — sharp, pungent, and full of character.',
    description: `Premium Whole Black Peppercorns (Kali Mirch) — the undisputed King of Spices.

Harvested from lush pepper vines in Kerala's Western Ghats — the world's finest black pepper origin — our peppercorns are sun-dried to lock in their sharp heat and complex aroma. Each corn is plump, uniform, and free from shrivelled or damaged berries.

Key Features:
• Sourced from Malabar — India's premier black pepper growing region
• Plump, uniformly sized corns — a mark of careful harvesting
• Intense, sharp pungency with subtle fruity-floral undertones
• Rich in piperine — enhances flavour and nutrient absorption
• Ideal for freshly grinding in pepper mills

Culinary Uses:
Grind fresh over salads, soups, eggs, pasta, and grilled meats. Whole corns used in stock, biryani, pepper chicken, and pickling. A key component of garam masala and spice rubs.

Storage: Keep in an airtight jar or pepper mill, away from moisture and heat. Whole peppercorns retain flavour for 3–4 years; grind as needed.

Quality Assurance: Naturally sun-dried, cleaned by hand-sorting. No chemical preservatives. Tested for piperine content and moisture levels.`,
    tags: ['black pepper', 'kali mirch', 'peppercorns', 'whole pepper', 'king of spices', 'Malabar pepper', 'Kerala spice', 'Indian spice', 'pepper mill', 'cooking spice', 'eptomart', 'herbs and spices'],
    metaTitle: 'Black Peppercorns (Kali Mirch) | Malabar Origin | Eptomart',
    metaDescription: 'Buy premium whole black peppercorns from Kerala\'s Malabar region. Bold pungency, plump corns, no fillers. The finest pepper for your kitchen and mill.',
  },

  // ── GREEN CARDAMOM ───────────────────────────────────────────────────────────
  {
    patterns: ['cardamom', 'elaichi', 'green cardamom', 'elachi'],
    imageQuery: 'green cardamom pods spice aromatic',
    altImageQuery: 'cardamom pods green elaichi Indian spice',
    shortDescription: 'Fragrant green cardamom pods from the spice valleys of Idukki. Intensely sweet and floral — the queen of Indian spices.',
    description: `Premium Green Cardamom (Elaichi) — the sweet, fragrant queen of Indian spices.

Our green cardamom is sourced directly from the mist-covered valleys of Idukki, Kerala — India's finest cardamom origin. Each pod is plump, bright green, and bursting with aromatic seeds that carry an intense, camphor-like sweetness with floral and citrus notes.

Key Features:
• Large, bold green pods with tightly packed aromatic seeds
• Intense, naturally sweet fragrance — no perfume added
• High volatile oil content ensures lasting flavour in cooking and baking
• Clean — no shrivelled, split, or empty pods
• Dual variety: green for sweet dishes, slightly peppery for savoury

Culinary Uses:
Used whole in biryani, chai, and pulao. Seeds extracted for desserts like kheer, gulab jamun, and sweets. Ground elaichi powder used in masala chai, lassi, and garam masala. Also a mouth freshener after meals.

Storage: Keep whole pods in an airtight jar away from light. Grind seeds just before use for maximum fragrance. Whole pods stay fresh for 2 years.

Quality Assurance: Sourced from certified Idukki growers. Air-dried to preserve colour and volatile oils. No artificial greening dyes.`,
    tags: ['green cardamom', 'elaichi', 'cardamom pods', 'Idukki cardamom', 'Indian spice', 'aromatic spice', 'biryani spice', 'chai spice', 'sweet spice', 'queen of spices', 'eptomart', 'herbs and spices'],
    metaTitle: 'Green Cardamom (Elaichi) | Idukki Origin | Eptomart',
    metaDescription: 'Buy premium green cardamom (elaichi) from Kerala\'s Idukki valley. Plump pods, intensely fragrant, no artificial colour. Perfect for chai, biryani, and desserts.',
  },

  // ── CINNAMON ────────────────────────────────────────────────────────────────
  {
    patterns: ['cinnamon', 'dalchini'],
    imageQuery: 'cinnamon sticks dalchini spice bundle',
    altImageQuery: 'cinnamon bark sticks aromatic spice',
    shortDescription: 'Premium cinnamon sticks with sweet, woody warmth. Adds depth to biryanis, desserts, chai, and spice blends.',
    description: `Premium Cinnamon Sticks (Dalchini) — sweet, warm, and irresistibly aromatic.

Our cinnamon sticks are sourced from Ceylon (true cinnamon) and Cassia varieties, carefully selected for their tight-rolled bark, even thickness, and rich brown colour. The warm, sweet fragrance is immediate on opening — a sign of high essential oil content.

Key Features:
• Tightly rolled, uniform sticks — marks of clean, quality bark
• Sweet, warm flavour profile with subtle vanilla and clove notes
• High cinnamaldehyde content for authentic flavour and aroma
• Whole sticks for long infusion; easily ground to powder as needed
• Works in both sweet and savoury preparations

Culinary Uses:
Used whole in biryanis, pulaos, curries, and tea for a slow-releasing warmth. Ground cinnamon used in cakes, cookies, porridge, and desserts. A key ingredient in garam masala, chai masala, and mulled drinks.

Storage: Store in a sealed container away from moisture. Whole sticks retain their aroma for 3–4 years; powder for 6–12 months.

Quality Assurance: Sourced from verified spice-growing regions. Dried naturally and packed fresh. No sulphur treatment or bleaching.`,
    tags: ['cinnamon sticks', 'dalchini', 'cinnamon bark', 'Indian spice', 'biryani spice', 'chai spice', 'sweet spice', 'aromatic spice', 'warm spice', 'cooking spice', 'eptomart', 'herbs and spices'],
    metaTitle: 'Cinnamon Sticks (Dalchini) | Sweet & Aromatic | Eptomart',
    metaDescription: 'Buy premium cinnamon sticks (dalchini) online. Tightly rolled, richly aromatic, ideal for biryani, chai, desserts, and garam masala.',
  },

  // ── CLOVES ──────────────────────────────────────────────────────────────────
  {
    patterns: ['clove', 'laung', 'lavang'],
    imageQuery: 'cloves whole spice dark aromatic',
    altImageQuery: 'clove buds Indian spice whole laung',
    shortDescription: 'Rich, intensely aromatic whole cloves with a powerful, eugenol-rich fragrance. Essential for garam masala, biryani, and authentic Indian cooking.',
    description: `Premium Whole Cloves (Laung / Lavang) — intensely aromatic, powerfully flavoured.

Our whole cloves are hand-harvested from clove trees at the precise moment of peak ripeness — when the flower buds turn deep reddish-brown before opening. This timing ensures maximum eugenol content, the compound responsible for clove's characteristic strong, warming, slightly sweet flavour.

Key Features:
• Deep brown, fully intact buds — heads and stems both present
• Intensely aromatic with a warm, slightly numbing quality
• High eugenol content — nature's own preservative and flavour agent
• No hollow, broken, or dried-out buds
• Versatile in savoury and sweet preparations

Culinary Uses:
Used whole in biryani, pulao, and slow-cooked curries. A key component of garam masala, chai masala, and Kashmiri spice blends. Studded in meats for slow roasts. Used ground in baked goods and festive desserts.

Storage: Keep in an airtight container away from light and moisture. Shelf life: 2–4 years for whole cloves.

Quality Assurance: Sourced from Kerala and Zanzibar clove farms. Naturally dried; no artificial oil coating or moisture treatment.`,
    tags: ['cloves', 'laung', 'lavang', 'whole cloves', 'Indian spice', 'garam masala spice', 'biryani spice', 'aromatic spice', 'eugenol', 'cooking spice', 'eptomart', 'herbs and spices'],
    metaTitle: 'Whole Cloves (Laung) | Intensely Aromatic | Eptomart',
    metaDescription: 'Buy premium whole cloves (laung) online. Hand-harvested at peak ripeness, intensely aromatic, high eugenol content. Perfect for biryani, garam masala, and chai.',
  },

  // ── STAR ANISE ──────────────────────────────────────────────────────────────
  {
    patterns: ['star anise', 'chakra phool', 'star anis', 'chakri phool'],
    imageQuery: 'star anise whole spice close up dark background',
    altImageQuery: 'star anise chakra phool Indian spice',
    shortDescription: 'Beautiful eight-pointed star anise pods with a bold, liquorice-like sweetness. A signature spice in biryani, masala chai, and slow-cooked curries.',
    description: `Premium Star Anise (Chakra Phool) — striking in shape, powerful in flavour.

Star anise is one of the most visually distinctive spices in the world — an eight-pointed star pod housing intensely aromatic seeds. Our chakra phool is sourced from clean-growing farms, with deep brown, fully intact stars and plump seeds that carry a bold, sweet, anise-fennel aroma.

Key Features:
• Complete, unbroken 8-pointed star pods for visual appeal
• Intensely sweet, anise-like flavour with deep floral undertones
• Rich in anethole — the natural compound behind its characteristic aroma
• Free from broken pieces, dust, or discoloured pods
• Versatile in Indian, Chinese, and Vietnamese cuisine

Culinary Uses:
A key whole spice in biryani, pulao, and slow-braised curries. Used in masala chai and spiced tea. Common in Chinese five-spice powder and pho broth. Also used in spiced poaching liquids for meats.

Storage: Whole star anise keeps for 3–4 years in an airtight container away from moisture. Do not powder until needed.

Quality Assurance: Cleaned, sorted for intact pods, packed fresh. No sulphur treatment or artificial flavour enhancement.`,
    tags: ['star anise', 'chakra phool', 'chakri phool', 'whole star anise', 'Indian spice', 'biryani spice', 'chai spice', 'aromatic spice', 'anise flavour', 'cooking spice', 'eptomart', 'herbs and spices'],
    metaTitle: 'Star Anise (Chakra Phool) | Whole & Aromatic | Eptomart',
    metaDescription: 'Buy premium whole star anise (chakra phool) online. Intact 8-pointed pods, intensely anise-sweet, perfect for biryani, chai, and spiced curries.',
  },

  // ── BAY LEAVES ──────────────────────────────────────────────────────────────
  {
    patterns: ['bay leaf', 'bay leave', 'tej patta', 'tejpatta'],
    imageQuery: 'bay leaves dried herb aromatic cooking',
    altImageQuery: 'dried bay leaves tej patta Indian spice',
    shortDescription: 'Whole dried bay leaves with a soft, herbal fragrance. A classic aromatic leaf used in biryanis, curries, soups, and stocks.',
    description: `Premium Dried Bay Leaves (Tej Patta) — subtle, herbal, and indispensable.

Bay leaves are aromatic dried leaves that quietly deepen the flavour of a dish without overpowering other spices. Our tej patta is sourced from Indian bay laurel trees (Cinnamomum tamala), which carry a flavour profile distinct from Mediterranean bay — earthier, with hints of clove and cinnamon.

Key Features:
• Whole, unbroken leaves with natural green-brown hue
• Indian variety (Cinnamomum tamala) — clove-cinnamon undertones
• Gently dried to preserve volatile aromatic oils
• Clean — free from insect damage, mould, or broken fragments
• Mild on entry, complex on slow-cooking

Culinary Uses:
Added whole to biryanis, pulao, dals, soups, curries, and marinades. Removed before serving. Essential in stocks, slow-cooked meats, and spice-infused oils. A component of traditional garam masala recipes.

Storage: Keep whole leaves in a sealed container away from sunlight. Shelf life: 12–18 months. Do not crumble until just before use.

Quality Assurance: Naturally dried without chemicals. Cleaned, sorted, and packed to maintain aroma and colour integrity.`,
    tags: ['bay leaves', 'tej patta', 'dried bay leaves', 'Indian herb', 'biryani spice', 'aromatic herb', 'soup herb', 'cooking leaves', 'curry herb', 'Indian spice', 'eptomart', 'herbs and spices'],
    metaTitle: 'Bay Leaves (Tej Patta) | Dried & Aromatic | Eptomart',
    metaDescription: 'Buy premium dried bay leaves (tej patta) online. Indian variety with clove-cinnamon notes. Whole, clean, and intensely aromatic for biryanis, curries, and soups.',
  },

  // ── CURRY LEAVES ────────────────────────────────────────────────────────────
  {
    patterns: ['curry leaf', 'curry leave', 'kadi patta', 'karuvepilai'],
    imageQuery: 'curry leaves dried herb Indian spice',
    altImageQuery: 'dried curry leaves karuvepilai South Indian herb',
    shortDescription: 'Dried curry leaves with a distinctive South Indian fragrance. Essential for tempering, chutneys, and authentic coastal curries.',
    description: `Premium Dried Curry Leaves (Kadi Patta / Karuvepilai) — the soul of South Indian cooking.

Curry leaves are small, glossy leaves from the Murraya koenigii tree, with a flavour that is at once herbal, slightly citrusy, and unmistakably South Indian. Our dried curry leaves are carefully harvested and air-dried to preserve their essential oils and signature aroma.

Key Features:
• Sourced from mature, well-nurtured curry leaf trees in Tamil Nadu and Karnataka
• Air-dried at low temperature to retain maximum volatile oils
• Deep green to olive-brown colour — indicates proper drying (not bleached)
• No stems, stalks, or foreign matter
• Releases intense aroma when added to hot oil

Culinary Uses:
First in the pan for South Indian tadka — sambar, rasam, coconut chutneys, kuzhambu, and rice dishes. Used in Kerala fish curry, Tamil Nadu kootu, and Karnataka upma. Essential in Chettinad cuisine.

Storage: Keep sealed in a cool, dark place. For extended freshness, refrigerate. Shelf life: 6–9 months for dried leaves.

Quality Assurance: Hand-cleaned to remove stems and damaged leaves. No sulphur treatment or synthetic preservation. Sourced from pesticide-monitored farms.`,
    tags: ['curry leaves', 'kadi patta', 'karuvepilai', 'dried curry leaves', 'South Indian herb', 'tempering herb', 'Indian herb', 'sambar spice', 'rasam spice', 'cooking herb', 'eptomart', 'herbs and spices'],
    metaTitle: 'Dried Curry Leaves (Kadi Patta) | South Indian Herb | Eptomart',
    metaDescription: 'Buy premium dried curry leaves (kadi patta) online. Air-dried, intensely aromatic, essential for South Indian tadka, sambar, rasam, and fish curries.',
  },

  // ── GARAM MASALA ────────────────────────────────────────────────────────────
  {
    patterns: ['garam masala'],
    imageQuery: 'garam masala spice blend powder brown aromatic',
    altImageQuery: 'Indian spice blend garam masala mix',
    shortDescription: 'Aromatic, warming garam masala blend — a harmonious mix of whole spices ground to perfection for curries, biryanis, and marinades.',
    description: `Premium Garam Masala — the aromatic crown jewel of Indian spice blends.

Our garam masala is crafted using a traditional North Indian recipe of over 12 whole spices — each cleaned, gently roasted, and stone-ground together in the right proportion. The result is a warm, complex, deeply aromatic powder that layers beautifully into any dish without a single sharp edge.

Key Features:
• 12+ whole spice blend including pepper, cardamom, cinnamon, cloves, cumin, and coriander
• Stone-ground in small batches for consistency and freshness
• No artificial flavours, preservatives, or fillers
• Warm, complex flavour profile — subtly sweet, mildly spicy
• Versatile finishing spice and marinade ingredient

Culinary Uses:
Added at the end of cooking to curries, biryanis, dals, and soups for a finishing aromatic lift. Used in spice rubs for tandoori, tikka, and grilled meats. Mixed into rice, pilaf, and slow-cooked dishes for depth.

Storage: Keep in an airtight container away from light and moisture. Best used within 6 months for maximum aroma.

Quality Assurance: Each batch is lab-tested for aroma consistency and microbial safety. No starch fillers, added salt, or flow agents.`,
    tags: ['garam masala', 'Indian spice blend', 'masala powder', 'curry spice', 'aromatic spice', 'whole spice blend', 'North Indian spice', 'biryani masala', 'cooking spice', 'warming spice', 'eptomart', 'herbs and spices'],
    metaTitle: 'Garam Masala | 12-Spice Blend | Aromatic & Pure | Eptomart',
    metaDescription: 'Buy premium garam masala made from 12+ whole spices, stone-ground in small batches. No fillers, authentic flavour. Perfect finishing spice for curries and biryanis.',
  },

  // ── BIRYANI MASALA ──────────────────────────────────────────────────────────
  {
    patterns: ['biryani masala', 'biryani spice'],
    imageQuery: 'biryani masala spice powder Indian fragrant',
    altImageQuery: 'biryani spice blend Indian spice mix',
    shortDescription: 'Crafted biryani masala with warm whole spices and herbs — adds the unmistakable aroma and layered flavour of restaurant-style biryani at home.',
    description: `Premium Biryani Masala — restaurant-quality biryani, every time.

Our biryani masala is a meticulously balanced blend of whole spices and herbs developed specifically for the long-cooked, fragrant biryani. It combines bay leaves, star anise, shahi jeera, mace, cardamom, pepper, cinnamon, cloves, coriander, and more into a cohesive blend that layers aroma, colour, and flavour into rice and meat simultaneously.

Key Features:
• Purpose-built for biryani — not a generic masala
• Contains shahi jeera, mace, and rose petals — signature biryani aromatics
• Balanced heat level that complements meat, vegetables, and paneer
• No artificial colour or MSG
• Works for Hyderabadi, Lucknawi, and Chettinad biryani styles

Culinary Uses:
Use whole or ground into marinade with curd, ginger-garlic paste, and oil for biryani. Works equally well in pulao, korma, and layered rice dishes. Use in chicken/mutton marinade for 2 hours before cooking.

Storage: Store in a cool, dark airtight container. Best used within 6 months.

Quality Assurance: Developed using traditional biryani spice ratios. No starch, anticaking agents, or MSG.`,
    tags: ['biryani masala', 'biryani spice', 'Indian spice blend', 'rice spice', 'chicken biryani', 'mutton biryani', 'Hyderabadi biryani', 'cooking masala', 'aromatic blend', 'eptomart', 'herbs and spices'],
    metaTitle: 'Biryani Masala | Authentic Aromatic Blend | Eptomart',
    metaDescription: 'Buy premium biryani masala for restaurant-style biryani at home. Balanced blend of whole spices, no MSG or artificial colour. Ideal for Hyderabadi and Lucknawi style.',
  },

  // ── CHICKEN MASALA ──────────────────────────────────────────────────────────
  {
    patterns: ['chicken masala', 'chicken curry masala'],
    imageQuery: 'chicken masala spice powder blend Indian',
    altImageQuery: 'Indian chicken curry spice mix powder',
    shortDescription: 'Bold, flavourful chicken masala with the perfect balance of heat, warmth, and South Indian spice character. Makes restaurant-style chicken curry at home.',
    description: `Premium Chicken Masala — bold, balanced, and built for flavour.

Our chicken masala is crafted to deliver a rich, deeply aromatic chicken curry in every pot. The blend draws on Southern and Northern Indian flavour traditions — coriander, chilli, cumin, pepper, cardamom, turmeric, and more — creating a layered, satisfying curry base that works as a marinade, stir-fry spice, or slow-cook masala.

Key Features:
• Purpose-formulated for chicken — pairs with the natural umami of poultry
• Bold reddish-brown colour indicating quality chilli and coriander content
• Balanced heat — works for family cooking without excessive spice
• No artificial colour, MSG, or taste enhancers
• Works for dry fry, gravy curry, and tandoori-style preparations

Culinary Uses:
Mix with oil, tomato, onion, and yoghurt for a base gravy. Use as a dry rub for tandoori or tikka. Add to chicken fry, 65-style, or slow-cooked curry. Also works for mixed vegetable and mushroom curries.

Storage: Store in a cool, airtight container. Best within 6 months of opening.

Quality Assurance: FSSAI compliant. No anticaking agents, added salt beyond flavour balance, or artificial flavour boosters.`,
    tags: ['chicken masala', 'chicken curry masala', 'poultry spice', 'Indian spice blend', 'curry masala', 'cooking masala', 'tandoori spice', 'chicken fry masala', 'Indian curry', 'eptomart', 'herbs and spices'],
    metaTitle: 'Chicken Masala | Bold & Balanced | Eptomart',
    metaDescription: 'Buy premium chicken masala for authentic Indian chicken curry. Balanced heat, natural spices, no MSG. Perfect for gravy curry, fry, and tandoori dishes.',
  },

  // ── FISH MASALA ─────────────────────────────────────────────────────────────
  {
    patterns: ['fish masala', 'fish curry masala'],
    imageQuery: 'fish curry masala spice blend Indian seafood',
    altImageQuery: 'Indian fish curry spice powder seafood',
    shortDescription: 'Tangy, coastal fish masala crafted for seafood lovers. Pairs perfectly with any fish — from Rohu to Pomfret — and delivers an authentic South Indian fish curry flavour.',
    description: `Premium Fish Masala — coastal flavour, perfectly spiced for seafood.

Fish masala requires a different spice language — tangier, more fragrant, and perfectly calibrated to complement the delicate, natural flavour of fish without overwhelming it. Our blend uses coastal spice traditions from Tamil Nadu and Kerala, incorporating kokum, tamarind powder, coriander, fennel, and dried red chilli to create a bold-yet-balanced seafood spice.

Key Features:
• Purpose-formulated for fish and seafood — not a generic masala
• Tangy-spicy balance with kokum or tamarind undertones
• Fennel and coriander notes typical of coastal Indian cooking
• Rich red colour that creates a beautiful curry gravy
• No artificial flavour, fishy additives, or MSG

Culinary Uses:
Use in fish curry with coconut milk or tomato base. Works as a marinade for pan-fried or grilled fish. Ideal for Chettinad fish curry, Kerala fish masala, Goan fish curry adaptations, and fish fry.

Storage: Airtight container in a cool, dark place. Best within 6 months.

Quality Assurance: FSSAI compliant. Crafted to coastal spice standards. No artificial seafood flavouring.`,
    tags: ['fish masala', 'fish curry masala', 'seafood spice', 'Indian fish curry', 'coastal spice', 'South Indian spice', 'fish fry masala', 'Kerala fish curry', 'Chettinad spice', 'eptomart', 'herbs and spices'],
    metaTitle: 'Fish Masala | Coastal Spice Blend for Seafood | Eptomart',
    metaDescription: 'Buy premium fish masala for authentic South Indian fish curry, fish fry, and grilled seafood. Tangy, coastal blend with kokum and fennel. No MSG.',
  },

  // ── SAMBAR POWDER ───────────────────────────────────────────────────────────
  {
    patterns: ['sambar powder', 'sambhar powder', 'sambar masala'],
    imageQuery: 'sambar powder South Indian spice mix red brown',
    altImageQuery: 'sambar masala powder Indian spice blend',
    shortDescription: 'Authentic South Indian sambar powder — tangy, aromatic, and deeply spiced. The foundation of every great sambar, rasam, and kuzhambu.',
    description: `Premium Sambar Powder — the heart of South Indian cooking.

Sambar is arguably the most beloved dish in South India, and its soul lives in the sambar powder. Our blend follows a traditional Tamil Nadu-style recipe using channa dal, urad dal, whole red chilli, coriander, cumin, pepper, turmeric, curry leaves, and asafoetida — roasted and ground in the precise ratios that make sambar sing.

Key Features:
• Traditional Tamil Nadu recipe with roasted dal base
• Balanced tangy-spicy-aromatic profile
• Includes roasted curry leaves and hing for authentic flavour
• Deep reddish-brown powder indicating quality chilli and roasted spices
• No artificial colour, MSG, or starch

Culinary Uses:
The primary spice base for sambar (dal-based vegetable stew). Also used in rasam, kuzhambu, mixed vegetable curry, and South Indian-style soups. A pinch in coconut rice or podi takes ordinary dishes to another level.

Storage: Store in an airtight container away from moisture. Best used within 6 months. Refrigerate in humid climates.

Quality Assurance: Roasted and ground in small batches to ensure freshness and flavour authenticity. No food additives beyond spice ingredients.`,
    tags: ['sambar powder', 'sambar masala', 'South Indian spice', 'Tamil Nadu spice', 'sambar mix', 'Indian spice blend', 'rasam spice', 'kuzhambu masala', 'dal spice', 'eptomart', 'herbs and spices'],
    metaTitle: 'Sambar Powder | Authentic South Indian Blend | Eptomart',
    metaDescription: 'Buy premium sambar powder made from roasted whole spices and dal. Traditional Tamil Nadu recipe, no MSG. The soul of authentic South Indian sambar.',
  },

  // ── RASAM POWDER ────────────────────────────────────────────────────────────
  {
    patterns: ['rasam powder', 'rasam masala'],
    imageQuery: 'rasam powder spice mix South Indian',
    altImageQuery: 'Indian spice powder blend rasam tomato soup',
    shortDescription: 'Tangy, peppery rasam powder with a warming, sour-hot profile. Makes silky, comforting rasam that soothes the throat and warms the soul.',
    description: `Premium Rasam Powder — pepper-forward, tangy, and deeply comforting.

Rasam, the thin, tangy South Indian pepper soup, gets its soul from rasam powder — and ours is made for exactly that. Heavy on black pepper and cumin, with coriander, red chilli, toor dal, hing, and curry leaves, this blend creates the sour-spicy broth that defines rasam's unique, comforting identity.

Key Features:
• Pepper-heavy formula for authentic rasam heat
• Balanced sourness from tamarind-forward spice ratio
• Hing and cumin notes for signature rasam flavour
• Fine grind for easy dissolving in thin rasam broth
• No artificial flavour, preservatives, or MSG

Culinary Uses:
Base spice for tomato rasam, pepper rasam, lemon rasam, and mysore rasam. Use with tamarind, tomato, and toor dal stock. Also a good digestive spice — mix with hot water, lemon, and jaggery for a soothing drink.

Storage: Cool, dry, airtight container. Best within 6 months.

Quality Assurance: Ground in small batches. No starch, added salt excess, or artificial flavour.`,
    tags: ['rasam powder', 'rasam masala', 'South Indian spice', 'pepper spice', 'rasam mix', 'Indian soup spice', 'Tamil cooking', 'rasam blend', 'eptomart', 'herbs and spices'],
    metaTitle: 'Rasam Powder | Pepper-Forward South Indian Spice | Eptomart',
    metaDescription: 'Buy premium rasam powder for authentic South Indian rasam. Pepper-heavy, tangy, deeply aromatic. No MSG or artificial flavour. Ideal for tomato and pepper rasam.',
  },

  // ── TAMARIND (also matches puliyodharai / tamarind rice mix) ────────────────
  {
    patterns: ['tamarind', 'puliyodharai', 'imli', 'puli'],
    imageQuery: 'tamarind pods dry Indian sour spice',
    altImageQuery: 'tamarind block Indian cooking ingredient sour',
    shortDescription: 'Sun-dried Indian tamarind — intensely sour, deeply fruity. The essential souring agent in sambar, rasam, puliyodharai, and chutneys.',
    description: `Premium Tamarind (Imli / Puli) — India's premier natural souring agent.

Our tamarind is sourced from mature trees in Tamil Nadu and Andhra Pradesh, where the long tropical growing season produces the tangiest, most flavourful pods. Carefully de-shelled, de-seeded, and sun-dried to the right consistency, this tamarind delivers an intense sour-sweet punch that no synthetic acid can replicate.

Key Features:
• Sourced from mature, thick-pulp tamarind variety
• Deep brown colour with sticky, fibrous pulp — indicates correct ripeness
• Strong tartaric acid content for maximum sourness
• Naturally seedless or minimally seeded; easy to dissolve
• No added preservatives, artificial souring agents, or sugar coating

Culinary Uses:
Core ingredient in sambar, rasam, puliyodharai (tamarind rice), tamarind chutney, paddu/paniyaram, kuzhambu, and Hyderabadi dalcha. Also used in marinades, sweet-sour dipping sauces, and chaat.

Storage: Refrigerate for longer shelf life. Keep sealed in a dry container at room temperature for up to 6 months.

Quality Assurance: De-seeded, cleaned, and packed in food-grade pouches. No sulphur dioxide treatment or bleaching.`,
    tags: ['tamarind', 'imli', 'puli', 'dried tamarind', 'tamarind block', 'sour ingredient', 'sambar spice', 'rasam ingredient', 'tamarind paste', 'Indian souring agent', 'eptomart', 'herbs and spices'],
    metaTitle: 'Premium Tamarind (Imli/Puli) | Sun-Dried & Pure | Eptomart',
    metaDescription: 'Buy premium sun-dried Indian tamarind (imli/puli). Intense sour-sweet flavour, no additives. Essential for sambar, rasam, chutney, and tamarind rice.',
  },

  // ── BLACK SESAME SEEDS ──────────────────────────────────────────────────────
  {
    patterns: ['black sesame', 'black til', 'black gingelly'],
    imageQuery: 'black sesame seeds dark spice bowl',
    altImageQuery: 'black sesame seeds Indian spice',
    shortDescription: 'Nutty, earthy black sesame seeds with a richer, more robust flavour than white sesame. Used in chutneys, Asian cooking, sesame brittle, and traditional Indian sweets.',
    description: `Premium Black Sesame Seeds (Kala Til) — deep flavour, stunning colour, and exceptional nutrition.

Black sesame seeds are the unhulled variety of sesame, retaining their natural outer coat which gives them a stronger, more robust and earthy flavour compared to white sesame. Their striking jet-black colour makes them a visual standout in any dish.

Key Features:
• Unhulled black variety — stronger, nuttier, earthier flavour than white sesame
• Deep black colour with visible sheen indicating freshness
• Higher antioxidant content than white sesame (outer hull retained)
• Rich in calcium, iron, zinc, and healthy fats
• Crunchy texture when toasted — intensifies aroma dramatically

Culinary Uses:
Toasted and sprinkled over rice dishes, noodles, salads, and sushi. Ground into black sesame paste for Asian desserts and smoothies. Used in til ke ladoo, sesame chutney, and chikki. Adds striking contrast when sprinkled over bread, buns, or crackers.

Storage: Refrigerate in an airtight container to prevent rancidity. Best within 6–9 months.

Quality Assurance: Cleaned and sorted for uniform, intact black seeds. No artificial colouring.`,
    tags: ['black sesame seeds', 'kala til', 'black gingelly', 'unhulled sesame', 'Indian spice', 'sesame seeds', 'Asian cooking', 'antioxidant seeds', 'cooking seeds', 'eptomart', 'herbs and spices'],
    metaTitle: 'Black Sesame Seeds (Kala Til) | Rich & Nutty | Eptomart',
    metaDescription: 'Buy premium black sesame seeds (kala til). Unhulled, earthy, rich in antioxidants. Perfect for sesame chutney, Asian dishes, ladoo, and bread toppings.',
  },

  // ── WHITE SESAME SEEDS ──────────────────────────────────────────────────────
  {
    patterns: ['white sesame', 'sesame seed', 'sesame', 'til seed', 'white til', 'til'],
    imageQuery: 'sesame seeds white till spice bowl',
    altImageQuery: 'white sesame seeds til Indian spice',
    shortDescription: 'Pristine white sesame seeds with a delicate, nutty sweetness. Used in chutneys, sweets, ladoos, and as a garnish across Indian and Asian cuisines.',
    description: `Premium White Sesame Seeds (Til / Gingelly) — nutty, mild, and incredibly versatile.

Sesame seeds are among the oldest oil seeds known to humanity, and our white sesame (til) variety is prized for its clean, pale hue, mild nuttiness, and high oil content. Hulled to remove the thin bran layer, these seeds are toasted to release a delicate, warm, nutty aroma that enhances both sweet and savoury dishes.

Key Features:
• Hulled white variety — clean, pure, with mild, sweet nuttiness
• High oil content for smooth, flavour-forward grinding
• Consistent small, oval shape — free from broken or dark seeds
• Easily toasted in a dry pan to intensify flavour
• High in calcium, iron, and plant-based protein

Culinary Uses:
Toasted and used in til chutney, sesame ladoo, til gajak, and rajgira laddoo. Sprinkled over bread, salads, and sushi. Ground into til paste (tahini-style) for chutneys and dips. Used in Makar Sankranti sweets and Asian stir-fries.

Storage: Cool, dry, airtight container. Refrigerate to extend freshness. Best within 12 months.

Quality Assurance: Mechanically hulled and cleaned. No artificial whitening agents.`,
    tags: ['sesame seeds', 'white til', 'gingelly seeds', 'til seeds', 'Indian spice', 'sweet spice', 'till ladoo', 'sesame oil seeds', 'cooking seeds', 'nutty seeds', 'eptomart', 'herbs and spices'],
    metaTitle: 'White Sesame Seeds (Til) | Pure & Nutty | Eptomart',
    metaDescription: 'Buy premium white sesame seeds (til/gingelly) online. Hulled, clean, rich in calcium. Perfect for sesame ladoo, chutney, stir-fries, and bread toppings.',
  },

  // ── FENNEL SEEDS ────────────────────────────────────────────────────────────
  {
    patterns: ['fennel seed', 'saunf', 'fennel'],
    imageQuery: 'fennel seeds saunf green spice aromatic',
    altImageQuery: 'fennel seeds green anise Indian spice',
    shortDescription: 'Sweet, refreshing fennel seeds with a mild liquorice note. A beloved mouth freshener, digestive aid, and aromatic spice for curries and sweets.',
    description: `Premium Fennel Seeds (Saunf) — sweet, refreshing, and naturally cooling.

Fennel seeds are slender, pale green seeds with a sweet, anise-like flavour profile that makes them uniquely appealing both as a cooking spice and a post-meal mouth freshener. Our saunf is sourced from Rajasthan, where the driest growing conditions produce the most flavourful, high-anethole seeds.

Key Features:
• Plump, pale-green seeds with strong, sweet-anise aroma
• High anethole (volatile oil) content for lasting freshness and flavour
• Naturally cooling — a traditional digestive and breath freshener
• Uniform seed size, free from immature or shrivelled pieces
• Suitable for cooking, mouth-freshening, and herbal infusions

Culinary Uses:
Used in biryani, fish curry (coastal style), and panch phoron (Bengali spice mix). Ground fennel is used in North Indian gravy masalas. Whole seeds are chewed after meals as a digestive. Used in fennel tea, sweet fennel mukhwas, and dessert flavouring.

Storage: Cool, airtight container away from direct light. Shelf life: 18 months.

Quality Assurance: Cleaned, sorted, and packed from premium Rajasthan harvest. No bleaching or artificial greening.`,
    tags: ['fennel seeds', 'saunf', 'sweet fennel', 'mouth freshener', 'digestive spice', 'Indian spice', 'biryani spice', 'aromatic seeds', 'green fennel', 'coastal spice', 'eptomart', 'herbs and spices'],
    metaTitle: 'Fennel Seeds (Saunf) | Sweet & Aromatic | Eptomart',
    metaDescription: 'Buy premium fennel seeds (saunf) from Rajasthan. Sweet, refreshing, high anethole content. Perfect for biryani, coastal curries, mouth freshening, and fennel tea.',
  },

  // ── AJWAIN ──────────────────────────────────────────────────────────────────
  {
    patterns: ['ajwain', 'carom seed', 'omam', 'bishop weed'],
    imageQuery: 'ajwain carom seeds small spice Indian',
    altImageQuery: 'carom seeds ajwain small grey Indian spice',
    shortDescription: 'Pungent, thyme-flavoured ajwain seeds with medicinal strength. A powerhouse digestive spice for flatbreads, pakodas, and Ayurvedic home remedies.',
    description: `Premium Ajwain (Carom Seeds / Omam) — medicinal, aromatic, and unmistakably bold.

Ajwain seeds look like small, striped cumin but pack an entirely different punch — intensely pungent, herbaceous, and similar to thyme due to their high thymol content. Used in Indian cooking for centuries both as a spice and a digestive remedy, ajwain is one of the most therapeutically potent seeds in the pantry.

Key Features:
• High thymol content — the compound behind its sharp, thyme-like flavour
• Strongly pungent with a warming, slightly bitter finish
• Small, elongated seeds with natural grey-green stripes
• Powerfully aromatic — a little goes a long way
• Dual-use: culinary spice and natural digestive

Culinary Uses:
Added to flatbreads (paratha, thepla, puri), pakodas, and crispy fried snacks for a digestive kick. Used in pickling, achaar, and some regional curry tadkas. Boiled in water as a traditional Ayurvedic digestive drink. Used in Ajwain pani for acidity relief.

Storage: Airtight container in a cool, dark place. Shelf life: 18–24 months.

Quality Assurance: Cleaned and sorted. No artificial colour treatment or moisture exposure. Natural grey-green colour retained.`,
    tags: ['ajwain', 'carom seeds', 'omam', 'bishop weed seeds', 'Indian spice', 'digestive spice', 'thymol', 'paratha spice', 'Ayurveda spice', 'pungent spice', 'eptomart', 'herbs and spices'],
    metaTitle: 'Ajwain (Carom Seeds) | Potent & Digestive | Eptomart',
    metaDescription: 'Buy premium ajwain (carom seeds/omam) online. High thymol content, strongly aromatic, natural digestive aid. Essential for flatbreads, pakodas, and achaar.',
  },

  // ── ASAFOETIDA ──────────────────────────────────────────────────────────────
  {
    patterns: ['asafoetida', 'hing', 'perungayam', 'heeng'],
    imageQuery: 'asafoetida hing spice powder Indian yellow',
    altImageQuery: 'hing asafoetida spice jar Indian cooking',
    shortDescription: 'Pure asafoetida (hing) — the pungent, garlicky spice used in tiny amounts that transform every South Indian and Jain recipe.',
    description: `Premium Asafoetida (Hing / Perungayam) — one pinch, infinite flavour.

Asafoetida is a dried resinous gum extracted from the roots of the Ferula plant, used in Indian cooking in microscopic quantities for the enormous flavour impact it delivers. Our hing is compounded to the right strength — potently savoury, garlicky, and warming — and dissolved in edible starch for consistent performance in daily cooking.

Key Features:
• Potent, concentrated formula — just a pinch is enough
• Strong garlic-onion-like aroma from natural sulphur compounds
• Compounded for consistent strength in every use
• Essential in Jain cooking as a garlic/onion substitute
• Aids digestion — traditional remedy for bloating and gas

Culinary Uses:
Added to hot oil in the first moment of tadka for sambar, rasam, dals, chutneys, and rice dishes. A foundational spice in South Indian cooking. Used by Jains in all savory dishes as a garlic substitute. A pinch in any lentil dish prevents digestive discomfort.

Storage: Keep tightly sealed — hing is extremely porous and absorbs other aromas. Store in a separate, double-sealed container.

Quality Assurance: Compounded to FSSAI standards. Consistent strength in every pack. No excessive filler beyond food-grade starch base.`,
    tags: ['asafoetida', 'hing', 'perungayam', 'heeng', 'Jain cooking', 'Indian spice', 'digestive spice', 'garlic substitute', 'South Indian spice', 'tadka spice', 'dal spice', 'eptomart', 'herbs and spices'],
    metaTitle: 'Asafoetida (Hing) | Pure & Potent | Eptomart',
    metaDescription: 'Buy premium asafoetida (hing/perungayam) online. Potent garlic-onion flavour substitute, ideal for South Indian tadka, dals, and Jain cooking.',
  },

  // ── DRY GINGER POWDER ───────────────────────────────────────────────────────
  {
    patterns: ['dry ginger', 'ginger powder', 'sonth', 'sukku', 'chukku'],
    imageQuery: 'ginger powder dry spice ground India',
    altImageQuery: 'dry ginger powder sonth spice bowl Indian',
    shortDescription: 'Pungent, warming dry ginger powder (sonth) — a sharper, more concentrated form of ginger used in spice blends, tea, and Ayurvedic preparations.',
    description: `Premium Dry Ginger Powder (Sonth / Sukku) — warm, sharp, and deeply therapeutic.

Dry ginger powder (sonth) is made from mature ginger rhizomes that are dried and ground, producing a spice considerably more pungent and concentrated than fresh ginger. With a deeper, more complex heat and woody, slightly floral undertones, sonth is an irreplaceable ingredient in spice blends, chai, and Ayurvedic formulas.

Key Features:
• Made from mature, high-fibre ginger rhizomes for concentrated flavour
• Sharper, hotter flavour than fresh ginger — higher gingerol and shogaol content
• Off-white to pale-tan colour indicating natural processing
• Fine grind for smooth incorporation into tea, masalas, and remedies
• Used in Ayurveda as a warming, digestive agent (Trikatu component)

Culinary Uses:
Key ingredient in chai masala, garam masala, and Kashmiri spice blends. Used in ginger cookies, gingerbread, and sweets. A component of traditional Ayurvedic formulations. Added to herbal teas, kadha (immunity drink), and warm milk.

Storage: Airtight container in a cool, dark place. Shelf life: 12–18 months.

Quality Assurance: Processed from clean, mature ginger. No added colour, flavour, or bleaching agents.`,
    tags: ['dry ginger powder', 'sonth', 'sukku', 'chukku', 'ginger powder', 'Indian spice', 'chai spice', 'Ayurveda herb', 'warming spice', 'digestive spice', 'eptomart', 'herbs and spices'],
    metaTitle: 'Dry Ginger Powder (Sonth/Sukku) | Warming & Pure | Eptomart',
    metaDescription: 'Buy premium dry ginger powder (sonth/sukku) online. Concentrated, warming, high gingerol content. Perfect for chai masala, Ayurvedic kadha, and spice blends.',
  },

  // ── NUTMEG ──────────────────────────────────────────────────────────────────
  {
    patterns: ['nutmeg', 'jaiphal', 'jathikai'],
    imageQuery: 'nutmeg whole spice aromatic close up',
    altImageQuery: 'jaiphal nutmeg Indian spice brown round',
    shortDescription: 'Whole nutmeg seeds with a warm, sweet-spicy aroma and complex depth. A signature spice in garam masala, desserts, and Mughlai cooking.',
    description: `Premium Whole Nutmeg (Jaiphal / Jathikai) — warm, complex, and unmistakably luxurious.

Nutmeg is the dried seed of the Myristica fragrans tree, with a warm, sweet, slightly woody flavour profile that adds complexity to both sweet and savoury preparations. Our whole nutmeg seeds are sourced from clean orchards and sold whole so you can grate fresh — the most flavourful way to use this premium spice.

Key Features:
• Large, whole dried seeds for freshly grated use
• Warm, sweet, slightly camphoraceous aroma
• High myristicin and elemicin content for intense flavour
• Significantly more potent than pre-ground nutmeg
• Works in both savoury masalas and sweet desserts

Culinary Uses:
Grated fresh into Mughlai biryanis, rich kormas, and nihari gravies. Used in garam masala blends, chai masala, and spiced milk. A pinch in béchamel, potato preparations, and cream sauces. Used in desserts, cakes, and Christmas bakes.

Storage: Whole seeds last 3–4 years in airtight containers. Grate as needed — pre-grated nutmeg loses aroma quickly.

Quality Assurance: Sourced from mature, high-oil-content nutmeg farms. Naturally dried. No artificial coating or flavour preservation.`,
    tags: ['nutmeg', 'jaiphal', 'jathikai', 'whole nutmeg', 'Indian spice', 'Mughlai spice', 'garam masala spice', 'warm spice', 'aromatic spice', 'baking spice', 'eptomart', 'herbs and spices'],
    metaTitle: 'Whole Nutmeg (Jaiphal) | Fresh-Grate Quality | Eptomart',
    metaDescription: 'Buy premium whole nutmeg (jaiphal/jathikai). Large seeds, intense aroma, best grated fresh. Essential for garam masala, Mughlai cooking, and desserts.',
  },

  // ── MACE ────────────────────────────────────────────────────────────────────
  {
    patterns: ['mace', 'javitri', 'jathipatri'],
    imageQuery: 'mace spice javitri orange dried Indian',
    altImageQuery: 'mace javitri dried lace spice Indian cooking',
    shortDescription: 'Delicate, lace-like mace (javitri) with a softer, sweeter version of nutmeg\'s flavour. A luxurious spice for Mughlai cuisine, garam masala, and fragrant rice.',
    description: `Premium Mace (Javitri / Jathipatri) — the delicate outer lace of nutmeg's elegance.

Mace is the dried aril (the bright red lace-like covering) that surrounds the nutmeg seed. With a flavour similar to nutmeg but lighter, sweeter, and more floral, javitri is considered a luxury spice in Mughlai and Awadhi cuisine, reserved for kormas, shahi biryanis, and rich meat dishes.

Key Features:
• Deep orange-red to amber colour — indicates premium, fully dried mace
• Softer, sweeter, more floral flavour than nutmeg
• Rare spice — adds unmistakable luxury to any dish
• Lace-like blade structure — used whole for slow infusion
• Highly aromatic — a small piece perfumes the entire dish

Culinary Uses:
Used whole in Mughlai biryanis, rich kormas, rogan josh, and white gravies. Ground into premium garam masala blends. Used in Awadhi dum cooking for its aromatic contribution. Also used in desserts, flavoured ghee, and spiced teas.

Storage: Airtight container away from moisture. Mace blades last 2–3 years.

Quality Assurance: Sourced alongside premium nutmeg. Dried to proper amber colour. No bleaching or artificial enhancement.`,
    tags: ['mace', 'javitri', 'jathipatri', 'nutmeg mace', 'Indian spice', 'Mughlai spice', 'luxury spice', 'aromatic spice', 'biryani spice', 'garam masala', 'eptomart', 'herbs and spices'],
    metaTitle: 'Mace (Javitri) | Premium Mughlai Spice | Eptomart',
    metaDescription: 'Buy premium mace (javitri/jathipatri) online. Delicate, floral, sweeter than nutmeg. Essential luxury spice for Mughlai biryani, korma, and garam masala.',
  },

  // ── POPPY SEEDS ─────────────────────────────────────────────────────────────
  {
    patterns: ['poppy seed', 'khus khus', 'posto'],
    imageQuery: 'poppy seeds white khus khus spice Indian',
    altImageQuery: 'white poppy seeds small Indian cooking spice',
    shortDescription: 'Creamy white poppy seeds with a mild, nutty richness. The secret thickener and flavour base in kormas, Mughlai gravies, and Bengali posto dishes.',
    description: `Premium White Poppy Seeds (Khus Khus / Posto) — tiny, mild, and magnificently rich.

White poppy seeds are tiny, kidney-shaped seeds with a neutral, mildly nutty flavour and exceptional thickening properties when soaked and ground. A cornerstone of Mughlai, Bengali, and South Indian cooking, khus khus adds a creamy body to gravies that no other thickener can replicate.

Key Features:
• Creamy off-white seeds — clean, uniform, free from broken or dark seeds
• Mildly nutty, subtly sweet flavour profile
• Exceptional thickening property when soaked and ground
• High in calcium, zinc, and healthy fats
• Legal culinary poppy seed variety (food-grade, FSSAI approved)

Culinary Uses:
Soaked and ground for Mughlai korma, shahi paneer, and white-based gravies. The hero ingredient in Bengali aloo posto and posto bora. Ground with coconut for South Indian coconut-based curries. Sprinkled whole over bread and baked goods.

Storage: Refrigerate to prevent rancidity from high oil content. Best used within 6 months.

Quality Assurance: Food-grade, legal culinary variety only. Cleaned, tested for purity. No adulteration with lower-grade seeds.`,
    tags: ['poppy seeds', 'khus khus', 'posto', 'white poppy seeds', 'Indian spice', 'Mughlai spice', 'korma spice', 'Bengali cooking', 'thickening spice', 'gravy base', 'eptomart', 'herbs and spices'],
    metaTitle: 'White Poppy Seeds (Khus Khus) | Pure & Nutty | Eptomart',
    metaDescription: 'Buy premium white poppy seeds (khus khus/posto) online. Soaked and ground for Mughlai korma, Bengali posto, and creamy Indian gravies. Legal food-grade variety.',
  },

  // ── KASURI METHI ────────────────────────────────────────────────────────────
  {
    patterns: ['kasuri methi', 'kasoori methi', 'dried fenugreek leaf', 'fenugreek leaf'],
    imageQuery: 'kasuri methi dried fenugreek leaves green herb',
    altImageQuery: 'kasoori methi dried herb Indian cooking',
    shortDescription: 'Aromatic dried fenugreek leaves (kasuri methi) — the secret finishing herb that gives restaurant-style butter chicken, paneer butter masala, and naan its signature aroma.',
    description: `Premium Kasuri Methi (Dried Fenugreek Leaves) — the restaurant secret in your kitchen.

Kasuri methi is the magical finishing herb in North Indian restaurant cooking — the distinctive, slightly bitter, maple-like herbal aroma that defines butter chicken, paneer tikka masala, dal makhani, and naan stuffings. Made from dried fenugreek leaves, it is crumbled between the palms and added in the final minute of cooking.

Key Features:
• Bright green, intact dried leaves with strong, authentic fenugreek aroma
• Crumble-ready texture — releases maximum aroma when rubbed between palms
• Bittersweet, herbal, slightly maple-like flavour
• Dried at low temperature to preserve natural volatile oils
• Powder-free content — whole crumbled leaves, not stalk-heavy filler

Culinary Uses:
The finishing touch in butter chicken, dal makhani, shahi paneer, and mutton korma. Added to naan, paratha, and methi thepla dough. Sprinkled over hummus and dips in fusion cooking. Used in spice blends and dry rubs.

Storage: Airtight container in a cool, dark place. Best used within 6 months for peak aroma.

Quality Assurance: Handpicked leaves, cleaned of thick stems. Low-temperature dried. No artificial colour or preservatives.`,
    tags: ['kasuri methi', 'kasoori methi', 'dried fenugreek leaves', 'methi leaves', 'Indian herb', 'North Indian spice', 'butter chicken herb', 'finishing herb', 'restaurant spice', 'eptomart', 'herbs and spices'],
    metaTitle: 'Kasuri Methi (Dried Fenugreek Leaves) | Restaurant Herb | Eptomart',
    metaDescription: 'Buy premium kasuri methi (dried fenugreek leaves) online. The finishing herb for butter chicken, dal makhani, and naan. Intense aroma, clean leaves, no fillers.',
  },

  // ── KOKUM ───────────────────────────────────────────────────────────────────
  {
    patterns: ['kokum', 'garcinia indica'],
    imageQuery: 'kokum dried Indian fruit souring agent',
    altImageQuery: 'kokum dried skin dark purple Indian spice',
    shortDescription: 'Sun-dried kokum rinds — a tart, fruity souring agent unique to Konkan and Goan cuisine. Adds a distinctive purple tinge and gentle sourness to fish curries and kokum sherbet.',
    description: `Premium Dried Kokum (Garcinia Indica) — the Konkan coast's secret souring jewel.

Kokum is the sun-dried rind of the Garcinia indica fruit, native to India's Konkan and Western Ghat regions. With a deep, wine-dark purple colour and a fruity, tart, subtly sweet flavour profile, kokum is the preferred souring agent in Goan, Malvani, and Konkani cooking — a worthy and uniquely flavourful alternative to tamarind.

Key Features:
• Deep purple-maroon dried rinds — vivid colour transfers to curries
• Fruity tartness with a mild sweetness — more complex than tamarind
• Contains Hydroxy Citric Acid (HCA) — a natural wellness compound
• Adds a beautiful purple tinge to fish curries and sol kadi
• No artificial preservatives or sulphur treatment

Culinary Uses:
Essential in Goan fish curry, Malvani prawn curry, and sol kadi (Konkani drink). Used as a souring base in coastal lentil and vegetable preparations. Kokum sherbet — sweetened and diluted — is a cooling summer drink. Also used in Ayurvedic preparations.

Storage: Keep in an airtight container away from moisture. Refrigerate in humid climates. Shelf life: 12 months.

Quality Assurance: Sun-dried without chemical preservatives. Sourced from Konkan coastal farms known for quality kokum.`,
    tags: ['kokum', 'garcinia indica', 'dried kokum', 'Konkan spice', 'souring agent', 'Goan spice', 'Malvani cooking', 'Indian spice', 'fish curry ingredient', 'sol kadi ingredient', 'eptomart', 'herbs and spices'],
    metaTitle: 'Dried Kokum | Konkan Souring Spice | Eptomart',
    metaDescription: 'Buy premium dried kokum (Garcinia indica) online. Fruity-tart Konkan souring agent for Goan fish curry, sol kadi, and prawn curries. Natural, no sulphur.',
  },

  // ── KALPASI (STONE FLOWER) ──────────────────────────────────────────────────
  {
    patterns: ['kalpasi', 'stone flower', 'dagad phool', 'kalpashi', 'black stone flower'],
    imageQuery: 'stone flower kalpasi black dagad phool spice Indian',
    altImageQuery: 'dried flower spice Indian Chettinad cooking rare',
    shortDescription: 'Rare Chettinad spice — dried lichen stone flower (kalpasi) that adds a deep, earthy, mushroom-like aroma to authentic Chettinad non-vegetarian preparations.',
    description: `Premium Kalpasi (Black Stone Flower / Dagad Phool) — the rare soul of Chettinad cuisine.

Kalpasi, also known as dagad phool or black stone flower, is a dried lichen harvested from tree barks and rocks in the forests of South India. It appears as dark, crinkled, irregular pieces with a deep, earthy, woody, and slightly mushroom-like aroma that defines the complexity of authentic Chettinad meat curries and biryani.

Key Features:
• Rare, naturally harvested lichen spice from Indian forests
• Deep, earthy, woody fragrance — entirely unique in the spice world
• Dark charcoal-black crinkled pieces — no artificial drying or processing
• Very potent — only a small piece is needed per recipe
• A defining ingredient in Chettinad cuisine — irreplaceable

Culinary Uses:
Essential in Chettinad chicken curry, mutton biryani, and Chettinad mutton masala. A component of authentic Chettinad masala along with marathi mokku and other rare spices. Also used in Biryani spice blends in small quantities for earthy depth.

Storage: Airtight container away from moisture and light. Shelf life: 2 years.

Quality Assurance: Hand-harvested and cleaned. No chemical treatment. Naturally dried.`,
    tags: ['kalpasi', 'stone flower', 'dagad phool', 'black stone flower', 'Chettinad spice', 'rare spice', 'Indian herb', 'biryani spice', 'earthy spice', 'South Indian spice', 'eptomart', 'herbs and spices'],
    metaTitle: 'Kalpasi (Stone Flower) | Rare Chettinad Spice | Eptomart',
    metaDescription: 'Buy premium kalpasi (dagad phool / stone flower) online. Rare Chettinad spice with deep earthy aroma, essential for authentic Chettinad chicken, mutton, and biryani.',
  },

  // ── MARATHI MOKKU ───────────────────────────────────────────────────────────
  {
    patterns: ['marathi mokku', 'dried flower', 'kapok buds', 'marathi mokka'],
    imageQuery: 'dried flower buds Indian spice Chettinad rare',
    altImageQuery: 'marathi mokku kapok buds spice Indian',
    shortDescription: 'Dried kapok tree flower buds (marathi mokku) — a rare South Indian spice that adds an earthy, mildly pungent aroma characteristic of Chettinad cuisine.',
    description: `Premium Marathi Mokku (Dried Kapok Buds) — the Chettinad spice connoisseur's secret.

Marathi mokku are the dried, unopened flower buds of the Bombax malabaricum (Indian kapok tree), used almost exclusively in Chettinad cuisine and certain South Indian biryani traditions. Rarely found outside specialty spice stores, these small, dried buds carry a distinct, slightly clove-like, earthy-floral aroma that contributes the final layer of complexity to authentic Chettinad dishes.

Key Features:
• Dried kapok flower buds — completely natural, wild-harvested
• Unique clove-adjacent, earthy-floral aroma profile
• Small, dark brown, pod-like appearance
• Very potent — 2–3 buds are sufficient per preparation
• Exclusively a Chettinad spice — rarely available in standard stores

Culinary Uses:
Used in Chettinad chicken and mutton curries alongside kalpasi, marathi mokku, and other signature spices. A component of Chettinad biryani masala blends. Not used in North Indian or everyday South Indian cooking.

Storage: Airtight container, cool and dry. Shelf life: 2 years.

Quality Assurance: Wild-harvested and naturally dried. No chemical processing. Cleaned and sorted for quality before packing.`,
    tags: ['marathi mokku', 'kapok buds', 'dried flower buds', 'Chettinad spice', 'rare spice', 'South Indian spice', 'biryani spice', 'Indian herb', 'earthy spice', 'specialty spice', 'eptomart', 'herbs and spices'],
    metaTitle: 'Marathi Mokku (Dried Kapok Buds) | Chettinad Spice | Eptomart',
    metaDescription: 'Buy premium marathi mokku (dried kapok flower buds) online. Rare Chettinad spice with earthy-floral notes. Essential for authentic Chettinad chicken, mutton, and biryani.',
  },

  // ── WHITE PEPPER ─────────────────────────────────────────────────────────────
  {
    patterns: ['white pepper'],
    imageQuery: 'white pepper corns spice clean background',
    altImageQuery: 'white peppercorns spice Indian',
    shortDescription: 'Mild, earthy white peppercorns — hulled black pepper with a softer heat and subtle fermented undertone. Ideal for cream sauces, white gravies, and seafood.',
    description: `Premium White Peppercorns — refined heat, clean flavour, elegant presentation.

White pepper is produced from the same plant as black pepper, but the outer dark hull is removed after soaking and sun-drying, revealing a cream-coloured inner seed. The result is a spice with milder heat, a slightly fermented, earthy, and musky flavour that suits delicate preparations where black specks would be visually undesirable.

Key Features:
• Hulled peppercorns — milder, earthier, and more subtle than black pepper
• Cream-white colour — ideal for light-coloured dishes and cream sauces
• Slightly fermented, musky note adds depth to subtle preparations
• Grind fresh in a pepper mill for best flavour
• Preferred in Chinese, Vietnamese, and European fine-dining applications

Culinary Uses:
Used in white sauces, bechamel, cream soups, mashed potatoes, and light-coloured gravies. A key spice in Chinese stir-fries and hotpots. Used ground in seafood preparations, scrambled eggs, and consommé. Also preferred for table use where black specks are unwanted.

Storage: Whole peppercorns in an airtight jar — lasts 2–3 years. Grind fresh as needed.

Quality Assurance: Properly hulled, dried, and cleaned. Uniform cream colour indicates quality processing.`,
    tags: ['white pepper', 'white peppercorns', 'white pepper powder', 'mild pepper', 'cream sauce spice', 'fine dining spice', 'cooking spice', 'Indian spice', 'seafood spice', 'eptomart', 'herbs and spices'],
    metaTitle: 'White Peppercorns | Mild & Refined | Eptomart',
    metaDescription: 'Buy premium white peppercorns online. Hulled, mild heat, earthy-musky flavour. Perfect for cream sauces, white gravies, seafood, and fine-dining preparations.',
  },

  // ── MORINGA ──────────────────────────────────────────────────────────────────
  {
    patterns: ['moringa', 'drumstick leaf', 'murungai'],
    imageQuery: 'moringa powder green leaf superfood',
    altImageQuery: 'moringa leaves green powder Indian herb',
    shortDescription: 'Pure moringa leaf powder — the "miracle tree" superfood packed with vitamins, minerals, and antioxidants. Adds a mild, earthy green nutrition boost to any dish or drink.',
    description: `Premium Moringa Leaf Powder — nature's most complete superfood from the miracle tree.

Moringa (Moringa oleifera), known as the "Miracle Tree" and "Murungai" in Tamil, is one of the most nutrient-dense plants on Earth. Our moringa leaf powder is made from young, hand-harvested leaves that are shade-dried at low temperatures to preserve their rich nutritional profile and vivid green colour.

Key Features:
• Shade-dried at low temperature — preserves nutrients, chlorophyll, and colour
• Vibrant green colour indicating freshness and quality drying process
• Rich in Vitamins A, C, E, calcium, iron, and all essential amino acids
• Mild, earthy, slightly grassy flavour — blends easily into food and drinks
• 100% pure leaf powder — no stems, stalks, or fillers

Culinary Uses:
Stir into smoothies, juices, coconut milk, and protein shakes. Mix into dough for green rotis and parathas. Add to soups, dals, rice dishes, and chutneys for a nutritional boost. Use in moringa tea for a gentle, daily wellness ritual.

Storage: Airtight container away from light and moisture. Refrigerate after opening. Best within 12 months.

Quality Assurance: Lab-tested for heavy metals and microbial safety. FSSAI compliant. No added colour or preservatives.`,
    tags: ['moringa powder', 'moringa leaves powder', 'murungai', 'drumstick leaves', 'superfood', 'green powder', 'Indian herb', 'nutritional supplement', 'Ayurveda herb', 'wellness herb', 'eptomart', 'herbs and spices'],
    metaTitle: 'Moringa Leaf Powder | Superfood | Pure & Green | Eptomart',
    metaDescription: 'Buy premium moringa leaf powder (murungai). Shade-dried, nutrient-rich, vibrant green. Perfect for smoothies, rotis, dals, and daily wellness drinks.',
  },

  // ── TULSI ────────────────────────────────────────────────────────────────────
  {
    patterns: ['tulsi', 'holy basil', 'ocimum'],
    imageQuery: 'tulsi holy basil leaves green Indian herb',
    altImageQuery: 'dried tulsi leaves herbal powder green',
    shortDescription: 'Sacred tulsi (holy basil) leaves powder — revered in Ayurveda for centuries. Earthy, slightly clove-like, and deeply aromatic. Ideal for herbal teas and wellness drinks.',
    description: `Premium Tulsi Leaves Powder (Holy Basil) — India's most sacred medicinal herb.

Tulsi (Ocimum tenuiflorum), or holy basil, holds a revered place in Indian culture, spirituality, and Ayurvedic medicine. Our tulsi powder is made from sun-dried, organically grown Rama tulsi leaves — the most aromatic and medicinally potent variety — carefully ground to a fine, fragrant green powder.

Key Features:
• Made from Rama tulsi variety — most aromatic and medicinally rich
• Sun-dried whole leaves, finely ground — retains essential oils
• Earthy, slightly clove-like, peppery, and floral fragrance
• Adaptogenic herb — traditionally used for stress, immunity, and respiratory health
• No artificial colour, fragrance, or preservatives

Culinary & Wellness Uses:
Brewed as tulsi tea — steep in hot water with honey and ginger for a soothing herbal drink. Add to kadha (Ayurvedic immunity drink). Mix into golden milk or warm water. Used as a flavouring in herbal teas, health drinks, and Ayurvedic formulations.

Storage: Airtight container away from moisture and sunlight. Best within 12 months.

Quality Assurance: Grown without pesticides in clean environments. Lab-tested for purity and microbial safety.`,
    tags: ['tulsi powder', 'holy basil', 'tulsi leaves', 'Ayurveda herb', 'Indian herb', 'sacred herb', 'herbal tea', 'immunity herb', 'adaptogen', 'wellness herb', 'eptomart', 'herbs and spices'],
    metaTitle: 'Tulsi Leaves Powder | Holy Basil | Ayurvedic Herb | Eptomart',
    metaDescription: 'Buy premium tulsi (holy basil) leaves powder. Pure, aromatic, Ayurvedic adaptogen. Perfect for tulsi tea, kadha, immunity drinks, and herbal blends.',
  },

  // ── MINT LEAVES ──────────────────────────────────────────────────────────────
  {
    patterns: ['mint leaf', 'mint leave', 'dried mint', 'pudina', 'mint powder'],
    imageQuery: 'dried mint leaves green herb aromatic',
    altImageQuery: 'mint leaves powder green herb cooling',
    shortDescription: 'Dried mint leaves powder with an intensely cool, refreshing aroma. Adds a bright, cooling freshness to chutneys, biryanis, raitas, and herbal drinks.',
    description: `Premium Dried Mint Leaves Powder (Pudina) — cool, refreshing, and unmistakably vibrant.

Mint (Mentha) is one of the most universally loved herbs — its bright, cooling, intensely fresh aroma instantly lifts any dish. Our dried mint leaf powder is made from hand-harvested, shade-dried spearmint leaves, ground to a fine powder that delivers a clean, concentrated mint burst in every use.

Key Features:
• Made from spearmint variety — naturally sweet-cool, not harsh like peppermint
• Vivid green colour indicating low-temperature drying process
• Intensely aromatic — a small amount delivers strong mint flavour
• Cooling on the palate — natural menthol compounds retained
• Versatile across sweet, savoury, and beverage applications

Culinary Uses:
Essential in mint chutney, raita, and biryani (pudina biryani). Used in lemon-mint lemonade, jaljeera, and buttermilk. Sprinkled over chaats, kebabs, and salads as a finishing herb. Added to herbal teas, mint kadha, and cooling summer drinks.

Storage: Sealed container away from light and moisture. Best within 9 months. Keep dry to retain green colour.

Quality Assurance: Shade-dried to preserve colour and menthol. No artificial green colouring or preservatives.`,
    tags: ['mint leaves', 'dried mint', 'pudina', 'mint powder', 'cooling herb', 'Indian herb', 'chutney herb', 'biryani herb', 'herbal tea', 'raita herb', 'eptomart', 'herbs and spices'],
    metaTitle: 'Dried Mint Leaves Powder (Pudina) | Cool & Fresh | Eptomart',
    metaDescription: 'Buy premium dried mint leaves powder (pudina). Intensely cool, vibrant green, naturally aromatic. Perfect for mint chutney, raita, biryani, and herbal drinks.',
  },

  // ── ROSEMARY ─────────────────────────────────────────────────────────────────
  {
    patterns: ['rosemary'],
    imageQuery: 'rosemary leaves dried herb aromatic sprig',
    altImageQuery: 'dried rosemary herb cooking seasoning',
    shortDescription: 'Fragrant dried rosemary leaves with a bold pine-like, woody aroma. A premium European herb for roasts, breads, herbal oils, and Mediterranean cooking.',
    description: `Premium Dried Rosemary Leaves — bold, piney, and magnificently aromatic.

Rosemary (Rosmarinus officinalis) is one of the most distinctive culinary herbs in the world — intensely fragrant, pine-like, and woody with an unmistakable character that transforms roasted meats, breads, and infused oils. Our dried rosemary retains the full essential oil content with firm, needle-like leaves and a deep, silvery-green appearance.

Key Features:
• Whole needle-like dried leaves — not powdered, not crushed — for maximum aroma
• Intensely pine-like, woody, and slightly camphoraceous fragrance
• High rosmarinic acid content — natural antioxidant with wellness properties
• Versatile in fresh-style use once rehydrated, or as dried seasoning
• Premium European herb now widely used in Indian fusion and bakery

Culinary Uses:
Rub onto chicken, lamb, and vegetables before roasting. Add whole sprigs to focaccia, garlic bread, and herb breads. Infuse in olive oil for rosemary oil. Used in herbal teas, marinades, lemon-rosemary water, and Mediterranean sauces.

Storage: Airtight container away from moisture. Whole dried leaves last 12–18 months.

Quality Assurance: Dried at low temperature to preserve aromatic oils. Cleaned, free from stems and woody stalks.`,
    tags: ['rosemary', 'dried rosemary', 'rosemary leaves', 'Mediterranean herb', 'European herb', 'roasting herb', 'bread herb', 'aromatic herb', 'herbal oil', 'cooking herb', 'eptomart', 'herbs and spices'],
    metaTitle: 'Dried Rosemary Leaves | Bold & Aromatic | Eptomart',
    metaDescription: 'Buy premium dried rosemary leaves. Pine-like, woody aroma, perfect for roasted meats, focaccia, herbal oils, and Mediterranean cooking.',
  },

  // ── OREGANO ──────────────────────────────────────────────────────────────────
  {
    patterns: ['oregano'],
    imageQuery: 'dried oregano leaves herb green pizza',
    altImageQuery: 'oregano dried herb Italian seasoning',
    shortDescription: 'Aromatic dried oregano leaves with a warm, slightly bitter, Mediterranean character. The signature herb for pizza, pasta, grilled meats, and Italian cooking.',
    description: `Premium Dried Oregano Leaves — the heartbeat of Mediterranean cooking.

Oregano (Origanum vulgare) is arguably the most recognisable herb in Italian and Mediterranean cooking — the pungent, warm, slightly bitter herb that defines pizza, pasta sauces, and grilled meats. Our dried oregano is sourced from premium Mediterranean-origin varieties and carefully dried to preserve its intense essential oil content.

Key Features:
• Small, grey-green dried leaves with strong, warm, pungent aroma
• High carvacrol and thymol content — the compounds behind oregano's intense flavour
• More potent dried than fresh — releases oils best when crumbled over hot food
• Classic Italian/Mediterranean herb now standard in Indian fusion kitchens
• Used in seasoning blends, pizza toppings, and marinades

Culinary Uses:
Sprinkled over pizza, pasta, and bruschetta. Used in tomato sauce, meat marinades, and grilled vegetables. Key ingredient in Italian seasoning blends, Greek salad, and herbed butter. Added to herbal teas for a digestive and antimicrobial brew.

Storage: Cool, airtight container. Best within 12 months. Crumble over hot food to release maximum aroma.

Quality Assurance: Mediterranean-origin oregano. Cleaned and dried at low temperature. No artificial flavouring.`,
    tags: ['oregano', 'dried oregano', 'oregano leaves', 'Italian herb', 'pizza herb', 'Mediterranean herb', 'pasta herb', 'seasoning herb', 'cooking herb', 'eptomart', 'herbs and spices'],
    metaTitle: 'Dried Oregano Leaves | Pizza & Pasta Herb | Eptomart',
    metaDescription: 'Buy premium dried oregano leaves. Warm, pungent, Mediterranean character. Perfect for pizza, pasta, grilled meats, and Italian seasoning blends.',
  },

  // ── THYME ────────────────────────────────────────────────────────────────────
  {
    patterns: ['thyme'],
    imageQuery: 'dried thyme herb leaves green aromatic',
    altImageQuery: 'thyme herb dried seasoning Mediterranean',
    shortDescription: 'Dried thyme with a warm, earthy, slightly floral flavour. A classic European herb for slow-cooked dishes, roasts, herbal teas, and seasoning blends.',
    description: `Premium Dried Thyme Leaves — earthy, warming, and beautifully complex.

Thyme (Thymus vulgaris) is a foundational herb in European and Mediterranean cooking, with a warm, earthy, slightly minty and floral flavour profile. Its high thymol content makes it one of the most aromatic dried herbs available, and it retains its character beautifully through long cooking — ideal for slow braises and roasts.

Key Features:
• Small, pale grey-green dried leaves with intense, warm, earthy aroma
• High thymol content — responsible for thyme's characteristic flavour
• Holds up well through long cooking — ideal for braises and stews
• Classic bouquet garni herb — works with bay leaves and parsley
• Also used in herbal teas and natural wellness preparations

Culinary Uses:
Add to slow-cooked chicken, lamb, and vegetable stews. Essential in bouquet garni for stocks and soups. Use in herbed butters, bread seasoning, and roasted vegetables. Infuse in olive oil or honey for herb-flavoured condiments. Brewed as thyme tea for throat-soothing wellness.

Storage: Sealed container away from moisture. Dried thyme lasts 12–18 months.

Quality Assurance: Cleaned, stripped of thick stems. Low-temperature dried to preserve thymol content.`,
    tags: ['thyme', 'dried thyme', 'thyme leaves', 'European herb', 'Mediterranean herb', 'roasting herb', 'stew herb', 'seasoning herb', 'herbal tea', 'cooking herb', 'eptomart', 'herbs and spices'],
    metaTitle: 'Dried Thyme Leaves | Earthy & Aromatic | Eptomart',
    metaDescription: 'Buy premium dried thyme leaves. Warm, earthy, high thymol content. Perfect for slow-cooked stews, roasts, bouquet garni, and herbal teas.',
  },

  // ── BASIL ────────────────────────────────────────────────────────────────────
  {
    patterns: ['basil leaf', 'basil leave', 'basil powder', 'sweet basil', 'italian basil', 'basil'],
    imageQuery: 'dried basil leaves herb green Italian',
    altImageQuery: 'basil herb dried green aromatic cooking',
    shortDescription: 'Fragrant dried basil with a sweet, clove-like, slightly peppery character. Elevates pasta, pizza, pesto, soups, and Mediterranean dishes with its unmistakable garden-fresh aroma.',
    description: `Premium Dried Basil Leaves — sweet, aromatic, and quintessentially Mediterranean.

Sweet basil (Ocimum basilicum) is one of the world's most beloved culinary herbs — intensely fragrant, with a sweet, clove-like, mildly peppery flavour profile that defines Italian and Mediterranean cooking. Our dried basil is carefully harvested at peak aromatic maturity and gently dried to preserve its signature essential oils.

Key Features:
• Made from sweet Italian basil — most aromatic culinary variety
• Vivid green to olive-green leaves indicating careful, low-temperature drying
• Sweet, clove-like, slightly anise-peppery flavour profile
• Retains linalool and eugenol — key aromatic compounds
• Versatile in Italian, French, and Indian fusion applications

Culinary Uses:
Essential in pasta sauces, pizza, bruschetta, and caprese salad. The primary herb in pesto, herb butters, and vinaigrettes. Add to soups, marinades, and roasted vegetables. Use in basil-infused olive oil or basil tea for a delicate herbal drink.

Storage: Airtight container away from light. Best within 9–12 months. Add at the end of cooking for maximum aroma.

Quality Assurance: Harvested at peak aroma, gently dried. No artificial colour. Cleaned of coarse stems.`,
    tags: ['basil leaves', 'dried basil', 'sweet basil', 'Italian basil', 'Mediterranean herb', 'pasta herb', 'pizza herb', 'pesto herb', 'aromatic herb', 'cooking herb', 'eptomart', 'herbs and spices'],
    metaTitle: 'Dried Basil Leaves | Sweet & Aromatic | Eptomart',
    metaDescription: 'Buy premium dried basil leaves. Sweet, clove-like aroma, essential for pasta, pizza, pesto, and Mediterranean cooking. Low-temperature dried, no additives.',
  },

  // ── LEMONGRASS ───────────────────────────────────────────────────────────────
  {
    patterns: ['lemongrass', 'lemon grass'],
    imageQuery: 'lemongrass dried herb tea cut aromatic',
    altImageQuery: 'lemongrass stalks dried herb Thai Indian',
    shortDescription: 'Dried lemongrass tea cut with a bright, citrusy, floral aroma. A versatile herb for herbal teas, Thai-inspired curries, soups, and aromatic wellness drinks.',
    description: `Premium Dried Lemongrass (Tea Cut) — bright, citrusy, and beautifully refreshing.

Lemongrass (Cymbopogon citratus) is a tropical grass native to South Asia, prized for its intensely lemony, slightly floral, and gingery aroma. Our tea-cut lemongrass consists of finely chopped dried stalks — the ideal form for infusing in teas, soups, and curries — releasing their essential oils quickly and evenly.

Key Features:
• Tea-cut format — evenly chopped pieces for rapid infusion in hot liquid
• Bright, fresh lemon-citrus aroma with light floral and ginger undertones
• High citral content — the compound behind its signature lemon fragrance
• Used in both culinary and wellness applications
• Naturally caffeine-free herb — perfect for daily herbal tea

Culinary Uses:
Steep in hot water for fresh lemongrass tea — add honey and ginger for a soothing drink. Use in Thai-inspired curry pastes, coconut soups, and broths. Add to herbal infusions, kombucha, and wellness drinks. Used in rice and grain dishes for a subtle citrus fragrance.

Storage: Airtight container away from moisture and light. Best within 12 months.

Quality Assurance: Harvested fresh, cut uniformly, and dried at low temperature. No artificial fragrance or preservatives.`,
    tags: ['lemongrass', 'dried lemongrass', 'lemongrass tea', 'tea cut lemongrass', 'citrus herb', 'herbal tea', 'Thai herb', 'Indian herb', 'wellness herb', 'aromatic herb', 'eptomart', 'herbs and spices'],
    metaTitle: 'Dried Lemongrass Tea Cut | Citrusy & Aromatic | Eptomart',
    metaDescription: 'Buy premium dried lemongrass (tea cut). Bright citrus-lemon aroma, naturally caffeine-free. Perfect for herbal teas, Thai curries, soups, and wellness drinks.',
  },

];

// =============================================================================
// HELPER: Find matching config for a product
// Matches against product name (and optionally tags)
// =============================================================================
function findConfig(productName, productTags = []) {
  const nameLower = (productName || '').toLowerCase();
  const tagsLower = (productTags || []).map(t => t.toLowerCase()).join(' ');
  const combined  = `${nameLower} ${tagsLower}`;

  for (const config of PRODUCT_CONFIGS) {
    if (config.patterns.some(p => combined.includes(p))) {
      return config;
    }
  }
  return null;
}

module.exports = { PRODUCT_CONFIGS, findConfig };
