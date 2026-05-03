const mongoose = require('mongoose');

// A recurring activity template. Concrete `Activity` documents are spawned
// from this by the `recurring_spawn` cron job using the rrule.
const SubscriberSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    skipDates: { type: [Date], default: [] },
    subscribedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const ActivitySeriesSchema = new mongoose.Schema(
  {
    creatorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    rrule: { type: String, required: true }, // RFC 5545 RRULE string
    timezone: { type: String, default: 'Asia/Kolkata' },
    baseTemplate: {
      type: { type: String, default: 'other' },
      title: { type: String, required: true },
      description: String,
      location: {
        type: { type: String, enum: ['Point'], default: 'Point' },
        coordinates: { type: [Number], required: true },
      },
      placeName: String,
      radiusMeters: { type: Number, default: 100 },
      durationMinutes: { type: Number, default: 60 },
      visibility: { type: String, default: 'friends' },
      squadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Squad', default: null },
    },
    subscribers: { type: [SubscriberSchema], default: [] },
    nextRunAt: { type: Date, default: null, index: true },
    active: { type: Boolean, default: true, index: true },
  },
  { timestamps: true },
);

module.exports = mongoose.model('ActivitySeries', ActivitySeriesSchema);
