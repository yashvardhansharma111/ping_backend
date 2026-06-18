const mongoose = require('mongoose');
const { AD_TIER, AD_STATUS, AD_CATEGORY, AD_TIER_SPECS } = require('../utils/enums');

const ProductSchema = new mongoose.Schema(
  {
    imageUrl: { type: String, required: true },
    videoUrl: { type: String, default: null },
    name: { type: String, required: true, trim: true, maxlength: 40 },
    priceMinor: { type: Number, default: null, min: 0 },
    description: { type: String, default: '', maxlength: 120 },
    order: { type: Number, default: 0 },
  },
  { _id: false },
);

const AdSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tier: { type: String, enum: AD_TIER, required: true, index: true },

    businessName:  { type: String, required: true, trim: true, maxlength: 40 },
    category:      { type: String, enum: AD_CATEGORY, required: true, index: true },
    tagline:       { type: String, default: '', maxlength: 60 },
    coverImageUrl: { type: String, default: null },
    address:       { type: String, default: null, trim: true, maxlength: 120 },
    website:       { type: String, default: null, trim: true, maxlength: 200 },
    tags:          [{ type: String, trim: true }],
    contactPhone:  { type: String, default: null },

    location: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], required: true },
    },
    radiusMeters: { type: Number, required: true, min: 100, max: 5000 },

    products: { type: [ProductSchema], default: [] },

    paymentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment', default: null, index: true },
    status: { type: String, enum: AD_STATUS, default: 'pending_payment', index: true },

    startsAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null, index: true },

    removedReason: { type: String, default: null },
    removedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'AdminUser', default: null },
  },
  { timestamps: true },
);

AdSchema.index({ location: '2dsphere' });
AdSchema.index({ status: 1, expiresAt: 1 });
AdSchema.index({ userId: 1, status: 1, createdAt: -1 });

AdSchema.pre('validate', function (next) {
  const spec = AD_TIER_SPECS[this.tier];
  if (!spec) return next(new Error(`unknown tier ${this.tier}`));
  if (this.products.length > spec.maxProducts) {
    return next(new Error(`tier ${this.tier} allows max ${spec.maxProducts} products`));
  }
  if (!spec.allowVideo && this.products.some((p) => p.videoUrl)) {
    return next(new Error(`tier ${this.tier} does not allow video`));
  }
  if (!this.radiusMeters) this.radiusMeters = spec.radiusMeters;
  next();
});

module.exports = mongoose.model('Ad', AdSchema);
