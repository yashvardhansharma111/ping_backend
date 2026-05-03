const asyncHandler = require('../../utils/asyncHandler');
const AppError = require('../../utils/AppError');
const v = require('../../utils/validate');
const { REPORT_TARGET_TYPE } = require('../../utils/enums');

const Report = require('../../models/Report');
const Activity = require('../../models/Activity');
const Ad = require('../../models/Ad');
const Message = require('../../models/Message');
const User = require('../../models/User');

const auditLogger = require('../../services/auditLogger');
const adminUserController = require('./userController');

// GET /api/admin/v1/reports?tab=all|pings|ads|users|messages|resolved
const listReports = asyncHandler(async (req, res) => {
  const tab = (req.query.tab || 'all').toString();
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);

  const where = {};
  if (tab === 'resolved') where.status = { $in: ['resolved', 'dismissed'] };
  else if (tab === 'pings') { where.targetType = 'ping'; where.status = { $in: ['pending', 'escalated'] }; }
  else if (tab === 'ads') { where.targetType = 'ad'; where.status = { $in: ['pending', 'escalated'] }; }
  else if (tab === 'users') { where.targetType = 'user'; where.status = { $in: ['pending', 'escalated'] }; }
  else if (tab === 'messages') { where.targetType = 'message'; where.status = { $in: ['pending', 'escalated'] }; }
  else if (tab === 'all') where.status = { $in: ['pending', 'escalated'] };

  const [items, total] = await Promise.all([
    Report.find(where)
      .sort({ autoFlagScore: -1, createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('reporterId', 'displayName username')
      .populate('targetUserId', 'displayName username status'),
    Report.countDocuments(where),
  ]);

  res.json({ ok: true, items, page, limit, total });
});

// GET /api/admin/v1/reports/:id
const getReport = asyncHandler(async (req, res) => {
  const id = v.requireObjectId(req.params.id, 'id');
  const report = await Report.findById(id)
    .populate('reporterId', 'displayName username')
    .populate('targetUserId', 'displayName username status strikeCount');
  if (!report) throw AppError.notFound('report_not_found');

  // Inline target preview for the moderator UI.
  let target = null;
  if (report.targetType === 'ping') target = await Activity.findById(report.targetId);
  else if (report.targetType === 'ad') target = await Ad.findById(report.targetId);
  else if (report.targetType === 'message') target = await Message.findById(report.targetId);
  else if (report.targetType === 'user') target = await User.findById(report.targetId);

  res.json({ ok: true, report, target });
});

async function resolveReport(reportId, adminId, action, extra = {}) {
  await Report.updateOne(
    { _id: reportId },
    {
      $set: {
        status: action === 'escalate' ? 'escalated' : (action === 'dismiss' ? 'dismissed' : 'resolved'),
        resolvedBy: adminId,
        resolutionAction: action,
        resolvedAt: new Date(),
        ...extra,
      },
    },
  );
}

async function removeTarget(report) {
  if (report.targetType === 'ping') {
    await Activity.updateOne({ _id: report.targetId }, { $set: { status: 'cancelled' } });
  } else if (report.targetType === 'ad') {
    await Ad.updateOne(
      { _id: report.targetId },
      { $set: { status: 'removed', removedReason: 'moderation' } },
    );
  } else if (report.targetType === 'message') {
    await Message.updateOne(
      { _id: report.targetId },
      { $set: { deletedAt: new Date(), body: '', mediaUrl: null } },
    );
  }
  // For 'user' targets we don't remove the user — that's a separate ban action.
}

// POST /api/admin/v1/reports/:id/dismiss
const dismiss = asyncHandler(async (req, res) => {
  const id = v.requireObjectId(req.params.id, 'id');
  const report = await Report.findById(id);
  if (!report) throw AppError.notFound('report_not_found');

  await resolveReport(id, req.adminId, 'dismiss');
  await auditLogger.record({
    admin: req.admin, req, action: 'report_dismissed',
    targetType: 'report', targetId: id,
  });
  res.json({ ok: true });
});

// POST /api/admin/v1/reports/:id/remove   body: { reason }
const remove = asyncHandler(async (req, res) => {
  const id = v.requireObjectId(req.params.id, 'id');
  const reason = v.requireString(req.body?.reason, 'reason', { min: 2, max: 200 });
  const report = await Report.findById(id);
  if (!report) throw AppError.notFound('report_not_found');

  await removeTarget(report);
  await resolveReport(id, req.adminId, 'remove');
  await auditLogger.record({
    admin: req.admin, req, action: 'content_removed',
    targetType: report.targetType, targetId: report.targetId,
    details: { reason, reportId: id },
  });
  res.json({ ok: true });
});

// POST /api/admin/v1/reports/:id/remove-and-warn   body: { reason }
const removeAndWarn = asyncHandler(async (req, res, next) => {
  const id = v.requireObjectId(req.params.id, 'id');
  const reason = v.requireString(req.body?.reason, 'reason', { min: 2, max: 500 });
  const report = await Report.findById(id);
  if (!report) throw AppError.notFound('report_not_found');
  if (!report.targetUserId) {
    throw AppError.badRequest('no_target_user', 'Report has no associated user to warn');
  }

  await removeTarget(report);
  await resolveReport(id, req.adminId, 'remove_warn');
  await auditLogger.record({
    admin: req.admin, req, action: 'content_removed',
    targetType: report.targetType, targetId: report.targetId,
    details: { reason, reportId: id, alsoWarn: true },
  });

  // Reuse the warn-user controller — it issues the strike and auto-escalates.
  req.params.id = String(report.targetUserId);
  req.body = { reason: `[content removed] ${reason}` };
  return adminUserController.warnUser(req, res, next);
});

// POST /api/admin/v1/reports/:id/remove-and-ban   body: { reason, type, durationDays?, confirm? }
const removeAndBan = asyncHandler(async (req, res, next) => {
  const id = v.requireObjectId(req.params.id, 'id');
  const report = await Report.findById(id);
  if (!report) throw AppError.notFound('report_not_found');
  if (!report.targetUserId) throw AppError.badRequest('no_target_user');

  await removeTarget(report);
  await resolveReport(id, req.adminId, 'remove_ban');

  req.params.id = String(report.targetUserId);
  return adminUserController.banUser(req, res, next);
});

// POST /api/admin/v1/reports/:id/escalate   body: { note? }
const escalate = asyncHandler(async (req, res) => {
  const id = v.requireObjectId(req.params.id, 'id');
  const note = v.optionalString(req.body?.note, 'note', { max: 500 }) ?? null;
  const report = await Report.findById(id);
  if (!report) throw AppError.notFound('report_not_found');

  report.status = 'escalated';
  if (note) report.notes = `${report.notes}\n[escalation] ${note}`.trim();
  await report.save();

  await auditLogger.record({
    admin: req.admin, req, action: 'report_escalated',
    targetType: 'report', targetId: id,
    details: { note },
  });
  res.json({ ok: true });
});

module.exports = {
  listReports,
  getReport,
  dismiss,
  remove,
  removeAndWarn,
  removeAndBan,
  escalate,
};
