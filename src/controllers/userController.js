const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const v = require('../utils/validate');

const User = require('../models/User');
const Friendship = require('../models/Friendship');
const Activity = require('../models/Activity');

// Fields the user can edit on their own profile.
const EDITABLE_FIELDS = [
  'displayName', 'username', 'bio', 'avatarUrl', 'dob', 'email', 'gender', 'city',
  'institute', 'hobbies', 'vibePreferences', 'favoriteActivities', 'socialPreference',
  'instagramHandle', 'photos', 'occupation', 'sleepType', 'spontaneity', 'foodPersonality',
  'timeRespect', 'distanceTolerance', 'availabilityPattern', 'intentSync', 'pingPitch', 'funTruth',
];

// PATCH /api/v1/users/me
const updateMe = asyncHandler(async (req, res) => {
  const update = {};

  if (req.body.displayName !== undefined) {
    update.displayName = v.requireString(req.body.displayName, 'displayName', { min: 1, max: 60 });
  }
  if (req.body.username !== undefined) {
    const u = v.requireString(req.body.username, 'username', { min: 3, max: 32 }).toLowerCase();
    if (!/^[a-z0-9_.]+$/.test(u)) {
      throw AppError.badRequest('invalid_username', 'username can only contain a-z, 0-9, _ and .');
    }
    update.username = u;
  }
  if (req.body.bio !== undefined) {
    update.bio = v.optionalString(req.body.bio, 'bio', { min: 0, max: 500 }) ?? '';
  }
  if (req.body.avatarUrl !== undefined) {
    update.avatarUrl = req.body.avatarUrl || null;
  }
  if (req.body.email !== undefined) {
    const e = (req.body.email || '').toString().trim().toLowerCase();
    if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
      throw AppError.badRequest('invalid_email', 'email is invalid');
    }
    update.email = e || null;
  }
  if (req.body.dob !== undefined) {
    const d = req.body.dob ? new Date(req.body.dob) : null;
    if (d && Number.isNaN(d.getTime())) throw AppError.badRequest('invalid_dob', 'dob is invalid');
    update.dob = d;
  }
  if (req.body.gender !== undefined) {
    const allowed = ['male', 'female', 'other'];
    if (req.body.gender && !allowed.includes(req.body.gender)) {
      throw AppError.badRequest('invalid_gender', 'gender must be male, female, or other');
    }
    update.gender = req.body.gender || null;
  }
  if (req.body.city !== undefined) {
    update.city = v.optionalString(req.body.city, 'city', { min: 0, max: 60 }) ?? null;
  }
  if (req.body.institute !== undefined) {
    update.institute = v.optionalString(req.body.institute, 'institute', { min: 0, max: 80 }) ?? null;
  }
  if (req.body.hobbies !== undefined) {
    if (!Array.isArray(req.body.hobbies)) throw AppError.badRequest('invalid_hobbies', 'hobbies must be an array');
    update.hobbies = req.body.hobbies.slice(0, 15).map((h) => String(h).trim()).filter(Boolean);
  }
  if (req.body.instagramHandle !== undefined) {
    const h = (req.body.instagramHandle || '').toString().trim().replace(/^@/, '');
    update.instagramHandle = h ? h.slice(0, 40) : null;
  }
  if (req.body.photos !== undefined) {
    if (!Array.isArray(req.body.photos)) throw AppError.badRequest('invalid_photos', 'photos must be an array');
    update.photos = req.body.photos.slice(0, 5).filter((p) => typeof p === 'string' && p.length > 0);
  }
  if (req.body.vibePreferences !== undefined) {
    if (!Array.isArray(req.body.vibePreferences)) throw AppError.badRequest('invalid_vibe_preferences', 'vibePreferences must be an array');
    update.vibePreferences = req.body.vibePreferences.slice(0, 8).map((h) => String(h).trim()).filter(Boolean);
  }
  if (req.body.favoriteActivities !== undefined) {
    if (!Array.isArray(req.body.favoriteActivities)) throw AppError.badRequest('invalid_favorite_activities', 'favoriteActivities must be an array');
    update.favoriteActivities = req.body.favoriteActivities.slice(0, 10).map((h) => String(h).trim()).filter(Boolean);
  }
  if (req.body.socialPreference !== undefined) {
    const allowed = ['introvert', 'extrovert', 'ambivert'];
    if (req.body.socialPreference && !allowed.includes(req.body.socialPreference)) {
      throw AppError.badRequest('invalid_social_preference', 'socialPreference must be introvert, extrovert, or ambivert');
    }
    update.socialPreference = req.body.socialPreference || null;
  }

  // Occupation & compatibility hooks — enum fields validated by simple inclusion check
  const enumFields = {
    occupation:          ['job', 'student', 'founder', 'business', 'freelancer', 'exploring'],
    sleepType:           ['night_owl', 'early_bird'],
    spontaneity:         ['planner', 'spontaneous'],
    foodPersonality:     ['street_food', 'balanced', 'cafe_aesthetic'],
    timeRespect:         ['always_early', 'on_time', 'fashionably_late'],
    distanceTolerance:   ['nearby', 'up_to_5km', 'travel_for_good_plans'],
    availabilityPattern: ['weekends_only', 'evenings_mostly', 'random_anytime'],
    intentSync:          ['just_hanging', 'activity_partner', 'trying_new_places', 'networking'],
  };
  for (const [field, allowed] of Object.entries(enumFields)) {
    if (req.body[field] !== undefined) {
      if (req.body[field] && !allowed.includes(req.body[field])) {
        throw AppError.badRequest(`invalid_${field}`, `${field} must be one of: ${allowed.join(', ')}`);
      }
      update[field] = req.body[field] || null;
    }
  }
  if (req.body.pingPitch !== undefined) {
    update.pingPitch = v.optionalString(req.body.pingPitch, 'pingPitch', { min: 0, max: 120 }) ?? null;
  }
  if (req.body.funTruth !== undefined) {
    update.funTruth = v.optionalString(req.body.funTruth, 'funTruth', { min: 0, max: 120 }) ?? null;
  }

  if (Object.keys(update).length === 0) {
    throw AppError.badRequest('no_changes', `Provide at least one of: ${EDITABLE_FIELDS.join(', ')}`);
  }

  const user = await User.findByIdAndUpdate(req.userId, update, {
    new: true, runValidators: true,
  });
  res.json({ ok: true, user });
});

// PATCH /api/v1/users/me/privacy
const updatePrivacy = asyncHandler(async (req, res) => {
  const update = {};
  if (req.body.ghostMode !== undefined) update['privacy.ghostMode'] = !!req.body.ghostMode;
  if (req.body.locationSharing !== undefined) update['privacy.locationSharing'] = !!req.body.locationSharing;
  if (req.body.autoShutoffAt !== undefined) {
    const t = req.body.autoShutoffAt ? new Date(req.body.autoShutoffAt) : null;
    if (t && Number.isNaN(t.getTime())) throw AppError.badRequest('invalid_autoshutoff', 'autoShutoffAt is invalid');
    update['privacy.autoShutoffAt'] = t;
  }

  if (Object.keys(update).length === 0) {
    throw AppError.badRequest('no_changes', 'Provide ghostMode, locationSharing, or autoShutoffAt');
  }

  const user = await User.findByIdAndUpdate(req.userId, { $set: update }, { new: true });
  res.json({ ok: true, privacy: user.privacy });
});

// POST /api/v1/users/me/location  body: { lat, lng }
const updateLocation = asyncHandler(async (req, res) => {
  const coords = v.requireLatLng(req.body?.lat, req.body?.lng);
  await User.updateOne(
    { _id: req.userId },
    {
      $set: {
        currentLocation: { type: 'Point', coordinates: coords },
        locationUpdatedAt: new Date(),
        lastActiveAt: new Date(),
      },
    },
  );
  res.json({ ok: true });

  // Fire-and-forget: notify if a ping participant is within 500 m
  (async () => {
    try {
      const { canSendNearby, markNearbySent, notifyUser } = require('../services/notificationService');
      if (!canSendNearby(req.userId)) return;

      const Activity = require('../models/Activity');
      const EARTH_R = 6378137;

      const pings = await Activity.find({
        status: 'live',
        expiresAt: { $gt: new Date() },
        'participants.userId': req.userId,
      }).select('participants title');
      if (!pings.length) return;

      const otherIds = [];
      for (const ping of pings) {
        for (const p of ping.participants) {
          if (!p.userId.equals(req.userId)) otherIds.push(p.userId);
        }
      }
      if (!otherIds.length) return;

      const nearbyUsers = await User.find({
        _id: { $in: otherIds },
        'privacy.ghostMode': { $ne: true },
        currentLocation: {
          $geoWithin: { $centerSphere: [coords, 500 / EARTH_R] },
        },
      }).select('displayName username');
      if (!nearbyUsers.length) return;

      markNearbySent(req.userId);
      const first = nearbyUsers[0];
      const name = first.displayName || first.username || 'Someone';
      const body = nearbyUsers.length === 1
        ? `${name} is less than 500 m away`
        : `${name} and ${nearbyUsers.length - 1} others are nearby`;
      notifyUser(req.userId, {
        title: '👋 Ping participant nearby!',
        body,
        data: { type: 'participant_nearby', userId: String(first._id) },
      });
    } catch (_) {}
  })();
});

// PUT /api/v1/users/me/push-token  body: { token } — stores Expo push token
const updatePushToken = asyncHandler(async (req, res) => {
  const token = req.body?.token ? String(req.body.token).trim() : null;
  await User.updateOne({ _id: req.userId }, { $set: { expoPushToken: token } });
  res.json({ ok: true });
});

// POST /api/v1/users/me/fcm-token  body: { token }
const addFcmToken = asyncHandler(async (req, res) => {
  const token = v.requireString(req.body?.token, 'token', { min: 10, max: 500 });
  await User.updateOne({ _id: req.userId }, { $addToSet: { fcmTokens: token } });
  res.json({ ok: true });
});

// DELETE /api/v1/users/me/fcm-token  body: { token }
const removeFcmToken = asyncHandler(async (req, res) => {
  const token = v.requireString(req.body?.token, 'token', { min: 10, max: 500 });
  await User.updateOne({ _id: req.userId }, { $pull: { fcmTokens: token } });
  res.json({ ok: true });
});

// DELETE /api/v1/users/me  — soft-delete account
const deleteMe = asyncHandler(async (req, res) => {
  // Hard-deleting a user with social/activity history is messy; the spec
  // (ADM.3) keeps deletion as an admin-only irreversible action. For the
  // self-serve route we anonymize + permanently disable instead.
  await User.updateOne(
    { _id: req.userId },
    {
      $set: {
        status: 'perm_banned',
        bannedUntil: null,
        displayName: 'Deleted user',
        username: null,
        avatarUrl: null,
        bio: '',
        email: null,
        fcmTokens: [],
        currentLocation: null,
      },
    },
  );
  res.json({ ok: true });
});

// GET /api/v1/users/:id  — public-ish profile of another user
const getUser = asyncHandler(async (req, res) => {
  const targetId = v.requireObjectId(req.params.id, 'id');
  const target = await User.findById(targetId);
  if (!target) throw AppError.notFound('user_not_found');

  const isSelf = targetId.equals(req.userId);
  let friendshipStatus;
  if (!isSelf) {
    const pair = Friendship.pair(req.userId, targetId);
    const fs = await Friendship.findOne(pair);
    if (!fs) {
      friendshipStatus = 'none';
    } else if (fs.status === 'pending') {
      friendshipStatus = fs.requestedBy.equals(req.userId) ? 'pending_sent' : 'pending_received';
    } else {
      friendshipStatus = fs.status; // 'accepted' | 'blocked'
    }
  } else {
    friendshipStatus = 'self';
  }

  const [completedPingsCount, me] = await Promise.all([
    Activity.countDocuments({ 'participants.userId': targetId, status: { $in: ['expired', 'completed'] } }),
    !isSelf ? User.findById(req.userId).select('savedProfiles').lean() : Promise.resolve(null),
  ]);
  const isSaved = me ? (me.savedProfiles ?? []).some((id) => String(id) === String(targetId)) : false;

  res.json({
    ok: true,
    user: {
      _id: String(target._id),
      id: String(target._id),
      displayName: target.displayName,
      username: target.username,
      avatarUrl: target.avatarUrl,
      bio: target.bio,
      gender: target.gender ?? null,
      dob: target.dob ?? null,
      city: target.city ?? null,
      institute: target.institute ?? null,
      hobbies: target.hobbies ?? [],
      vibePreferences: target.vibePreferences ?? [],
      favoriteActivities: target.favoriteActivities ?? [],
      socialPreference: target.socialPreference ?? null,
      instagramHandle: target.instagramHandle ?? null,
      photos: target.photos ?? [],
      averageRating: target.averageRating ?? null,
      ratingCount: target.ratingCount ?? 0,
      profileCompletion: target.profileCompletion ?? 0,
      trustRate: target.trustRate,
      status: target.status,
      createdAt: target.createdAt,
      phoneVerifiedAt: target.phoneVerifiedAt ?? null,
      completedPingsCount,
      isSaved,
      friendshipStatus,
    },
  });
});

// GET /api/v1/users/search?q=...
const searchUsers = asyncHandler(async (req, res) => {
  const q = (req.query.q || '').toString().trim();
  if (q.length < 2) throw AppError.badRequest('query_too_short', 'q must be at least 2 chars');

  const safe = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(safe, 'i');
  const users = await User.find({
    _id: { $ne: req.userId },
    status: { $in: ['active', 'warned'] },
    $or: [{ displayName: re }, { username: re }],
  })
    .limit(20)
    .select('displayName username avatarUrl bio trustRate');

  res.json({ ok: true, users });
});

// GET /api/v1/users/nearby?lat=&lng=&radius=
const nearbyUsers = asyncHandler(async (req, res) => {
  const coords = v.requireLatLng(req.query.lat, req.query.lng);
  const radius = req.query.radius
    ? v.requireNumber(req.query.radius, 'radius', { min: 100, max: 50_000, integer: true })
    : 5000;

  const EARTH_RADIUS_M = 6_371_000;

  // Find blocked relationships so we can exclude them
  const blockedRelations = await Friendship.find({
    $or: [{ user1: req.userId }, { user2: req.userId }],
    status: 'blocked',
  }).select('user1 user2');
  const excludedIds = new Set([String(req.userId)]);
  for (const rel of blockedRelations) {
    excludedIds.add(String(rel.user1));
    excludedIds.add(String(rel.user2));
  }

  const users = await User.find({
    _id: { $nin: [...excludedIds] },
    status: { $in: ['active', 'warned'] },
    currentLocation: {
      $geoWithin: {
        $centerSphere: [coords, radius / EARTH_RADIUS_M],
      },
    },
  })
    .limit(100)
    .select('displayName username avatarUrl bio trustRate');

  res.json({ ok: true, users });
});

// GET /api/v1/users/me/saved
const getSaved = asyncHandler(async (req, res) => {
  const me = await User.findById(req.userId).select('savedProfiles')
    .populate('savedProfiles', 'displayName username avatarUrl bio trustRate hobbies city vibePreferences socialPreference');
  res.json({ ok: true, users: me?.savedProfiles ?? [] });
});

// POST /api/v1/users/me/saved/:userId
const saveProfile = asyncHandler(async (req, res) => {
  const targetId = v.requireObjectId(req.params.userId, 'userId');
  if (targetId.equals(req.userId)) throw AppError.badRequest('cannot_save_self', 'Cannot save your own profile');
  await User.updateOne({ _id: req.userId }, { $addToSet: { savedProfiles: targetId } });
  res.json({ ok: true });
});

// DELETE /api/v1/users/me/saved/:userId
const unsaveProfile = asyncHandler(async (req, res) => {
  const targetId = v.requireObjectId(req.params.userId, 'userId');
  await User.updateOne({ _id: req.userId }, { $pull: { savedProfiles: targetId } });
  res.json({ ok: true });
});

// GET /api/v1/users/me/verification
const getVerificationStatus = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id)
    .select('verificationStatus verifiedAt verificationRejectionReason')
    .lean();
  res.json({ ok: true, ...user });
});

// POST /api/v1/users/me/verification
const submitVerification = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);
  if (!user) throw new AppError(404, 'not_found', 'User not found');
  if (user.verificationStatus === 'verified') {
    throw new AppError(400, 'already_verified', 'You are already verified');
  }
  if (user.verificationStatus === 'pending') {
    throw new AppError(400, 'already_pending', 'Your verification is already under review');
  }
  const selfieUrl = req.body.selfieUrl;
  if (!selfieUrl || typeof selfieUrl !== 'string') {
    throw new AppError(400, 'selfie_required', 'selfieUrl is required');
  }
  user.verificationStatus = 'pending';
  user.verificationSelfieUrl = selfieUrl;
  user.verificationRejectionReason = null;
  await user.save();
  res.json({ ok: true, verificationStatus: 'pending' });
});

module.exports = {
  updateMe,
  updatePrivacy,
  updateLocation,
  updatePushToken,
  addFcmToken,
  removeFcmToken,
  deleteMe,
  getUser,
  searchUsers,
  nearbyUsers,
  getSaved,
  saveProfile,
  unsaveProfile,
  getVerificationStatus,
  submitVerification,
};
