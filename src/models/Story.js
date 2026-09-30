const mongoose = require('mongoose');

const ViewerSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    at: { type: Date, default: Date.now },
  },
  { _id: false },
);

const StorySchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    mediaUrl: { type: String, required: true, maxlength: 500 },
    mediaType: { type: String, enum: ['image'], default: 'image' },
    caption: { type: String, default: '', maxlength: 200 },
    expiresAt: { type: Date, required: true },
    viewers: { type: [ViewerSchema], default: [] },
  },
  { timestamps: true },
);

// TTL — MongoDB removes the document once expiresAt passes; also serves feed queries
StorySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
StorySchema.index({ userId: 1, expiresAt: 1 });

module.exports = mongoose.model('Story', StorySchema);
