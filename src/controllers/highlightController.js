const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const v = require('../utils/validate');
const mongoose = require('mongoose');
const Highlight = require('../models/Highlight');
const Activity = require('../models/Activity');
const Friendship = require('../models/Friendship');

const VALID_PRIVACY = ['public', 'connections', 'private'];
const VALID_CATEGORIES = ['food','fitness','networking','chill','fun','sport','music','outdoor','study','gaming','meetup'];

const listByUser = asyncHandler(async (req, res) => {
  const targetId = v.requireObjectId(req.params.userId, 'userId');
  const myId = req.userId;

  let privacyFilter;
  if (myId && new mongoose.Types.ObjectId(myId).equals(targetId)) {
    privacyFilter = {};
  } else {
    const areFriends = myId
      ? !!(await Friendship.findOne({
          $or: [
            { requesterId: myId, addresseeId: targetId },
            { requesterId: targetId, addresseeId: myId },
          ],
          status: 'accepted',
        }))
      : false;
    privacyFilter = { privacy: { $in: areFriends ? ['public', 'connections'] : ['public'] } };
  }

  const highlights = await Highlight.find({ userId: targetId, ...privacyFilter })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();

  res.json({ ok: true, highlights });
});

const create = asyncHandler(async (req, res) => {
  const title = v.requireString(req.body.title, 'title', { min: 1, max: 60 });
  const emoji = req.body.emoji ? String(req.body.emoji).slice(0, 4) : '✨';
  const images = Array.isArray(req.body.images) ? req.body.images.slice(0, 10) : [];
  const privacy = VALID_PRIVACY.includes(req.body.privacy) ? req.body.privacy : 'public';
  const category = VALID_CATEGORIES.includes(req.body.category) ? req.body.category : null;
  const location = req.body.location ? String(req.body.location).slice(0, 120) : null;
  const vibe = req.body.vibe ? String(req.body.vibe).slice(0, 40) : null;
  const pingDate = req.body.pingDate ? new Date(req.body.pingDate) : null;

  let activityId = null;
  if (req.body.activityId) {
    activityId = v.requireObjectId(req.body.activityId, 'activityId');
    const act = await Activity.findById(activityId).lean();
    if (!act) throw AppError.notFound('activity_not_found', 'Activity not found');
    const participated =
      act.creatorId?.toString() === req.userId.toString() ||
      (act.participants ?? []).some((p) => p.userId?.toString() === req.userId.toString());
    if (!participated) throw AppError.forbidden('not_participant', 'You did not participate in this activity');
  }

  const highlight = await Highlight.create({ userId: req.userId, title, emoji, images, activityId, privacy, category, location, vibe, pingDate });
  res.status(201).json({ ok: true, highlight });
});

const update = asyncHandler(async (req, res) => {
  const hId = v.requireObjectId(req.params.id, 'id');
  const highlight = await Highlight.findById(hId);
  if (!highlight) throw AppError.notFound('not_found', 'Highlight not found');
  if (!highlight.userId.equals(req.userId)) throw AppError.forbidden('forbidden', 'Not your highlight');

  if (req.body.title !== undefined) highlight.title = v.requireString(req.body.title, 'title', { min: 1, max: 60 });
  if (req.body.emoji !== undefined) highlight.emoji = String(req.body.emoji).slice(0, 4);
  if (req.body.images !== undefined) highlight.images = Array.isArray(req.body.images) ? req.body.images.slice(0, 10) : [];
  if (req.body.privacy !== undefined && VALID_PRIVACY.includes(req.body.privacy)) highlight.privacy = req.body.privacy;
  if (req.body.category !== undefined) highlight.category = VALID_CATEGORIES.includes(req.body.category) ? req.body.category : null;
  if (req.body.location !== undefined) highlight.location = req.body.location ? String(req.body.location).slice(0, 120) : null;

  await highlight.save();
  res.json({ ok: true, highlight });
});

const remove = asyncHandler(async (req, res) => {
  const hId = v.requireObjectId(req.params.id, 'id');
  const highlight = await Highlight.findById(hId);
  if (!highlight) throw AppError.notFound('not_found', 'Highlight not found');
  if (!highlight.userId.equals(req.userId)) throw AppError.forbidden('forbidden', 'Not your highlight');
  await highlight.deleteOne();
  res.json({ ok: true });
});

const suggest = asyncHandler(async (req, res) => {
  const cutoff = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const existing = await Highlight.find({ userId: req.userId, activityId: { $ne: null } }).distinct('activityId');

  const recent = await Activity.findOne({
    $or: [
      { creatorId: req.userId },
      { 'participants.userId': req.userId },
    ],
    expiresAt: { $lt: new Date(), $gte: cutoff },
    _id: { $nin: existing },
  })
    .sort({ expiresAt: -1 })
    .select('title type placeName expiresAt vibe')
    .lean();

  res.json({ ok: true, suggestion: recent ?? null });
});

module.exports = { listByUser, create, update, remove, suggest };
