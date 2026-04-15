const mongoose = require('mongoose');

const invoiceItemSchema = new mongoose.Schema({
  productId:      mongoose.Schema.Types.ObjectId,
  productName:    { type: String, required: true },
  sku:            String,
  hsnCode:        String,
  sellerId:       mongoose.Schema.Types.ObjectId,
  sellerName:     String,
  sellerGstNo:    String,
  quantity:       { type: Number, required: true },
  unitPriceExGst: { type: Number, required: true },
  gstRate:        { type: Number, required: true },
  cgstRate:       Number,
  sgstRate:       Number,
  igstRate:       Number,
  cgstAmount:     { type: Number, default: 0 },
  sgstAmount:     { type: Number, default: 0 },
  igstAmount:     { type: Number, default: 0 },
  gstAmount:      { type: Number, required: true },
  lineTotal:      { type: Number, required: true },
  lineGrandTotal: { type: Number, required: true },
}, { _id: false });

const addressSnapshotSchema = new mongoose.Schema({
  name: String, phone: String,
  addressLine1: String, addressLine2: String,
  city: String, state: String, pincode: String,
  country: { type: String, default: 'India' },
}, { _id: false });

const invoiceSchema = new mongoose.Schema({
  invoiceNumber: { type: String, unique: true, required: true },
  order:    { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true },
  customer: { type: mongoose.Schema.Types.ObjectId, ref: 'User',  required: true },

  items: [invoiceItemSchema],

  billingAddress:  addressSnapshotSchema,
  shippingAddress: addressSnapshotSchema,

  subtotal:   { type: Number, required: true },
  cgstTotal:  { type: Number, default: 0 },
  sgstTotal:  { type: Number, default: 0 },
  igstTotal:  { type: Number, default: 0 },
  gstTotal:   { type: Number, required: true },
  discount:   { type: Number, default: 0 },
  shipping:   { type: Number, default: 0 },
  grandTotal: { type: Number, required: true },

  gstType:       { type: String, enum: ['intra', 'inter'], required: true },
  sellerState:   String,
  customerState: String,

  business: {
    name:    { type: String, default: 'Eptomart' },
    address: { type: String, default: 'No.2, 3rd St, Janaki Nagar, Karthikeyan Nagar, Maduravoyal, Chennai, Tamil Nadu – 600095' },
    phone:   { type: String, default: '+91 6369 129 995' },
    email:   { type: String, default: 'support@eptomart.com' },
    gstNo:   String,
    website: { type: String, default: 'www.eptomart.com' },
  },

  pdfUrl:      String,
  pdfPublicId: String,

  status:      { type: String, enum: ['generated', 'sent', 'cancelled'], default: 'generated' },
  generatedAt: { type: Date, default: Date.now },
}, { timestamps: true });

invoiceSchema.index({ customer: 1, createdAt: -1 });
invoiceSchema.index({ order: 1 });
// invoiceNumber index created automatically via unique: true

module.exports = mongoose.model('Invoice', invoiceSchema);
