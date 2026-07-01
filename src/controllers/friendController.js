const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const v = require('../utils/validate');

const User = require('../models/User');
const Friendship = require('../models/Friendship');

function publicUser(u) {
  if (!u) return null;
  const id = String(u._id);
  return {
    _id: id,
    id,
    displayName: u.displayName,
    username: u.username,
    avatarUrl: u.avatarUrl,
    bio: u.bio,
    trustRate: u.trustRate,
    phone: u.phone,
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
      _id: String(f._id),
      since: f.acceptedAt,
      friend: publicUser(u),
    };
  });

  res.json({ ok: true, friends: list });
});

// GET /api/v1/friends/requests?direction=received|sent|rejected
const listRequests = asyncHandler(async (req, res) => {
  // Normalize legacy aliases
  const raw = req.query.direction ?? 'received';
  const direction = raw === 'incoming' ? 'received' : raw === 'outgoing' ? 'sent' : raw;

  let filter;
  if (direction === 'received') {
    // Pending requests sent TO me by others
    filter = { status: 'pending', requestedBy: { $ne: req.userId }, $or: [{ userA: req.userId }, { userB: req.userId }] };
  } else if (direction === 'sent') {
    // Pending requests I sent
    filter = { status: 'pending', requestedBy: req.userId };
  } else if (direction === 'rejected') {
    // Requests I sent that were rejected by the other person
    filter = { status: 'rejected', requestedBy: req.userId };
  } else {
    throw AppError.badRequest('invalid_direction', 'direction must be received, sent, or rejected');
  }

  const friendships = await Friendship.find(filter).sort({ createdAt: -1 });
  const ids = friendships.flatMap((f) => [f.userA, f.userB]);
  const users = await User.find({ _id: { $in: ids } }).select('displayName username avatarUrl');
  const userMap = new Map(users.map((u) => [String(u._id), u]));

  const list = friendships.map((f) => {
    const otherId = f.userA.equals(req.userId) ? f.userB : f.userA;
    return {
      _id: String(f._id),
      requestedAt: f.createdAt,
      rejectedAt: f.rejectedAt ?? null,
      requestedBy: String(f.requestedBy),
      friend: publicUser(userMap.get(String(otherId))),
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

  // Notify the person who sent the original request (fire-and-forget)
  const { notifyUser: _notifyFriend } = require('../services/notificationService');
  User.findById(req.userId).select('displayName username').then((acceptor) => {
    const name = acceptor?.displayName || acceptor?.username || 'Someone';
    _notifyFriend(fs.requestedBy, {
      title: '🤝 Friend request accepted!',
      body: `${name} accepted your friend request`,
      data: { type: 'friend_accept', userId: String(req.userId) },
    });
  }).catch(() => {});
});

// POST /api/v1/friends/:userId/reject  — also used to cancel an outgoing request
const rejectRequest = asyncHandler(async (req, res) => {
  const otherId = v.requireObjectId(req.params.userId, 'userId');
  const fs = await findRelation(req.userId, otherId);
  if (fs.status !== 'pending') throw AppError.conflict('not_pending', 'No pending request');

  if (fs.requestedBy.equals(req.userId)) {
    // Sender cancelling their own outgoing request → hard delete (no history)
    await fs.deleteOne();
  } else {
    // Recipient rejecting incoming request → soft delete so sender can see "rejected"
    fs.status = 'rejected';
    fs.rejectedAt = new Date();
    await fs.save();

    // Notify the requester (fire-and-forget, soft message to avoid hurt feelings)
    const { notifyUser: _notifyReject } = require('../services/notificationService');
    User.findById(req.userId).select('displayName username').then((rejector) => {
      const name = rejector?.displayName || rejector?.username || 'Someone';
      _notifyReject(fs.requestedBy, {
        title: 'Friend request update',
        body: `${name} isn't available to connect right now`,
        data: { type: 'friend_reject', userId: String(req.userId) },
      });
    }).catch(() => {});
  }
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

// GET /api/v1/friends/:userId/mutual
const mutualFriends = asyncHandler(async (req, res) => {
  const otherId = v.requireObjectId(req.params.userId, 'userId');

  // Get both users' accepted friend ID sets
  async function friendSet(uid) {
    const fs = await Friendship.find({
      status: 'accepted',
      $or: [{ userA: uid }, { userB: uid }],
    }).select('userA userB');
    const set = new Set();
    for (const f of fs) {
      set.add(String(f.userA.equals(uid) ? f.userB : f.userA));
    }
    return set;
  }

  const [myFriends, theirFriends] = await Promise.all([
    friendSet(req.userId),
    friendSet(otherId),
  ]);

  const mutualIds = [...myFriends].filter((id) => theirFriends.has(id));
  res.json({ ok: true, count: mutualIds.length, mutualIds });
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
  mutualFriends,
};
