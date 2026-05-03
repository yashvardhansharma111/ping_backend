const AuditLog = require('../models/AuditLog');

// Write an immutable audit log entry. Always called server-side, never from
// client input. The AuditLog schema blocks update/delete, so once written
// these rows are permanent.
async function record({ admin, req, action, targetType = null, targetId = null, details = {} }) {
  return AuditLog.create({
    adminId: admin._id,
    adminEmail: admin.email,
    action,
    targetType,
    targetId,
    details,
    ip: req?.ip || null,
    userAgent: req?.headers?.['user-agent'] || null,
  });
}

module.exports = { record };
