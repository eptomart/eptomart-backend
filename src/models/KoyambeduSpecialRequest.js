// ============================================
// KOYAMBEDU SPECIAL OCCASION REQUEST MODEL
// ============================================
const mongoose = require('mongoose');
const { Schema } = mongoose;

const koyambeduSpecialRequestSchema = new Schema({
  // Requester info
  buyerName:    { type: String, required: true, trim: true },
  phone:        { type: String, required: true, trim: true },
  email:        { type: String, trim: true, lowercase: true },
  user:         { type: Schema.Types.ObjectId, ref: 'User' }, // if logged in

  // Occasion details
  occasionType: {
    type: String,
    enum: ['wedding', 'birthday', 'festival', 'corporate', 'pooja', 'other'],
    default: 'other',
  },
  occasionTypeOther: String, // if "other"

  // Items requested
  requestedItems: [{
    itemName: String,
    quantity: String,
    unit:     String,
    notes:    String,
  }],

  // When needed
  requiredDate: { type: Date, required: true },
  additionalNotes: { type: String, trim: true },

  // Admin workflow
  status: {
    type: String,
    enum: ['new', 'contacted', 'completed', 'cancelled'],
    default: 'new',
  },
  adminNotes:     String,
  handledBy:      { type: Schema.Types.ObjectId, ref: 'User' },
  contactedAt:    Date,
  completedAt:    Date,

  // Notification tracking
  emailSent:      { type: Boolean, default: false },
  emailSentAt:    Date,
}, { timestamps: true });

koyambeduSpecialRequestSchema.index({ status: 1, createdAt: -1 });
koyambeduSpecialRequestSchema.index({ requiredDate: 1 });

module.exports = mongoose.model('KoyambeduSpecialRequest', koyambeduSpecialRequestSchema);
