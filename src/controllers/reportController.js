const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const v = require('../utils/validate');
const { REPORT_TARGET_TYPE } = require('../utils/enums');

const Report = require('../models/Report');
const User = require('../models/User');
const Activity = require('../models/Activity');
const Ad = require('../models/Ad');
const Message = require('../models/Message');

// Maps a target type → the model + how to derive the offending user
const TARGET_LOOKUPS = {
  user: (id) => User.findById(id).then((u) => ({ doc: u, ownerId: u?._id })),
  ping: (id) => Activity.findById(id).then((a) => ({ doc: a, ownerId: a?.creatorId })),
  ad: (id) => Ad.findById(id).then((a) => ({ doc: a, ownerId: a?.userId })),
  message: (id) => Message.findById(id).then((m) => ({ doc: m, ownerId: m?.senderId })),
};

// POST /api/v1/reports   body: { targetType, targetId, reason, notes? }
const createReport = asyncHandler(async (req, res) => {
  const targetType = v.requireEnum(req.body?.targetType, 'targetType', REPORT_TARGET_TYPE);
  const targetId = v.requireObjectId(req.body?.targetId, 'targetId');
  const reason = v.requireString(req.body?.reason, 'reason', { min: 2, max: 80 });
  const notes = v.optionalString(req.body?.notes, 'notes', { max: 500 }) ?? '';

  const { doc, ownerId } = await TARGET_LOOKUPS[targetType](targetId);
  if (!doc) throw AppError.notFound('target_not_found');
  if (ownerId && ownerId.equals(req.userId)) {
    throw AppError.badRequest('self_report', "Can't report your own content");
  }

  // Prevent the same user from spamming reports on the same target.
  const dup = await Report.findOne({
    reporterId: req.userId,
    targetType,
    targetId,
    status: { $in: ['pending', 'escalated'] },
  });
  if (dup) throw AppError.conflict('already_reported', 'You already reported this');

  const report = await Report.create({
    reporterId: req.userId,
    targetType,
    targetId,
    targetUserId: ownerId || null,
    reason,
    notes,
  });

  // Auto-flag rule (per spec page 13): 5+ pending reports against the same
  // target bumps autoFlagScore so the moderation queue sorts it to the top.
  const count = await Report.countDocuments({
    targetType,
    targetId,
    status: { $in: ['pending', 'escalated'] },
  });
  if (count >= 5) {
    await Report.updateMany(
      { targetType, targetId, status: { $in: ['pending', 'escalated'] } },
      { $set: { autoFlagScore: count } },
    );
  }

  res.status(201).json({ ok: true, report });
});

// GET /api/v1/reports/mine
const listMyReports = asyncHandler(async (req, res) => {
  const reports = await Report.find({ reporterId: req.userId })
    .sort({ createdAt: -1 })
    .limit(50);
  res.json({ ok: true, reports });
});

module.exports = { createReport, listMyReports };
