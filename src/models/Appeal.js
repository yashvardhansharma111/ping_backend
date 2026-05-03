const mongoose = require('mongoose');
const { APPEAL_STATUS } = require('../utils/enums');

const AppealSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    banId: { type: mongoose.Schema.Types.ObjectId, ref: 'Ban', required: true },
    message: { type: String, required: true, maxlength: 2000 },
    status: { type: String, enum: APPEAL_STATUS, default: 'pending', index: true },

    decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'AdminUser', default: null },
    adminNote: { type: String, default: null, maxlength: 1000 },
    decidedAt: { type: Date, default: null },

    infoRequest: { type: String, default: null, maxlength: 500 },
    userResponse: { type: String, default: null, maxlength: 2000 },
  },
  { timestamps: true },
);

AppealSchema.index({ status: 1, createdAt: 1 }); // SLA: pending old → high priority

module.exports = mongoose.model('Appeal', AppealSchema);
