const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const v = require('../utils/validate');

const User = require('../models/User');
const Friendship = require('../models/Friendship');

function publicUser(u) {
  if (!u) return null;
  return {
    id: u._id,
    displayName: u.displayName,
    username: u.username,
    avatarUrl: u.avatarUrl,
    bio: u.bio,
    trustRate: u.trustRate,
  };
}

// Resolve a Friendship doc and return the "other" user from the requester's
// point of view. Throws 404 if no relationship exists.
async function findRelation(meId, otherId) {
  const pair = Friendship.pair(meId, otherId);
  const fs = await Friendship.findOne(pair);
  if (!fs) throw AppError.notFound('friendship_not_found');
  return fs;
}

// GET /api/v1/friends
const listFriends = asyncHandler(async (req, res) => {
  const friendships = await Friendship.find({
    status: 'accepted',
    $or: [{ userA: req.userId }, { userB: req.userId }],
  }).sort({ acceptedAt: -1 });

  const otherIds = friendships.map((f) => (f.userA.equals(req.userId) ? f.userB : f.userA));
  const users = await User.find({ _id: { $in: otherIds } }).select(
    'displayName username avatarUrl bio trustRate currentLocation privacy.ghostMode lastActiveAt',
  );
  const userMap = new Map(users.map((u) => [String(u._id), u]));

  const list = friendships.map((f) => {
    const otherId = f.userA.equals(req.userId) ? f.userB : f.userA;
    const u = userMap.get(String(otherId));
    return {
      friendshipId: f._id,
      since: f.acceptedAt,
      user: publicUser(u),
    };
  });

  res.json({ ok: true, friends: list });
});

// GET /api/v1/friends/requests?direction=incoming|outgoing
const listRequests = asyncHandler(async (req, res) => {
  const direction = req.query.direction === 'outgoing' ? 'outgoing' : 'incoming';

  const filter = { status: 'pending' };
  if (direction === 'incoming') {
    filter.requestedBy = { $ne: req.userId };
    filter.$or = [{ userA: req.userId }, { userB: req.userId }];
  } else {
    filter.requestedBy = req.userId;
  }

  const friendships = await Friendship.find(filter).sort({ createdAt: -1 });
  const ids = friendships.flatMap((f) => [f.userA, f.userB]);
  const users = await User.find({ _id: { $in: ids } }).select('displayName username avatarUrl');
  const userMap = new Map(users.map((u) => [String(u._id), u]));

  const list = friendships.map((f) => {
    const otherId = f.userA.equals(req.userId) ? f.userB : f.userA;
    return {
      friendshipId: f._id,
      requestedAt: f.createdAt,
      requestedBy: f.requestedBy,
      user: publicUser(userMap.get(String(otherId))),
    };
  });

  res.json({ ok: true, requests: list });
});

// POST /api/v1/friends/request   body: { userId } or { username }
const sendRequest = asyncHandler(async (req, res) => {
  let target = null;
  if (req.body?.userId) {
    target = await User.findById(v.requireObjectId(req.body.userId, 'userId'));
  } else if (req.body?.username) {
    const username = v.requireString(req.body.username, 'username').toLowerCase();
    target = await User.findOne({ username });
  } else {
    throw AppError.badRequest('missing_target', 'Provide userId or username');
  }
  if (!target) throw AppError.notFound('user_not_found');
  if (target._id.equals(req.userId)) throw AppError.badRequest('self_request', "Can't friend yourself");
  if (target.isBanned()) throw AppError.forbidden('target_banned', 'Cannot friend a banned user');

  const pair = Friendship.pair(req.userId, target._id);

  const existing = await Friendship.findOne(pair);
  if (existing) {
    if (existing.status === 'accepted') throw AppError.conflict('already_friends', 'Already friends');
    if (existing.status === 'blocked') throw AppError.forbidden('blocked', 'Cannot send request');
    if (existing.status === 'pending') {
      // If the *other* user already requested us, treat this call as accept.
      if (!existing.requestedBy.equals(req.userId)) {
        existing.status = 'accepted';
        existing.acceptedAt = new Date();
        await existing.save();
        return res.json({ ok: true, friendship: existing, autoAccepted: true });
      }
      throw AppError.conflict('already_pending', 'Request already pending');
    }
  }

  const fs = await Friendship.create({
    ...pair,
    status: 'pending',
    requestedBy: req.userId,
  });
  res.status(201).json({ ok: true, friendship: fs });
});

// POST /api/v1/friends/:userId/accept
const acceptRequest = asyncHandler(async (req, res) => {
  const otherId = v.requireObjectId(req.params.userId, 'userId');
  const fs = await findRelation(req.userId, otherId);

  if (fs.status !== 'pending') throw AppError.conflict('not_pending', 'No pending request to accept');
  if (fs.requestedBy.equals(req.userId)) {
    throw AppError.badRequest('cannot_accept_own', 'You sent this request — wait for the other user');
  }

  fs.status = 'accepted';
  fs.acceptedAt = new Date();
  await fs.save();
  res.json({ ok: true, friendship: fs });
});

// POST /api/v1/friends/:userId/reject  — also used to cancel an outgoing request
const rejectRequest = asyncHandler(async (req, res) => {
  const otherId = v.requireObjectId(req.params.userId, 'userId');
  const fs = await findRelation(req.userId, otherId);
  if (fs.status !== 'pending') throw AppError.conflict('not_pending', 'No pending request');
  await fs.deleteOne();
  res.json({ ok: true });
});

// DELETE /api/v1/friends/:userId
const removeFriend = asyncHandler(async (req, res) => {
  const otherId = v.requireObjectId(req.params.userId, 'userId');
  const fs = await findRelation(req.userId, otherId);
  if (fs.status !== 'accepted') throw AppError.conflict('not_friends', 'Not currently friends');
  await fs.deleteOne();
  res.json({ ok: true });
});

// POST /api/v1/friends/:userId/block
const blockUser = asyncHandler(async (req, res) => {
  const otherId = v.requireObjectId(req.params.userId, 'userId');
  if (otherId.equals(req.userId)) throw AppError.badRequest('self_block', "Can't block yourself");

  const pair = Friendship.pair(req.userId, otherId);
  const fs = await Friendship.findOneAndUpdate(
    pair,
    {
      $set: {
        status: 'blocked',
        blockedBy: req.userId,
        acceptedAt: null,
      },
      $setOnInsert: { ...pair, requestedBy: req.userId },
    },
    { upsert: true, new: true },
  );
  res.json({ ok: true, friendship: fs });
});

// POST /api/v1/friends/:userId/unblock
const unblockUser = asyncHandler(async (req, res) => {
  const otherId = v.requireObjectId(req.params.userId, 'userId');
  const fs = await findRelation(req.userId, otherId);
  if (fs.status !== 'blocked') throw AppError.conflict('not_blocked', 'User is not blocked');
  if (!fs.blockedBy?.equals(req.userId)) {
    throw AppError.forbidden('not_blocker', 'Only the user who blocked can unblock');
  }
  await fs.deleteOne();
  res.json({ ok: true });
});

module.exports = {
  listFriends,
  listRequests,
  sendRequest,
  acceptRequest,
  rejectRequest,
  removeFriend,
  blockUser,
  unblockUser,
};
