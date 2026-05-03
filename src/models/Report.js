const mongoose = require('mongoose');
const { REPORT_TARGET_TYPE, REPORT_STATUS } = require('../utils/enums');

const ReportSchema = new mongoose.Schema(
  {
    reporterId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    targetType: { type: String, enum: REPORT_TARGET_TYPE, required: true, index: true },
    targetId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    targetUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },

    reason: { type: String, required: true, maxlength: 80 },
    notes: { type: String, default: '', maxlength: 500 },

    status: { type: String, enum: REPORT_STATUS, default: 'pending', index: true },
    autoFlagScore: { type: Number, default: 0, index: true },

    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'AdminUser', default: null },
    resolutionAction: { type: String, default: null },
    resolvedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

ReportSchema.index({ status: 1, autoFlagScore: -1, createdAt: -1 });
ReportSchema.index({ targetType: 1, targetId: 1 });

module.exports = mongoose.model('Report', ReportSchema);
