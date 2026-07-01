const mongoose = require('mongoose');
const { EVENT_CATEGORY } = require('../utils/enums');

const PointSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: {
      type: [Number],
      validate: { validator: (v) => v.length === 2, message: 'Must be [lng, lat]' },
    },
  },
  { _id: false },
);

const eventSchema = new mongoose.Schema(
  {
    title:        { type: String, required: true, maxlength: 80, trim: true },
    description:  { type: String, maxlength: 500, default: '' },
    imageUrl:     { type: String, default: null },
    venueName:    { type: String, maxlength: 100, default: null, trim: true },
    venueAddress: { type: String, maxlength: 200, default: null },
    location:     { type: PointSchema, default: null },
    category:     { type: String, enum: EVENT_CATEGORY, default: 'event' },
    startDate:    { type: Date, required: true },
    endDate:      { type: Date, required: true },
    isActive:     { type: Boolean, default: true, index: true },
    tags:         { type: [String], default: [] },
    createdByAdmin: { type: String, default: null },
  },
  { timestamps: true },
);

eventSchema.index({ location: '2dsphere' });
eventSchema.index({ isActive: 1, endDate: 1 });

module.exports = mongoose.model('Event', eventSchema);
