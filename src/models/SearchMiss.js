// ============================================
// SEARCH MISS — tracks product searches with no results
// Used for admin "Most Requested Unavailable Products" widget
// ============================================
const mongoose = require('mongoose');

const searchMissSchema = new mongoose.Schema({
  keyword: {
    type:     String,
    required: true,
    lowercase: true,
    trim:     true,
    unique:   true,
    index:    true,
  },
  count:          { type: Number,  default: 1 },
  lastSearchedAt: { type: Date,    default: Date.now },
  city:           { type: String,  trim: true },
  userIds:        [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
}, { timestamps: true });

searchMissSchema.index({ count: -1 });

module.exports = mongoose.model('SearchMiss', searchMissSchema);
