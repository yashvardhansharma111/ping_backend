const mongoose = require('mongoose');
const { AD_EVENT_TYPE } = require('../utils/enums');

// Raw, high-volume analytics events for an ad. Aggregated nightly into
// AdAnalyticsDaily. TTL after 90 days to keep collection size bounded.
const NINETY_DAYS = 90 * 24 * 60 * 60;

const AdEventSchema = new mongoose.Schema(
  {
    adId: { type: mongoose.Schema.Types.ObjectId, ref: 'Ad', required: true, index: true },
    viewerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    type: { type: String, enum: AD_EVENT_TYPE, required: true, index: true },
    productIndex: { type: Number, default: null },
    geohash: { type: String, default: null, index: true },
    location: {
      type: { type: String, enum: ['Point'], default: undefined },
      coordinates: { type: [Number], default: undefined },
    },
    userAgent: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

AdEventSchema.index({ adId: 1, type: 1, createdAt: -1 });
AdEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: NINETY_DAYS });

module.exports = mongoose.model('AdEvent', AdEventSchema);
