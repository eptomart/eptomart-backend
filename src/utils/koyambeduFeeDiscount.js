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

module.exports = { clampPct, effectivePercents, applyFeeDiscount };
