// ============================================
// EPTOFRESH DELIVERY CONFIG
// Admin-configurable delivery charge settings
// ============================================
const mongoose = require('mongoose');

const cityRuleSchema = new mongoose.Schema({
  city: { type: String, required: true },
  freeDeliveryThreshold:     { type: Number, default: 1049 },
  freeDeliveryDistanceLimit: { type: Number, default: 10 },
  highValueSurchargePerSlab: { type: Number, default: 50 },
  highValueSlabSizeKm:       { type: Number, default: 2 },
  standardSurchargePerSlab:  { type: Number, default: 50 },
  standardSlabSizeKm:        { type: Number, default: 3 },
  standardBaseBeyond12km:    { type: Number, default: 199 },
  maxServiceableDistance:    { type: Number, default: 0 },
  isActive:                  { type: Boolean, default: true },
}, { _id: false });

const eptoFreshDeliveryConfigSchema = new mongoose.Schema({
  key: { type: String, default: 'global', unique: true },

  // Global defaults
  freeDeliveryThreshold:     { type: Number, default: 1049 },   // ₹
  freeDeliveryDistanceLimit: { type: Number, default: 10 },      // km — free delivery cutoff
  highValueSurchargePerSlab: { type: Number, default: 50 },      // ₹ per slab for orders >= threshold beyond limit
  highValueSlabSizeKm:       { type: Number, default: 2 },       // km per slab
  standardSurchargePerSlab:  { type: Number, default: 50 },      // ₹ per slab for standard orders beyond 12km
  standardSlabSizeKm:        { type: Number, default: 3 },       // km per slab
  standardBaseBeyond12km:    { type: Number, default: 199 },     // base charge when dist > 12km
  maxServiceableDistance:    { type: Number, default: 0 },       // 0 = unlimited

  // City-specific overrides
  cityRules: [cityRuleSchema],

  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

// Helper to get config for a specific city (falls back to global)
eptoFreshDeliveryConfigSchema.methods.forCity = function (city) {
  if (city) {
    const rule = this.cityRules.find(r => r.city.toLowerCase() === city.toLowerCase() && r.isActive);
    if (rule) return rule.toObject();
  }
  return {
    freeDeliveryThreshold:     this.freeDeliveryThreshold,
    freeDeliveryDistanceLimit: this.freeDeliveryDistanceLimit,
    highValueSurchargePerSlab: this.highValueSurchargePerSlab,
    highValueSlabSizeKm:       this.highValueSlabSizeKm,
    standardSurchargePerSlab:  this.standardSurchargePerSlab,
    standardSlabSizeKm:        this.standardSlabSizeKm,
    standardBaseBeyond12km:    this.standardBaseBeyond12km,
    maxServiceableDistance:    this.maxServiceableDistance,
  };
};

module.exports = mongoose.model('EptoFreshDeliveryConfig', eptoFreshDeliveryConfigSchema);
