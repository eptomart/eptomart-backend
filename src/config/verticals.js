// ============================================
// VERTICAL REGISTRY — single source of truth
// for every Eptomart business vertical.
//
// To add a future vertical:
//   1. Add an entry here.
//   2. Create an adapter in services/orders/adapters/.
//   3. Done — it appears in the unified Orders API,
//      tabs, and calculations automatically.
// ============================================
'use strict';

const VERTICALS = {
  eptomart: {
    key:        'eptomart',
    name:       'Eptomart',
    shortName:  'Eptomart',
    emoji:      '🛒',
    color:      '#f4941c',
    logo:       '/icons/icon-192.png',
    orderModel: 'Order',
    idPrefix:   'EPT',
    features: {
      supportsPartialDecline: false,   // until Stage B schema additions
      supportsSlots:          false,
      supportsWallet:         false,
      deliveryProvider:       'shiprocket',
      invoiceStages:          ['proforma', 'confirmation', 'tax'],
      trackingUrlField:       'shiprocket.trackingUrl',
    },
    fees: {
      gstMode:     'per_item',   // GST computed per item via gstCalculator
      platformFee: 0,            // charged to seller, not customer
      packingFee:  0,
    },
  },

  koyambedu: {
    key:        'koyambedu',
    name:       'Koyambedu Daily',
    shortName:  'Koyambedu',
    emoji:      '🥬',
    color:      '#16a34a',
    logo:       '/categories/koyambedu.jpg',
    orderModel: 'KoyambeduOrder',
    idPrefix:   'KBD',
    features: {
      supportsPartialDecline: true,
      supportsSlots:          true,
      supportsWallet:         true,
      deliveryProvider:       'internal',
      invoiceStages:          ['proforma', 'confirmation', 'tax'],
      trackingUrlField:       null,
    },
    fees: {
      gstMode:     'flat_rate',
      gstRate:     0,            // fresh produce — 0% GST
      platformFee: 15,
      packingFee:  0,
    },
  },

  eptofresh: {
    key:        'eptofresh',
    name:       'EptoFresh Proteins',
    shortName:  'EptoFresh',
    emoji:      '🥩',
    color:      '#ea580c',
    logo:       '/categories/proteins.jpg',
    orderModel: 'EptoFreshOrder',
    idPrefix:   'EPF',
    features: {
      supportsPartialDecline: false,
      supportsSlots:          false,
      supportsWallet:         true,
      deliveryProvider:       'porter',
      invoiceStages:          ['proforma', 'tax'],
      trackingUrlField:       'porter.trackingUrl',
    },
    fees: {
      gstMode:     'flat_rate',
      gstRate:     0,            // fresh meat/produce — 0% GST
      platformFee: 0,
      packingFee:  0,
    },
  },

  uzhavar: {
    key:        'uzhavar',
    name:       'Farmer Fresh',
    shortName:  'Farmer Fresh',
    emoji:      '🌾',
    color:      '#0d9488',
    logo:       '/categories/uzhavar.jpg',
    orderModel: 'UzhavarOrder',
    idPrefix:   'UF',
    features: {
      supportsPartialDecline: false,
      supportsSlots:          true,
      supportsWallet:         false,
      deliveryProvider:       'farmer_direct',
      invoiceStages:          ['tax'],           // booking-fee receipt after delivery
      trackingUrlField:       null,
      // Customer pays booking fee online; produce paid to farmer on delivery
      bookingFeeModel:        true,
    },
    fees: {
      gstMode:     'booking_fee_only',
      gstRate:     18,           // 18% GST on booking fee only
      platformFee: 0,
      packingFee:  0,
    },
  },
};

/** Ordered list for tabs (All Orders tab is added by the frontend). */
function listVerticals() {
  return Object.values(VERTICALS).map(v => ({
    key:       v.key,
    name:      v.name,
    shortName: v.shortName,
    emoji:     v.emoji,
    color:     v.color,
    logo:      v.logo,
    features:  v.features,
  }));
}

function getVertical(key) {
  return VERTICALS[key] || null;
}

module.exports = { VERTICALS, listVerticals, getVertical };
