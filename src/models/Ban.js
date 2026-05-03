const mongoose = require('mongoose');
const { BAN_TYPE } = require('../utils/enums');

const BanSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, enum: BAN_TYPE, required: true },
    reason: { type: String, required: true, maxlength: 500 },
    issuedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'AdminUser', required: true },

    startsAt: { type: Date, default: Date.now },
    endsAt: { type: Date, default: null, index: true }, // null for permanent

    removedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'AdminUser', default: null },
    removedAt: { type: Date, default: null },
    removeNote: { type: String, default: null },

    deviceFingerprintsBanned: { type: [String], default: [] },
    relatedReportId: { type: mongoose.Schema.Types.ObjectId, ref: 'Report', default: null },
  },
  { timestamps: true },
);

BanSchema.index({ userId: 1, createdAt: -1 });
BanSchema.index({ type: 1, endsAt: 1 });

module.exports = mongoose.model('Ban', BanSchema);
