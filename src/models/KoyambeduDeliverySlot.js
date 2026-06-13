// ============================================
// KOYAMBEDU DELIVERY SLOT MODEL
// ============================================
const mongoose = require('mongoose');
const { Schema } = mongoose;

const koyambeduDeliverySlotSchema = new Schema({
  type:       { type: String, enum: ['today','tomorrow'], required: true },
  timeLabel:  { type: String, required: true }, // "7 AM – 11 AM"
  cutoffTime: { type: String, required: true },  // "08:00" — orders must be placed by this time
  isActive:   { type: Boolean, default: true },
  capacity:   { type: Number, default: 100 },    // max orders for this slot
  sortOrder:  { type: Number, default: 0 },
  note:       String,
}, { timestamps: true });

// Seed default slots if collection is empty
koyambeduDeliverySlotSchema.statics.seedDefaults = async function() {
  const count = await this.countDocuments();
  if (count > 0) return;
  await this.insertMany([
    { type: 'today',    timeLabel: 'Today  4 PM – 7 PM',      cutoffTime: '08:00', sortOrder: 1 },
    { type: 'today',    timeLabel: 'Today  7 PM – 10 PM',     cutoffTime: '08:00', sortOrder: 2 },
    { type: 'tomorrow', timeLabel: 'Tomorrow  6 AM – 9 AM',   cutoffTime: '23:59', sortOrder: 3 },
    { type: 'tomorrow', timeLabel: 'Tomorrow  9 AM – 12 PM',  cutoffTime: '23:59', sortOrder: 4 },
    { type: 'tomorrow', timeLabel: 'Tomorrow  4 PM – 7 PM',   cutoffTime: '23:59', sortOrder: 5 },
  ]);
  console.log('[KoyambeduSlots] Default delivery slots seeded');
};

module.exports = mongoose.model('KoyambeduDeliverySlot', koyambeduDeliverySlotSchema);
