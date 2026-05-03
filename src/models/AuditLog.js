const mongoose = require('mongoose');
const { AUDIT_ACTIONS } = require('../utils/enums');

// Append-only. Update/delete operations are blocked at the schema level so the
// audit trail can be trusted for compliance (ADM.8).
const AuditLogSchema = new mongoose.Schema(
  {
    adminId: { type: mongoose.Schema.Types.ObjectId, ref: 'AdminUser', required: true, index: true },
    adminEmail: { type: String, required: true },
    action: { type: String, enum: AUDIT_ACTIONS, required: true, index: true },
    targetType: { type: String, default: null },
    targetId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
    details: { type: mongoose.Schema.Types.Mixed, default: {} },
    ip: { type: String, default: null },
    userAgent: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

AuditLogSchema.index({ action: 1, createdAt: -1 });
AuditLogSchema.index({ adminId: 1, createdAt: -1 });

const blockMutation = function (next) {
  next(new Error('AuditLog is append-only — updates and deletes are not permitted'));
};
['updateOne', 'updateMany', 'findOneAndUpdate', 'deleteOne', 'deleteMany', 'findOneAndDelete'].forEach((op) => {
  AuditLogSchema.pre(op, blockMutation);
});

module.exports = mongoose.model('AuditLog', AuditLogSchema);
