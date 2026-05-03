const mongoose = require('mongoose');
const {
  ACTIVITY_VISIBILITY, ACTIVITY_STATUS, ACTIVITY_TYPES,
} = require('../utils/enums');

const PointSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], required: true },
  },
  { _id: false },
);

const ParticipantSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    joinedAt: { type: Date, default: Date.now },
    onMyWayAt: { type: Date, default: null },
    arrivedAt: { type: Date, default: null },
  },
  { _id: false },
);

const ActivitySchema = new mongoose.Schema(
  {
    creatorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, enum: ACTIVITY_TYPES, default: 'other', index: true },
    title: { type: String, required: true, trim: true, maxlength: 80 },
    description: { type: String, default: '', maxlength: 500 },

    location: { type: PointSchema, required: true },
    placeName: { type: String, default: null, maxlength: 120 },
    radiusMeters: { type: Number, default: 100, min: 25, max: 5000 },

    startsAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true, index: true },

    visibility: { type: String, enum: ACTIVITY_VISIBILITY, default: 'friends', index: true },
    squadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Squad', default: null, index: true },

    participants: { type: [ParticipantSchema], default: [] },
    maxParticipants: { type: Number, default: null, min: 2 },

    status: { type: String, enum: ACTIVITY_STATUS, default: 'live', index: true },
    seriesId: { type: mongoose.Schema.Types.ObjectId, ref: 'ActivitySeries', default: null, index: true },
  },
  { timestamps: true },
);

ActivitySchema.index({ location: '2dsphere' });
ActivitySchema.index({ status: 1, expiresAt: 1 });
ActivitySchema.index({ creatorId: 1, createdAt: -1 });

ActivitySchema.virtual('participantCount').get(function () {
  return this.participants?.length || 0;
});

module.exports = mongoose.model('Activity', ActivitySchema);
