// Super-admin "fee waiver" for Koyambedu Daily: 0–100 % off the delivery
// charge and/or the platform fee, shown to the customer with the real fee
// struck through. Set globally (promo) and/or per customer; the customer gets
// whichever is higher. Applied AFTER the existing small-order / minimum-order
// platform-fee rules, so those keep working unchanged.
const clampPct = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 0; };

/** global/user: { deliveryPercent, platformPercent } (either may be missing) */
const effectivePercents = (globalDisc, userDisc) => ({
  deliveryPercent: Math.max(clampPct(globalDisc?.deliveryPercent), clampPct(userDisc?.deliveryPercent)),
  platformPercent: Math.max(clampPct(globalDisc?.platformPercent), clampPct(userDisc?.platformPercent)),
});

const r2 = (n) => Math.round(n * 100) / 100;

/**
 * Returns a NEW charges object with deliveryCharge / platformFee reduced and
 * originalDeliveryCharge / originalPlatformFee set (existing "original" values,
 * e.g. small-order list prices, are kept as the struck-out figure).
 * delivery: apply only to delivery; platform: only to platform fee.
 */
function applyFeeDiscount(charges, pcts, { delivery = true, platform = true } = {}) {
  const out = { ...charges };
  const dp = clampPct(pcts?.deliveryPercent), pp = clampPct(pcts?.platformPercent);
  if (delivery && dp > 0 && out.deliveryCharge > 0) {
    out.originalDeliveryCharge = out.originalDeliveryCharge ?? out.deliveryCharge;
    out.deliveryCharge = r2(out.deliveryCharge * (1 - dp / 100));
  }
  if (platform && pp > 0 && out.platformFee > 0) {
    out.originalPlatformFee = out.originalPlatformFee ?? out.platformFee;
    out.platformFee = r2(out.platformFee * (1 - pp / 100));
  }
  return out;
}

/**
 * Customer-selectable offers (Super Admin sets the minimum order + % for each):
 *   delivery → "Free delivery",  platform → "Free platform fee".
 * cfg: { freeDelivery:{enabled,minOrder,percent}, freePlatform:{...} }
 */
const OFFER_DEFS = [
  { key: 'delivery', cfgKey: 'freeDelivery', title: 'Free delivery' },
  { key: 'platform', cfgKey: 'freePlatform', title: 'Free platform fee' },
];
// distanceKm (nearest Eptomart hub): an offer with maxKm > 0 is NOT offered beyond that distance (0 = anywhere).
function offerStatuses(cfg, subtotal, distanceKm) {
  const st = Number(subtotal) || 0;
  const inRange = (c) => !(Number(c.maxKm) > 0) || distanceKm == null || Number(distanceKm) <= Number(c.maxKm);
  return OFFER_DEFS.filter(d => cfg?.[d.cfgKey]?.enabled && inRange(cfg[d.cfgKey])).map(d => {
    const c = cfg[d.cfgKey], minOrder = Math.max(0, Number(c.minOrder) || 0), percent = clampPct(c.percent ?? 100) || 100;
    return { key: d.key, title: d.title, minOrder, percent, eligible: st >= minOrder, shortBy: Math.max(0, Math.ceil(minOrder - st)) };
  });
}
/** Merge global/customer waiver with the offers the customer picked (higher % wins). Throws {message} if a picked offer is not available. */
function resolveOffers(waiver, cfg, subtotal, picked, distanceKm) {
  const keys = [...new Set((Array.isArray(picked) ? picked : []).filter(k => OFFER_DEFS.some(d => d.key === k)))];
  const st = offerStatuses(cfg, subtotal, distanceKm);
  const out = { ...waiver };
  for (const k of keys) {
    const o = st.find(x => x.key === k);
    if (!o) throw { message: `The "${OFFER_DEFS.find(d => d.key === k).title}" offer is not available right now.` };
    if (!o.eligible) throw { message: `Add ₹${o.shortBy} more to get ${o.title.toLowerCase()}.` };
    const f = k === 'delivery' ? 'deliveryPercent' : 'platformPercent';
    out[f] = Math.max(out[f] || 0, o.percent);
  }
  return { pcts: out, applied: keys };
}

module.exports = { clampPct, effectivePercents, applyFeeDiscount, offerStatuses, resolveOffers };
