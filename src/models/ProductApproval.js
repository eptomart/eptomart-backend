const mongoose = require('mongoose');

const productApprovalSchema = new mongoose.Schema({
  product:     { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  seller:      { type: mongoose.Schema.Types.ObjectId, ref: 'Seller', required: true },
  action: {
    type: String,
    enum: ['submitted', 'approved', 'rejected', 'correction_requested', 'resubmitted'],
    required: true,
  },
  performedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  note:        String,
  snapshot:    mongoose.Schema.Types.Mixed,
}, { timestamps: true });

productApprovalSchema.index({ product: 1, createdAt: -1 });
productApprovalSchema.index({ seller: 1, createdAt: -1 });
productApprovalSchema.index({ action: 1, createdAt: -1 });

module.exports = mongoose.model('ProductApproval', productApprovalSchema);
