// ============================================
// KOYAMBEDU SELLER ADMIN MODEL
// Hierarchy: SuperAdmin → SellerAdmin → Seller
// SellerAdmin can create sellers but cannot approve them.
// ============================================
const mongoose = require('mongoose');
const { Schema } = mongoose;

const koyambeduSellerAdminSchema = new Schema({
  // Linked Eptomart user account
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },

  // Identity
  name:         { type: String, required: true, trim: true },
  businessName: { type: String, trim: true },
  contactPhone: { type: String, trim: true },
  contactEmail: { type: String, lowercase: true, trim: true },

  // Approval (only superAdmin can approve/reject)
  status: {
    type: String,
    enum: ['pending_review', 'approved', 'rejected', 'suspended'],
    default: 'pending_review',
  },

  // Who created / approved this SellerAdmin
  createdBy:  { type: Schema.Types.ObjectId, ref: 'User' }, // the superAdmin
  approvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  approvedAt: Date,
  rejectedReason: String,

  // Permissions (read-only — enforced in controller)
  permissions: {
    canCreateSellers:   { type: Boolean, default: true },
    canUpdateProducts:  { type: Boolean, default: true },
    canViewOrders:      { type: Boolean, default: false }, // masked — no buyer info
    canApprovalSellers: { type: Boolean, default: false }, // always false
  },

  notes: String,
}, { timestamps: true });

koyambeduSellerAdminSchema.index({ user: 1 });
koyambeduSellerAdminSchema.index({ status: 1 });

module.exports = mongoose.model('KoyambeduSellerAdmin', koyambeduSellerAdminSchema);
