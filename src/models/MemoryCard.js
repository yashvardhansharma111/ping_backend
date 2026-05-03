const mongoose = require('mongoose');

// Generated post-expiry summary card for an activity (per blueprint v2 carryover).
const MemoryCardSchema = new mongoose.Schema(
  {
    activityId: {
      type: mongoose.Schema.Types.ObjectId, ref: 'Activity',
      required: true, unique: true, index: true,
    },
    title: { type: String, required: true },
    coverUrl: { type: String, default: null },
    participantIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    photos: { type: [String], default: [] },
    summary: { type: String, default: '' },
    durationMinutes: { type: Number, default: 0 },
  },
  { timestamps: true },
);

module.exports = mongoose.model('MemoryCard', MemoryCardSchema);
