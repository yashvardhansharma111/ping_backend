const mongoose = require('mongoose');

const RatingSchema = new mongoose.Schema(
  {
    rater:    { type: mongoose.Schema.Types.ObjectId, ref: 'User',     required: true },
    ratee:    { type: mongoose.Schema.Types.ObjectId, ref: 'User',     required: true },
    activity: { type: mongoose.Schema.Types.ObjectId, ref: 'Activity', required: true },
    score:    { type: Number, required: true, min: 1, max: 5 },
  },
  { timestamps: true },
);

// One rating per rater–ratee–activity triplet
RatingSchema.index({ rater: 1, ratee: 1, activity: 1 }, { unique: true });
RatingSchema.index({ ratee: 1 });

module.exports = mongoose.model('Rating', RatingSchema);
