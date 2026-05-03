const mongoose = require('mongoose');
const { ACTIVITY_EVENT_TYPES } = require('../utils/enums');

const ActivityEventSchema = new mongoose.Schema(
  {
    activityId: { type: mongoose.Schema.Types.ObjectId, ref: 'Activity', required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, enum: ACTIVITY_EVENT_TYPES, required: true },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

ActivityEventSchema.index({ activityId: 1, createdAt: -1 });

module.exports = mongoose.model('ActivityEvent', ActivityEventSchema);
