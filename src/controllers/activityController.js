const mongoose = require('mongoose');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const v = require('../utils/validate');
const { ACTIVITY_TYPES, ACTIVITY_VISIBILITY, ACTIVITY_GENDER_FILTER, ACTIVITY_VIBES } = require('../utils/enums');

const Activity = require('../models/Activity');
const ActivityEvent = require('../models/ActivityEvent');
const Friendship = require('../models/Friendship');
const Rating = require('../models/Rating');
const Squad = require('../models/Squad');
const User = require('../models/User');
const subscriptionService = require('../services/subscriptionService');

const DEFAULT_DURATION_MIN = 60;
const MAX_DURATION_MIN = 12 * 60;
const EARTH_RADIUS_M = 6378137;

function haversineMeters(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

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
// Identity verification is mandatory before creating or joining pings
async function assertVerified(userId) {
  const me = await User.findById(userId).select('verificationStatus');
  if (me?.verificationStatus !== 'verified') {
    throw AppError.forbidden('verification_required', 'Complete identity verification to create or join pings');
  }
}

const createActivity = asyncHandler(async (req, res) => {
  await assertVerified(req.userId);
  await subscriptionService.assertCanCreatePing(req.userId);

  // Direct ping to a non-friend requires Pro+
  if (req.body?.directToUserId) {
    await subscriptionService.assertCanDirectPing(req.userId);
  }

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

  // Block only if the new ping overlaps in time with an existing live ping the user created
  const existingOverlap = await Activity.findOne({
    creatorId: req.userId,
    status: 'live',
    startsAt: { $lt: expiresAt },
    expiresAt: { $gt: startsAt },
  });
  if (existingOverlap) {
    throw AppError.conflict('active_ping_exists', 'You already have a ping during that time. Cancel it first or choose a different time.');
  }

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

  const placeName = v.requireString(req.body?.placeName, 'placeName', { min: 2, max: 120 });
  const notes = v.optionalString(req.body?.notes, 'notes', { max: 300 }) ?? '';
  const imageUrl = v.optionalString(req.body?.imageUrl, 'imageUrl', { max: 500 }) ?? null;
  const rawVibe = req.body?.vibe ?? null;
  const vibe = rawVibe && ACTIVITY_VIBES.includes(rawVibe) ? rawVibe : null;
  const markerIcon = v.optionalString(req.body?.markerIcon, 'markerIcon', { max: 50 }) ?? null;

  const activity = await Activity.create({
    creatorId: req.userId,
    type,
    title,
    description,
    notes,
    imageUrl,
    vibe,
    markerIcon,
    location: { type: 'Point', coordinates: coords },
    placeName,
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
  await subscriptionService.bumpCreate(req.userId);

  // First ping bonus: bump trustRate into 80-85 range
  const pingCount = await Activity.countDocuments({ creatorId: req.userId });
  if (pingCount === 1) {
    const bonus = 80 + Math.floor(Math.random() * 6);
    await User.updateOne({ _id: req.userId, trustRate: { $lt: bonus } }, { $set: { trustRate: bonus } });
  }

  res.status(201).json({ ok: true, activity });

  // Fire-and-forget: notify nearby / interest-matched users about the new ping
  if (activity.visibility === 'public') {
    (async () => {
      try {
        const { notifyTokens, canSendPingNew, markPingNewSent } = require('../services/notificationService');
        const [lng, lat] = activity.location.coordinates;
        const notifyRadius = Math.min(Math.max(activity.radiusMeters * 4, 2500), 10_000);

        const creator = await User.findById(req.userId).select('displayName username').lean();
        const creatorName = creator?.displayName || creator?.username || 'Someone';
        const typeLabel = activity.type.charAt(0).toUpperCase() + activity.type.slice(1);

        // Nearby users who have a push token and a known location
        const nearbyUsers = await User.find({
          _id: { $ne: req.userId },
          expoPushToken: { $exists: true, $ne: null },
          currentLocation: {
            $near: {
              $geometry: { type: 'Point', coordinates: [lng, lat] },
              $maxDistance: notifyRadius,
            },
          },
        }).select('_id expoPushToken hobbies favoriteActivities').limit(80).lean();

        // Interest match: user shares the ping's activity type or vibe
        const interestMatch = (user) => {
          if (!activity.type || activity.type === 'other') return true; // always notify for generic
          const interests = [
            ...(user.hobbies ?? []),
            ...(user.favoriteActivities ?? []),
          ].map((s) => s.toLowerCase());
          return interests.length === 0 || interests.some((i) => i.includes(activity.type));
        };

        const eligible = nearbyUsers.filter(
          (u) => canSendPingNew(u._id) && interestMatch(u),
        );

        eligible.forEach((u) => markPingNewSent(u._id));

        await notifyTokens(
          eligible.map((u) => u.expoPushToken).filter(Boolean),
          {
            title: `📍 New ${typeLabel} ping nearby`,
            body: `${creatorName} dropped a ping: "${activity.title}"`,
            data: { type: 'ping_new', activityId: String(activity._id) },
          },
        );
      } catch (_) {}
    })();
  }
});

// GET /api/v1/activities/nearby?lat=&lng=&radius=
const nearby = asyncHandler(async (req, res) => {
  const coords = v.requireLatLng(req.query.lat, req.query.lng);
  // radius=0 or absent → no distance cap (show all active pings)
  const radius = req.query.radius
    ? v.requireNumber(req.query.radius, 'radius', { min: 50, max: 50_000, integer: true })
    : null;

  const [friendIds, squadIds] = await Promise.all([
    getFriendIdSet(req.userId),
    getSquadIdSet(req.userId),
  ]);

  // Gender is enforced at join time only — everyone can see all pings
  const visibilityFilter = {
    $or: [
      { creatorId: req.userId },
      { visibility: 'public' },
      { visibility: 'friends', creatorId: { $in: [...friendIds] } },
      { visibility: 'squad', squadId: { $in: [...squadIds] } },
    ],
  };

  const locationQuery = radius
    ? { $near: { $geometry: { type: 'Point', coordinates: coords }, $maxDistance: radius } }
    : { $near: { $geometry: { type: 'Point', coordinates: coords } } };

  const docs = await Activity.find({
    status: 'live',
    expiresAt: { $gt: new Date() },
    creatorId: { $ne: req.userId },
    location: locationQuery,
    ...visibilityFilter,
  })
    .limit(200)
    .populate('creatorId', 'displayName username avatarUrl trustRate ratingCount createdAt')
    .populate('participants.userId', 'displayName username avatarUrl');

  const [lng, lat] = coords;
  const activities = docs.map((doc) => {
    const a = doc.toObject({ virtuals: true });
    const [pLng, pLat] = a.location?.coordinates ?? [];
    if (typeof pLat === 'number' && typeof pLng === 'number') {
      a.distance = Math.round(haversineMeters(lat, lng, pLat, pLng));
    }
    return a;
  });

  res.json({ ok: true, activities });
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

  const activities = await Activity.find(filter)
    .sort({ createdAt: -1 })
    .limit(100)
    .populate('creatorId', 'displayName username avatarUrl trustRate ratingCount createdAt')
    .populate('participants.userId', 'displayName username avatarUrl');
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
    .populate('creatorId', 'displayName username avatarUrl trustRate ratingCount createdAt')
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

  // Snapshot participant IDs before save so we can notify them after
  const participantIds = activity.participants
    .map((p) => p.userId)
    .filter((id) => !id.equals(req.userId));

  activity.status = 'cancelled';
  await activity.save();
  await ActivityEvent.create({ activityId: activity._id, userId: req.userId, type: 'cancelled' });
  res.json({ ok: true, activity });

  // Notify all participants (fire-and-forget)
  if (participantIds.length) {
    const { notifyMany: _notifyMany } = require('../services/notificationService');
    User.findById(req.userId).select('displayName username').then((creator) => {
      const name = creator?.displayName || creator?.username || 'Someone';
      _notifyMany(participantIds, {
        title: '❌ Ping cancelled',
        body: `${name} cancelled "${activity.title}"`,
        data: { type: 'ping_cancel', activityId: String(activity._id) },
      });
    }).catch(() => {});
  }
});

// POST /api/v1/activities/:id/join
const joinActivity = asyncHandler(async (req, res) => {
  if (!req.body?.soloAcknowledged) {
    throw AppError.badRequest('solo_ack_required', 'You must confirm you will attend alone before joining');
  }

  await assertVerified(req.userId);
  await subscriptionService.assertCanJoinPing(req.userId);

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
    const required = activity.genderFilter === 'women_only' ? 'female' : activity.genderFilter === 'men_only' ? 'male' : 'other';
    if (!joiner || joiner.gender !== required) {
      const label = activity.genderFilter === 'women_only' ? 'women only' : activity.genderFilter === 'men_only' ? 'men only' : 'others only';
      throw AppError.forbidden('gender_restricted', `This ping is ${label} — you can view it but not join.`);
    }
  }

  // Block rapid join cycling — if user joined and left this activity within last 10 minutes, block
  const recentEvent = await ActivityEvent.findOne({
    activityId: id,
    userId: req.userId,
    type: { $in: ['joined', 'left'] },
    createdAt: { $gte: new Date(Date.now() - 10 * 60 * 1000) },
  }).sort({ createdAt: -1 });
  if (recentEvent && recentEvent.type === 'left') {
    throw AppError.badRequest('rejoin_cooldown', 'Please wait 10 minutes before rejoining a ping you recently left.');
  }

  activity.participants.push({ userId: req.userId, joinedAt: new Date(), soloAcknowledgedAt: new Date() });
  await activity.save();
  await ActivityEvent.create({ activityId: activity._id, userId: req.userId, type: 'joined' });
  await subscriptionService.bumpJoin(req.userId);

  res.json({ ok: true, activity });

  // Notify the ping creator (fire-and-forget)
  const { notifyUser: _notify } = require('../services/notificationService');
  User.findById(req.userId).select('displayName username').then((joiner) => {
    const name = joiner?.displayName || joiner?.username || 'Someone';
    _notify(activity.creatorId, {
      title: '🎉 Someone joined your Ping!',
      body: `${name} joined "${activity.title}"`,
      data: { type: 'ping_join', activityId: String(activity._id) },
    });
  }).catch(() => {});
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
  const newTrustRate =
    avg !== null && count > 0
      ? Math.max(70, Math.min(100, Math.round((avg / 5) * 100 * (1 - Math.exp(-count / 5)))))
      : 70;
  await User.updateOne(
    { _id: rateeId },
    {
      averageRating: avg !== null ? Math.round(avg * 10) / 10 : null,
      ratingCount: count,
      trustRate: newTrustRate,
    },
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
