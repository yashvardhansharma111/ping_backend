const mongoose = require('mongoose');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const v = require('../utils/validate');
const { ACTIVITY_TYPES, ACTIVITY_VISIBILITY, ACTIVITY_GENDER_FILTER } = require('../utils/enums');

const Activity = require('../models/Activity');
const ActivityEvent = require('../models/ActivityEvent');
const Friendship = require('../models/Friendship');
const Rating = require('../models/Rating');
const Squad = require('../models/Squad');
const User = require('../models/User');

const DEFAULT_DURATION_MIN = 60;
const MAX_DURATION_MIN = 12 * 60;
const EARTH_RADIUS_M = 6378137;

// --- access helpers ----------------------------------------------------------

async function getFriendIdSet(userId) {
  const fs = await Friendship.find({
    status: 'accepted',
    $or: [{ userA: userId }, { userB: userId }],
  }).select('userA userB');
  const set = new Set();
  for (const f of fs) {
    set.add(f.userA.equals(userId) ? String(f.userB) : String(f.userA));
  }
  return set;
}

async function getSquadIdSet(userId) {
  const squads = await Squad.find({ memberIds: userId }).select('_id');
  return new Set(squads.map((s) => String(s._id)));
}

function canSee(activity, userId, friendIds, squadIds) {
  if (activity.creatorId.equals(userId)) return true;
  if (activity.participants.some((p) => p.userId.equals(userId))) return true;
  if (activity.visibility === 'public') return true;
  if (activity.visibility === 'friends') return friendIds.has(String(activity.creatorId));
  if (activity.visibility === 'squad') return activity.squadId && squadIds.has(String(activity.squadId));
  return false;
}

// --- handlers ----------------------------------------------------------------

// POST /api/v1/activities
const createActivity = asyncHandler(async (req, res) => {
  const title = v.requireString(req.body?.title, 'title', { min: 1, max: 80 });
  const description = v.optionalString(req.body?.description, 'description', { max: 500 }) ?? '';
  const type = req.body?.type
    ? v.requireEnum(req.body.type, 'type', ACTIVITY_TYPES)
    : 'other';
  const visibility = req.body?.visibility
    ? v.requireEnum(req.body.visibility, 'visibility', ACTIVITY_VISIBILITY)
    : 'friends';
  const coords = v.requireLatLng(req.body?.lat, req.body?.lng);
  const radiusMeters = req.body?.radiusMeters
    ? v.requireNumber(req.body.radiusMeters, 'radiusMeters', { min: 25, max: 5000, integer: true })
    : 100;

  const durationMin = req.body?.durationMinutes
    ? v.requireNumber(req.body.durationMinutes, 'durationMinutes', { min: 5, max: MAX_DURATION_MIN, integer: true })
    : DEFAULT_DURATION_MIN;

  const startsAt = req.body?.startsAt ? new Date(req.body.startsAt) : new Date();
  if (Number.isNaN(startsAt.getTime())) throw AppError.badRequest('invalid_startsAt', 'startsAt is invalid');
  const expiresAt = new Date(startsAt.getTime() + durationMin * 60_000);

  let squadId = null;
  if (visibility === 'squad') {
    squadId = v.requireObjectId(req.body?.squadId, 'squadId');
    const squad = await Squad.findById(squadId);
    if (!squad) throw AppError.notFound('squad_not_found');
    if (!squad.memberIds.some((m) => m.equals(req.userId))) {
      throw AppError.forbidden('not_squad_member');
    }
  }

  const maxParticipants = req.body?.maxParticipants
    ? v.requireNumber(req.body.maxParticipants, 'maxParticipants', { min: 2, max: 100, integer: true })
    : null;

  const genderFilter = req.body?.genderFilter
    ? v.requireEnum(req.body.genderFilter, 'genderFilter', ACTIVITY_GENDER_FILTER)
    : 'all';

  const activity = await Activity.create({
    creatorId: req.userId,
    type,
    title,
    description,
    location: { type: 'Point', coordinates: coords },
    placeName: v.optionalString(req.body?.placeName, 'placeName', { max: 120 }) ?? null,
    radiusMeters,
    startsAt,
    expiresAt,
    visibility,
    squadId,
    maxParticipants,
    genderFilter,
    participants: [{ userId: req.userId, joinedAt: new Date() }],
    status: 'live',
  });

  await ActivityEvent.create({ activityId: activity._id, userId: req.userId, type: 'joined' });

  res.status(201).json({ ok: true, activity });
});

// GET /api/v1/activities/nearby?lat=&lng=&radius=
const nearby = asyncHandler(async (req, res) => {
  const coords = v.requireLatLng(req.query.lat, req.query.lng);
  const radius = req.query.radius
    ? v.requireNumber(req.query.radius, 'radius', { min: 50, max: 50_000, integer: true })
    : 5000;

  const [friendIds, squadIds, me] = await Promise.all([
    getFriendIdSet(req.userId),
    getSquadIdSet(req.userId),
    User.findById(req.userId).select('gender'),
  ]);

  // Build gender filter — creators always see their own; others filtered by gender
  const myGender = me?.gender ?? null;
  const genderFilter = {
    $or: [
      { creatorId: req.userId },
      { genderFilter: 'all' },
      ...(myGender === 'female' ? [{ genderFilter: 'women_only' }] : []),
      ...(myGender === 'male'   ? [{ genderFilter: 'men_only'   }] : []),
    ],
  };

  const visibilityFilter = {
    $or: [
      { creatorId: req.userId },
      { visibility: 'public' },
      { visibility: 'friends', creatorId: { $in: [...friendIds] } },
      { visibility: 'squad', squadId: { $in: [...squadIds] } },
    ],
  };

  const docs = await Activity.find({
    status: 'live',
    expiresAt: { $gt: new Date() },
    location: {
      $geoWithin: {
        $centerSphere: [coords, radius / EARTH_RADIUS_M],
      },
    },
    $and: [visibilityFilter, genderFilter],
  })
    .limit(200)
    .populate('creatorId', 'displayName username avatarUrl trustRate createdAt');

  res.json({ ok: true, activities: docs });
});

// GET /api/v1/activities/mine?status=live|expired|all
const mine = asyncHandler(async (req, res) => {
  const status = req.query.status || 'live';
  const filter = { creatorId: req.userId };
  if (status === 'live') {
    filter.status = 'live';
    filter.expiresAt = { $gt: new Date() };
  } else if (status === 'expired') {
    filter.$or = [{ status: 'expired' }, { expiresAt: { $lte: new Date() } }];
  } else if (status !== 'all') {
    throw AppError.badRequest('invalid_status', 'status must be live, expired, or all');
  }

  const activities = await Activity.find(filter).sort({ createdAt: -1 }).limit(100);
  res.json({ ok: true, activities });
});

// GET /api/v1/activities/joined  (where I'm a participant but not creator)
const joined = asyncHandler(async (req, res) => {
  const activities = await Activity.find({
    'participants.userId': req.userId,
    creatorId: { $ne: req.userId },
  })
    .sort({ createdAt: -1 })
    .limit(100)
    .populate('creatorId', 'displayName username avatarUrl');
  res.json({ ok: true, activities });
});

// GET /api/v1/activities/:id
const getActivity = asyncHandler(async (req, res) => {
  const id = v.requireObjectId(req.params.id, 'id');
  const activity = await Activity.findById(id)
    .populate('creatorId', 'displayName username avatarUrl trustRate')
    .populate('participants.userId', 'displayName username avatarUrl');
  if (!activity) throw AppError.notFound('activity_not_found');

  const [friendIds, squadIds] = await Promise.all([
    getFriendIdSet(req.userId),
    getSquadIdSet(req.userId),
  ]);
  if (!canSee(activity, req.userId, friendIds, squadIds)) {
    throw AppError.forbidden('cannot_view', 'This activity is not visible to you');
  }

  res.json({ ok: true, activity });
});

// PATCH /api/v1/activities/:id  (creator only)
const updateActivity = asyncHandler(async (req, res) => {
  const id = v.requireObjectId(req.params.id, 'id');
  const activity = await Activity.findById(id);
  if (!activity) throw AppError.notFound('activity_not_found');
  if (!activity.creatorId.equals(req.userId)) throw AppError.forbidden('not_creator');
  if (activity.status !== 'live') throw AppError.badRequest('not_editable', 'Only live activities can be edited');

  if (req.body.title !== undefined) {
    activity.title = v.requireString(req.body.title, 'title', { min: 1, max: 80 });
  }
  if (req.body.description !== undefined) {
    activity.description = v.optionalString(req.body.description, 'description', { max: 500 }) ?? '';
  }
  if (req.body.placeName !== undefined) {
    activity.placeName = v.optionalString(req.body.placeName, 'placeName', { max: 120 }) ?? null;
  }
  if (req.body.expiresAt !== undefined) {
    const t = new Date(req.body.expiresAt);
    if (Number.isNaN(t.getTime())) throw AppError.badRequest('invalid_expiresAt');
    if (t <= new Date()) throw AppError.badRequest('expiresAt_past', 'expiresAt must be in the future');
    activity.expiresAt = t;
  }

  await activity.save();
  res.json({ ok: true, activity });
});

// DELETE /api/v1/activities/:id  (cancel — creator only)
const cancelActivity = asyncHandler(async (req, res) => {
  const id = v.requireObjectId(req.params.id, 'id');
  const activity = await Activity.findById(id);
  if (!activity) throw AppError.notFound('activity_not_found');
  if (!activity.creatorId.equals(req.userId)) throw AppError.forbidden('not_creator');
  if (activity.status !== 'live') return res.json({ ok: true, activity });

  activity.status = 'cancelled';
  await activity.save();
  await ActivityEvent.create({ activityId: activity._id, userId: req.userId, type: 'cancelled' });
  res.json({ ok: true, activity });
});

// POST /api/v1/activities/:id/join
const joinActivity = asyncHandler(async (req, res) => {
  const id = v.requireObjectId(req.params.id, 'id');
  const activity = await Activity.findById(id);
  if (!activity) throw AppError.notFound('activity_not_found');
  if (activity.status !== 'live' || activity.expiresAt <= new Date()) {
    throw AppError.badRequest('not_live', 'Activity is no longer live');
  }

  const [friendIds, squadIds] = await Promise.all([
    getFriendIdSet(req.userId),
    getSquadIdSet(req.userId),
  ]);
  if (!canSee(activity, req.userId, friendIds, squadIds)) {
    throw AppError.forbidden('cannot_view', 'This activity is not visible to you');
  }

  if (activity.participants.some((p) => p.userId.equals(req.userId))) {
    throw AppError.conflict('already_joined', 'Already a participant');
  }
  if (activity.maxParticipants && activity.participants.length >= activity.maxParticipants) {
    throw AppError.conflict('full', 'Activity is full');
  }

  // Enforce gender filter (skip for creator)
  if (activity.genderFilter && activity.genderFilter !== 'all' && !activity.creatorId.equals(req.userId)) {
    const joiner = await User.findById(req.userId).select('gender');
    const required = activity.genderFilter === 'women_only' ? 'female' : 'male';
    if (!joiner || joiner.gender !== required) {
      throw AppError.forbidden('gender_restricted', `This activity is ${activity.genderFilter.replace('_', ' ')}`);
    }
  }

  activity.participants.push({ userId: req.userId, joinedAt: new Date() });
  await activity.save();
  await ActivityEvent.create({ activityId: activity._id, userId: req.userId, type: 'joined' });

  res.json({ ok: true, activity });
});

// POST /api/v1/activities/:id/leave
const leaveActivity = asyncHandler(async (req, res) => {
  const id = v.requireObjectId(req.params.id, 'id');
  const activity = await Activity.findById(id);
  if (!activity) throw AppError.notFound('activity_not_found');
  if (activity.creatorId.equals(req.userId)) {
    throw AppError.badRequest('creator_leave', 'Creators cancel instead of leaving');
  }

  const before = activity.participants.length;
  activity.participants = activity.participants.filter((p) => !p.userId.equals(req.userId));
  if (activity.participants.length === before) {
    throw AppError.conflict('not_a_participant');
  }

  await activity.save();
  await ActivityEvent.create({ activityId: activity._id, userId: req.userId, type: 'left' });
  res.json({ ok: true, activity });
});

// POST /api/v1/activities/:id/leave-quietly  (no ActivityEvent — discreet exit)
const leaveQuietly = asyncHandler(async (req, res) => {
  const id = v.requireObjectId(req.params.id, 'id');
  const activity = await Activity.findById(id);
  if (!activity) throw AppError.notFound('activity_not_found');
  if (activity.creatorId.equals(req.userId)) {
    throw AppError.badRequest('creator_leave', 'Creators cancel instead of leaving');
  }

  const before = activity.participants.length;
  activity.participants = activity.participants.filter((p) => !p.userId.equals(req.userId));
  if (activity.participants.length === before) {
    throw AppError.conflict('not_a_participant');
  }

  await activity.save();
  // No ActivityEvent — silent exit, other participants are not notified
  res.json({ ok: true, activity });
});

// POST /api/v1/activities/:id/on-my-way
const onMyWay = asyncHandler(async (req, res) => {
  const id = v.requireObjectId(req.params.id, 'id');
  const result = await Activity.findOneAndUpdate(
    { _id: id, status: 'live', 'participants.userId': req.userId },
    { $set: { 'participants.$.onMyWayAt': new Date() } },
    { new: true },
  );
  if (!result) throw AppError.badRequest('not_a_participant', 'Join the activity first');
  await ActivityEvent.create({ activityId: id, userId: req.userId, type: 'on_my_way' });
  res.json({ ok: true, activity: result });
});

// POST /api/v1/activities/:id/arrived
const arrived = asyncHandler(async (req, res) => {
  const id = v.requireObjectId(req.params.id, 'id');
  const result = await Activity.findOneAndUpdate(
    { _id: id, 'participants.userId': req.userId },
    { $set: { 'participants.$.arrivedAt': new Date() } },
    { new: true },
  );
  if (!result) throw AppError.badRequest('not_a_participant');
  await ActivityEvent.create({ activityId: id, userId: req.userId, type: 'arrived' });
  res.json({ ok: true, activity: result });
});

// GET /api/v1/activities/past
const past = asyncHandler(async (req, res) => {
  const activities = await Activity.find({
    $and: [
      { $or: [{ creatorId: req.userId }, { 'participants.userId': req.userId }] },
      { $or: [{ status: { $in: ['expired', 'cancelled'] } }, { expiresAt: { $lte: new Date() } }] },
    ],
  })
    .sort({ expiresAt: -1 })
    .limit(20)
    .populate('creatorId', 'displayName username avatarUrl');
  res.json({ ok: true, activities });
});

// GET /api/v1/activities/pending-ratings  — activities with un-rated participants
const pendingRatings = asyncHandler(async (req, res) => {
  const activities = await Activity.find({
    $and: [
      { $or: [{ creatorId: req.userId }, { 'participants.userId': req.userId }] },
      { $or: [{ status: { $in: ['expired', 'cancelled'] } }, { expiresAt: { $lte: new Date() } }] },
    ],
  })
    .sort({ expiresAt: -1 })
    .limit(10)
    .populate('participants.userId', 'displayName username avatarUrl')
    .populate('creatorId', 'displayName username avatarUrl');

  if (activities.length === 0) return res.json({ ok: true, pending: [] });

  const activityIds = activities.map((a) => a._id);
  const myRatings = await Rating.find({ rater: req.userId, activity: { $in: activityIds } });
  const ratedSet = new Set(myRatings.map((r) => `${r.activity}-${r.ratee}`));

  const pending = [];
  for (const activity of activities) {
    const othersMap = new Map();
    const creator = activity.creatorId;
    if (creator && typeof creator === 'object' && !creator._id.equals(req.userId)) {
      const cid = String(creator._id);
      othersMap.set(cid, { _id: cid, displayName: creator.displayName, username: creator.username, avatarUrl: creator.avatarUrl });
    }
    for (const p of activity.participants) {
      const pu = p.userId;
      if (pu && typeof pu === 'object' && pu._id && !pu._id.equals(req.userId)) {
        const pid = String(pu._id);
        if (!othersMap.has(pid)) {
          othersMap.set(pid, { _id: pid, displayName: pu.displayName, username: pu.username, avatarUrl: pu.avatarUrl });
        }
      }
    }
    const unrated = [...othersMap.values()].filter((u) => !ratedSet.has(`${activity._id}-${u._id}`));
    if (unrated.length > 0) {
      pending.push({
        activity: { _id: String(activity._id), title: activity.title, type: activity.type, expiresAt: activity.expiresAt },
        unrated,
      });
    }
  }
  res.json({ ok: true, pending });
});

// POST /api/v1/activities/:id/rate  body: { userId, score }
const rateParticipant = asyncHandler(async (req, res) => {
  const activityId = v.requireObjectId(req.params.id, 'id');
  const rateeId = v.requireObjectId(req.body?.userId, 'userId');
  const score = v.requireNumber(req.body?.score, 'score', { min: 1, max: 5, integer: true });

  if (rateeId.equals(req.userId)) throw AppError.badRequest('cannot_rate_self', 'Cannot rate yourself');

  const activity = await Activity.findById(activityId);
  if (!activity) throw AppError.notFound('activity_not_found');
  if (activity.status === 'live' && activity.expiresAt > new Date()) {
    throw AppError.badRequest('activity_not_ended', 'Activity is still live');
  }

  const wasIn = (id) =>
    activity.creatorId.equals(id) || activity.participants.some((p) => p.userId.equals(id));

  if (!wasIn(req.userId)) throw AppError.forbidden('not_a_participant');
  if (!wasIn(rateeId)) throw AppError.badRequest('ratee_not_participant', 'That user was not in this activity');

  await Rating.findOneAndUpdate(
    { rater: req.userId, ratee: rateeId, activity: activityId },
    { score },
    { upsert: true },
  );

  const agg = await Rating.aggregate([
    { $match: { ratee: rateeId } },
    { $group: { _id: null, avg: { $avg: '$score' }, count: { $sum: 1 } } },
  ]);
  const avg = agg[0]?.avg ?? null;
  const count = agg[0]?.count ?? 0;
  await User.updateOne(
    { _id: rateeId },
    { averageRating: avg !== null ? Math.round(avg * 10) / 10 : null, ratingCount: count },
  );

  res.json({ ok: true });
});

// GET /api/v1/activities/user/:userId — recent public activities of another user
const byUser = asyncHandler(async (req, res) => {
  const targetId = v.requireObjectId(req.params.userId, 'userId');

  const friendIds = await getFriendIdSet(req.userId);
  const isFriend = friendIds.has(String(targetId));

  const visibilityFilter = isFriend
    ? { $in: ['public', 'friends'] }
    : 'public';

  const activities = await Activity.find({
    creatorId: targetId,
    visibility: visibilityFilter,
  })
    .sort({ createdAt: -1 })
    .limit(10)
    .select('title type status expiresAt startsAt participants creatorId');

  res.json({ ok: true, activities });
});

module.exports = {
  createActivity,
  nearby,
  mine,
  joined,
  getActivity,
  updateActivity,
  cancelActivity,
  joinActivity,
  leaveActivity,
  leaveQuietly,
  onMyWay,
  arrived,
  past,
  pendingRatings,
  rateParticipant,
  byUser,
};
