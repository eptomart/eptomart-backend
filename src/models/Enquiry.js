// ============================================
// ENQUIRY MODEL — stores Contact Us submissions
// ============================================
const mongoose = require('mongoose');

const enquirySchema = new mongoose.Schema({
  name:    { type: String, required: true, trim: true },
  email:   { type: String, trim: true, lowercase: true },
  phone:   { type: String, trim: true },
  subject: { type: String, trim: true },
  message: { type: String, required: true, trim: true },

  // Status managed by admin
  status: {
    type:    String,
    enum:    ['new', 'in_progress', 'resolved', 'closed'],
    default: 'new',
  },
  adminReply: { type: String },
  repliedAt:  { type: Date },
  repliedBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

  // Source tracking
  ip:        { type: String },
  userAgent: { type: String },
}, { timestamps: true });

enquirySchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('Enquiry', enquirySchema);
