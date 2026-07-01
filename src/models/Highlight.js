const mongoose = require('mongoose');

const highlightSchema = new mongoose.Schema(
  {
    userId:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title:      { type: String, required: true, maxlength: 60, trim: true },
    emoji:      { type: String, default: '✨', maxlength: 4 },
    images:     { type: [String], default: [], validate: { validator: (v) => v.length <= 10, message: 'Max 10 images' } },
    activityId: { type: mongoose.Schema.Types.ObjectId, ref: 'Activity', default: null },
    privacy:    { type: String, enum: ['public', 'connections', 'private'], default: 'public' },
    category:   { type: String, enum: ['food','fitness','networking','chill','fun','sport','music','outdoor','study','gaming','meetup',null], default: null },
    location:   { type: String, maxlength: 120, default: null },
    vibe:       { type: String, maxlength: 40, default: null },
    pingDate:   { type: Date, default: null },
  },
  { timestamps: true },
);

highlightSchema.index({ userId: 1, createdAt: -1 });
module.exports = mongoose.model('Highlight', highlightSchema);
