const mongoose = require('mongoose');

// One row per day, populated by the nightly rollup job. Powers ADM.1 and ADM.6.
const AnalyticsSnapshotSchema = new mongoose.Schema(
  {
    date: { type: String, required: true, unique: true }, // YYYY-MM-DD (IST)
    dau: { type: Number, default: 0 },
    mau: { type: Number, default: 0 },
    newSignups: { type: Number, default: 0 },
    pingsCreated: { type: Number, default: 0 },
    adsLaunched: { type: Number, default: 0 },
    revenueMinor: { type: Number, default: 0 },
    reportsSubmitted: { type: Number, default: 0 },
    reportsResolved: { type: Number, default: 0 },
    bansIssued: { type: Number, default: 0 },
    tierBreakdown: {
      basic_49: { type: Number, default: 0 },
      pro_99: { type: Number, default: 0 },
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model('AnalyticsSnapshot', AnalyticsSnapshotSchema);
