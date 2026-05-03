const asyncHandler = require('../../utils/asyncHandler');
const AppError = require('../../utils/AppError');
const v = require('../../utils/validate');

const Appeal = require('../../models/Appeal');
const Ban = require('../../models/Ban');
const User = require('../../models/User');

const auditLogger = require('../../services/auditLogger');

// GET /api/admin/v1/appeals?status=
const listAppeals = asyncHandler(async (req, res) => {
  const status = req.query.status || 'pending';
  const where = ['pending', 'approved', 'denied', 'info_requested'].includes(status)
    ? { status }
    : {};

  const items = await Appeal.find(where)
    .sort({ createdAt: 1 })
    .limit(200)
    .populate('userId', 'displayName username status bannedUntil')
    .populate('banId', 'type reason endsAt');

  const now = Date.now();
  const decorated = items.map((a) => {
    const ageDays = Math.floor((now - a.createdAt.getTime()) / 86400_000);
    return {
      ...a.toObject(),
      ageDays,
      slaFlag: ageDays >= 7 ? 'red' : ageDays >= 3 ? 'yellow' : 'ok',
    };
  });

  res.json({ ok: true, items: decorated });
});

// GET /api/admin/v1/appeals/:id
const getAppeal = asyncHandler(async (req, res) => {
  const id = v.requireObjectId(req.params.id, 'id');
  const appeal = await Appeal.findById(id)
    .populate('userId')
    .populate('banId');
  if (!appeal) throw AppError.notFound('appeal_not_found');
  res.json({ ok: true, appeal });
});

// POST /api/admin/v1/appeals/:id/approve   body: { adminNote? }
const approve = asyncHandler(async (req, res) => {
  const id = v.requireObjectId(req.params.id, 'id');
  const adminNote = v.optionalString(req.body?.adminNote, 'adminNote', { max: 1000 }) ?? null;

  const appeal = await Appeal.findById(id);
  if (!appeal) throw AppError.notFound('appeal_not_found');
  if (appeal.status !== 'pending' && appeal.status !== 'info_requested') {
    throw AppError.conflict('already_decided');
  }

  appeal.status = 'approved';
  appeal.decidedBy = req.adminId;
  appeal.adminNote = adminNote;
  appeal.decidedAt = new Date();
  await appeal.save();

  // Lift the ban
  const ban = await Ban.findById(appeal.banId);
  if (ban && !ban.removedAt) {
    ban.removedAt = new Date();
    ban.removedBy = req.adminId;
    ban.removeNote = `Appeal approved: ${adminNote || ''}`.trim();
    await ban.save();
  }
  await User.updateOne(
    { _id: appeal.userId },
    { $set: { status: 'active', bannedUntil: null } },
  );

  await auditLogger.record({
    admin: req.admin, req, action: 'ban_removed',
    targetType: 'user', targetId: appeal.userId,
    details: { via: 'appeal_approved', appealId: id },
  });
  res.json({ ok: true, appeal });
});

// POST /api/admin/v1/appeals/:id/deny   body: { adminNote }
const deny = asyncHandler(async (req, res) => {
  const id = v.requireObjectId(req.params.id, 'id');
  const adminNote = v.requireString(req.body?.adminNote, 'adminNote', { min: 2, max: 1000 });

  const appeal = await Appeal.findById(id);
  if (!appeal) throw AppError.notFound('appeal_not_found');
  if (appeal.status !== 'pending' && appeal.status !== 'info_requested') {
    throw AppError.conflict('already_decided');
  }

  appeal.status = 'denied';
  appeal.decidedBy = req.adminId;
  appeal.adminNote = adminNote;
  appeal.decidedAt = new Date();
  await appeal.save();

  res.json({ ok: true, appeal });
});

// POST /api/admin/v1/appeals/:id/request-info   body: { question }
const requestInfo = asyncHandler(async (req, res) => {
  const id = v.requireObjectId(req.params.id, 'id');
  const question = v.requireString(req.body?.question, 'question', { min: 2, max: 500 });

  const appeal = await Appeal.findById(id);
  if (!appeal) throw AppError.notFound('appeal_not_found');
  if (appeal.status !== 'pending') throw AppError.conflict('not_pending');

  appeal.status = 'info_requested';
  appeal.infoRequest = question;
  await appeal.save();
  res.json({ ok: true, appeal });
});

module.exports = { listAppeals, getAppeal, approve, deny, requestInfo };
