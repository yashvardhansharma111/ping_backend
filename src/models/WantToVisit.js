const mongoose = require('mongoose');

const WantToVisitSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    adId: { type: mongoose.Schema.Types.ObjectId, ref: 'Ad', required: true, index: true },
  },
  { timestamps: { createdAt: 'savedAt', updatedAt: false } },
);

WantToVisitSchema.index({ userId: 1, adId: 1 }, { unique: true });
WantToVisitSchema.index({ userId: 1, savedAt: -1 });

module.exports = mongoose.model('WantToVisit', WantToVisitSchema);
