const mongoose = require('mongoose');

const WarningSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    issuedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'AdminUser', required: true },
    reason: { type: String, required: true, maxlength: 500 },
    strikeNumber: { type: Number, required: true, min: 1 },
    relatedReportId: { type: mongoose.Schema.Types.ObjectId, ref: 'Report', default: null },
    response: { type: String, default: null, maxlength: 500 },
    respondedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

WarningSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('Warning', WarningSchema);
