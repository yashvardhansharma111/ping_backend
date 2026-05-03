const mongoose = require('mongoose');

// Pre-aggregated rollup so the AD.7 analytics dashboard loads fast.
const AdAnalyticsDailySchema = new mongoose.Schema(
  {
    adId: { type: mongoose.Schema.Types.ObjectId, ref: 'Ad', required: true },
    date: { type: String, required: true }, // YYYY-MM-DD in IST

    views: { type: Number, default: 0 },
    uniqueReach: { type: Number, default: 0 },
    thumbsUp: { type: Number, default: 0 },
    wantToVisit: { type: Number, default: 0 },
    profileTaps: { type: Number, default: 0 },
    contactTaps: { type: Number, default: 0 },
    shares: { type: Number, default: 0 },

    byProduct: [
      { productIndex: Number, swipes: Number, _id: false },
    ],
    byHour: { type: [Number], default: () => Array(24).fill(0) },
  },
  { timestamps: true },
);

AdAnalyticsDailySchema.index({ adId: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('AdAnalyticsDaily', AdAnalyticsDailySchema);
