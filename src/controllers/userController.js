const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const v = require('../utils/validate');

const User = require('../models/User');
const Friendship = require('../models/Friendship');

// Fields the user can edit on their own profile.
const EDITABLE_FIELDS = ['displayName', 'username', 'bio', 'avatarUrl', 'dob', 'email', 'gender'];

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
    update.bio = v.optionalString(req.body.bio, 'bio', { min: 0, max: 280 }) ?? '';
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

  let friendshipStatus;
  if (!targetId.equals(req.userId)) {
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

  res.json({
    ok: true,
    user: {
      _id: String(target._id),
      id: String(target._id),
      displayName: target.displayName,
      username: target.username,
      avatarUrl: target.avatarUrl,
      bio: target.bio,
      trustRate: target.trustRate,
      status: target.status,
      createdAt: target.createdAt,
      phoneVerifiedAt: target.phoneVerifiedAt ?? null,
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

module.exports = {
  updateMe,
  updatePrivacy,
  updateLocation,
  addFcmToken,
  removeFcmToken,
  deleteMe,
  getUser,
  searchUsers,
};
