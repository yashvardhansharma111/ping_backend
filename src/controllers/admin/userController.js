const asyncHandler = require('../../utils/asyncHandler');
const AppError = require('../../utils/AppError');
const v = require('../../utils/validate');

const User = require('../../models/User');
const Activity = require('../../models/Activity');
const Ad = require('../../models/Ad');
const Warning = require('../../models/Warning');
const Ban = require('../../models/Ban');
const Appeal = require('../../models/Appeal');

const auditLogger = require('../../services/auditLogger');
const { revokeAllForUser } = require('../../services/tokenService');

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
const STRIKE_3_BAN_DAYS = 7;

// Recompute strike count over the last 90 days. Driven by warning history,
// not the cached field on User, so removing a warning would naturally lower
// the count once we add that admin action.
async function activeStrikeCount(userId) {
  const since = new Date(Date.now() - NINETY_DAYS_MS);
  return Warning.countDocuments({ userId, createdAt: { $gte: since } });
}

// GET /api/admin/v1/users?q=&filter=&page=
const listUsers = asyncHandler(async (req, res) => {
  const q = (req.query.q || '').toString().trim();
  const filter = (req.query.filter || 'all').toString();
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);

  const conditions = [];
  if (q) {
    const safe = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(safe, 'i');
    conditions.push({ $or: [{ displayName: re }, { username: re }, { phone: re }, { email: re }] });
  }
  if (filter === 'active') conditions.push({ status: 'active' });
  if (filter === 'warned') conditions.push({ strikeCount: { $gte: 1 }, status: { $ne: 'perm_banned' } });
  if (filter === 'multi_strike') conditions.push({ strikeCount: { $gte: 2 } });
  if (filter === 'banned') conditions.push({ status: { $in: ['temp_banned', 'perm_banned'] } });
  if (filter === 'new') conditions.push({ createdAt: { $gte: new Date(Date.now() - 7 * 86400_000) } });

  const where = conditions.length ? { $and: conditions } : {};

  const [users, total] = await Promise.all([
    User.find(where)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .select('displayName username phone email status strikeCount trustRate createdAt lastActiveAt avatarUrl bannedUntil'),
    User.countDocuments(where),
  ]);

  res.json({ ok: true, users, page, limit, total });
});

// GET /api/admin/v1/users/:id
const getUserDetail = asyncHandler(async (req, res) => {
  const id = v.requireObjectId(req.params.id, 'id');
  const user = await User.findById(id);
  if (!user) throw AppError.notFound('user_not_found');

  const [activities, ads, warnings, bans, appeals] = await Promise.all([
    Activity.find({ creatorId: id }).sort({ createdAt: -1 }).limit(10),
    Ad.find({ userId: id }).sort({ createdAt: -1 }).limit(20),
    Warning.find({ userId: id }).sort({ createdAt: -1 }),
    Ban.find({ userId: id }).sort({ createdAt: -1 }),
    Appeal.find({ userId: id }).sort({ createdAt: -1 }),
  ]);

  res.json({ ok: true, user, activities, ads, warnings, bans, appeals });
});

// POST /api/admin/v1/users/:id/warn   body: { reason }
const warnUser = asyncHandler(async (req, res) => {
  const id = v.requireObjectId(req.params.id, 'id');
  const reason = v.requireString(req.body?.reason, 'reason', { min: 2, max: 500 });

  const user = await User.findById(id);
  if (!user) throw AppError.notFound('user_not_found');
  if (user.status === 'perm_banned') {
    throw AppError.badRequest('already_banned', 'User is permanently banned');
  }

  const strikeNumber = (await activeStrikeCount(id)) + 1;
  const warning = await Warning.create({
    userId: id,
    issuedBy: req.adminId,
    reason,
    strikeNumber,
  });

  user.strikeCount = strikeNumber;
  if (strikeNumber === 1 && user.status === 'active') user.status = 'warned';
  await user.save();

  await auditLogger.record({
    admin: req.admin, req, action: 'warning_issued',
    targetType: 'user', targetId: id,
    details: { reason, strikeNumber },
  });

  // Auto-escalation: 3+ strikes within 90 days → 7-day temp ban (spec p15).
  let autoBan = null;
  if (strikeNumber >= 3 && user.status !== 'temp_banned') {
    autoBan = await applyBan({
      adminId: req.adminId,
      userId: id,
      type: 'temp',
      durationDays: STRIKE_3_BAN_DAYS,
      reason: `Auto: ${strikeNumber} strikes in 90 days`,
      req,
      admin: req.admin,
    });
  }

  res.json({ ok: true, warning, autoBan });
});

// Internal — used by warnUser auto-escalation and by banUser.
async function applyBan({ adminId, userId, type, durationDays, endsAt, reason, req, admin }) {
  const user = await User.findById(userId);
  if (!user) throw AppError.notFound('user_not_found');

  const now = new Date();
  const ban = await Ban.create({
    userId,
    type,
    reason,
    issuedBy: adminId,
    startsAt: now,
    endsAt: type === 'perm' ? null : (endsAt || new Date(now.getTime() + durationDays * 86400_000)),
    deviceFingerprintsBanned: type === 'perm' ? user.deviceFingerprints : [],
  });

  user.status = type === 'perm' ? 'perm_banned' : 'temp_banned';
  user.bannedUntil = ban.endsAt;
  await user.save();

  await revokeAllForUser(userId, type === 'perm' ? 'admin_perm_ban' : 'admin_temp_ban');

  await auditLogger.record({
    admin, req, action: 'ban_applied',
    targetType: 'user', targetId: userId,
    details: { type, reason, endsAt: ban.endsAt },
  });

  return ban;
}

// POST /api/admin/v1/users/:id/ban   body: { type, durationDays?, reason }
const banUser = asyncHandler(async (req, res) => {
  const id = v.requireObjectId(req.params.id, 'id');
  const type = v.requireEnum(req.body?.type, 'type', ['temp', 'perm']);
  const reason = v.requireString(req.body?.reason, 'reason', { min: 2, max: 500 });
  let durationDays = null;
  if (type === 'temp') {
    durationDays = v.requireNumber(req.body?.durationDays, 'durationDays', {
      min: 1, max: 30, integer: true,
    });
  }
  if (type === 'perm') {
    if (req.body?.confirm !== 'CONFIRM') {
      throw AppError.badRequest('confirm_required', 'Permanent bans require confirm=CONFIRM');
    }
  }

  const ban = await applyBan({
    adminId: req.adminId,
    userId: id,
    type,
    durationDays,
    reason,
    req,
    admin: req.admin,
  });
  res.json({ ok: true, ban });
});

// POST /api/admin/v1/users/:id/unban   body: { note? }
const unbanUser = asyncHandler(async (req, res) => {
  const id = v.requireObjectId(req.params.id, 'id');
  const user = await User.findById(id);
  if (!user) throw AppError.notFound('user_not_found');
  if (!['temp_banned', 'perm_banned'].includes(user.status)) {
    throw AppError.badRequest('not_banned');
  }

  const note = v.optionalString(req.body?.note, 'note', { max: 500 }) ?? null;
  const activeBan = await Ban.findOne({ userId: id, removedAt: null }).sort({ createdAt: -1 });
  if (activeBan) {
    activeBan.removedAt = new Date();
    activeBan.removedBy = req.adminId;
    activeBan.removeNote = note;
    await activeBan.save();
  }

  user.status = 'active';
  user.bannedUntil = null;
  await user.save();

  await auditLogger.record({
    admin: req.admin, req, action: 'ban_removed',
    targetType: 'user', targetId: id,
    details: { note, banId: activeBan?._id },
  });

  res.json({ ok: true, user });
});

// DELETE /api/admin/v1/users/:id   body: { reason, confirm: 'CONFIRM' }
const deleteUser = asyncHandler(async (req, res) => {
  const id = v.requireObjectId(req.params.id, 'id');
  if (req.body?.confirm !== 'CONFIRM') {
    throw AppError.badRequest('confirm_required', 'Send confirm=CONFIRM to delete');
  }
  const reason = v.requireString(req.body?.reason, 'reason', { min: 2, max: 500 });

  const user = await User.findById(id);
  if (!user) throw AppError.notFound('user_not_found');

  // Same anonymisation policy as the self-serve delete: keep referential
  // integrity for the social/activity graph, but lock the account out.
  user.status = 'perm_banned';
  user.displayName = 'Deleted user';
  user.username = null;
  user.email = null;
  user.avatarUrl = null;
  user.bio = '';
  user.fcmTokens = [];
  user.currentLocation = null;
  await user.save();

  await revokeAllForUser(id, 'admin_delete');

  await auditLogger.record({
    admin: req.admin, req, action: 'account_deleted',
    targetType: 'user', targetId: id,
    details: { reason },
  });

  res.json({ ok: true });
});

module.exports = { listUsers, getUserDetail, warnUser, banUser, unbanUser, deleteUser };
