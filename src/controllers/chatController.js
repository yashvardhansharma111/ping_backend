const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const v = require('../utils/validate');
const { MESSAGE_TYPE } = require('../utils/enums');

const ChatRoom = require('../models/ChatRoom');
const Message = require('../models/Message');
const User = require('../models/User');
const Friendship = require('../models/Friendship');
const Activity = require('../models/Activity');
const Squad = require('../models/Squad');

const PAGE_SIZE = 50;
const MAX_GROUP_MEMBERS = 50;

function isMember(room, userId) {
  return room.participantIds.some((p) => {
    const id = p._id || p;
    return id.equals ? id.equals(userId) : String(id) === String(userId);
  });
}

async function resolveOwnerId(room) {
  if (room.kind === 'activity' && room.activityId) {
    const activityId = room.activityId._id || room.activityId;
    const activity = await Activity.findById(activityId).select('creatorId');
    return activity?.creatorId || null;
  }
  if (room.kind === 'squad' && room.squadId) {
    const squadId = room.squadId._id || room.squadId;
    const squad = await Squad.findById(squadId).select('ownerId');
    return squad?.ownerId || null;
  }
  return null;
}

async function requireGroupOwner(room, userId) {
  if (room.kind === 'dm') {
    throw AppError.badRequest('dm_immutable', 'DM chats cannot be managed like a group');
  }
  const ownerId = await resolveOwnerId(room);
  if (!ownerId || !ownerId.equals(userId)) {
    throw AppError.forbidden('not_owner', 'Only the group owner can do this');
  }
  return ownerId;
}

function displayNameFromRoom(room) {
  if (room.name) return room.name;
  if (room.kind === 'activity' && room.activityId?.title) return room.activityId.title;
  if (room.kind === 'squad' && room.squadId?.name) return room.squadId.name;
  if (room.kind === 'activity') return 'Activity Chat';
  if (room.kind === 'squad') return 'Squad Chat';
  return 'Chat';
}

function displayAvatarFromRoom(room) {
  if (room.avatarUrl) return room.avatarUrl;
  if (room.kind === 'activity' && room.activityId?.imageUrl) return room.activityId.imageUrl;
  if (room.kind === 'squad' && room.squadId?.avatarUrl) return room.squadId.avatarUrl;
  return null;
}

async function shapeRoom(roomDoc, userId) {
  const room = roomDoc.toObject ? roomDoc.toObject() : { ...roomDoc };
  const ownerId = await resolveOwnerId(roomDoc);
  room.name = displayNameFromRoom(roomDoc);
  room.avatarUrl = displayAvatarFromRoom(roomDoc);
  room.ownerId = ownerId ? String(ownerId) : null;
  room.isOwner = !!(ownerId && ownerId.equals(userId));
  if (room.activityId && typeof room.activityId === 'object') {
    room.activityId = String(room.activityId._id || room.activityId);
  }
  if (room.squadId && typeof room.squadId === 'object') {
    room.squadId = String(room.squadId._id || room.squadId);
  }
  return room;
}

const ROOM_POPULATE = [
  { path: 'participantIds', select: 'displayName username avatarUrl' },
  { path: 'activityId', select: 'title imageUrl creatorId' },
  { path: 'squadId', select: 'name avatarUrl ownerId' },
];

async function validateFriendIds(meId, candidateIds) {
  const ids = [...new Set(candidateIds.map(String))]
    .filter((id) => id !== String(meId))
    .map((id) => v.requireObjectId(id, 'userId'));

  if (ids.length === 0) return [];

  const users = await User.find({ _id: { $in: ids } }).select('_id status');
  if (users.length !== ids.length) {
    throw AppError.badRequest('user_not_found', 'One or more users do not exist');
  }
  if (users.some((u) => u.status === 'perm_banned')) {
    throw AppError.forbidden('member_banned', 'Cannot add a banned user');
  }

  const pairs = ids.map((other) => Friendship.pair(meId, other));
  const friendships = await Friendship.find({
    status: 'accepted',
    $or: pairs.map((p) => ({ userA: p.userA, userB: p.userB })),
  }).select('userA userB');
  const friendIds = new Set(
    friendships.map((f) => (f.userA.equals(meId) ? String(f.userB) : String(f.userA))),
  );
  const notFriends = ids.filter((id) => !friendIds.has(String(id)));
  if (notFriends.length) {
    throw AppError.forbidden('not_friends', 'You can only invite accepted friends');
  }
  return ids;
}

async function postSystemMessage(roomId, body, senderId) {
  const msg = await Message.create({
    roomId,
    senderId,
    type: 'system',
    body,
    readBy: [{ userId: senderId, readAt: new Date() }],
  });
  await ChatRoom.updateOne(
    { _id: roomId },
    { lastMessageAt: msg.createdAt, lastMessagePreview: body.slice(0, 80) },
  );
  return msg;
}

// GET /api/v1/chat/rooms
const listRooms = asyncHandler(async (req, res) => {
  const rooms = await ChatRoom.find({ participantIds: req.userId })
    .sort({ lastMessageAt: -1 })
    .limit(100)
    .populate(ROOM_POPULATE);
  const shaped = await Promise.all(rooms.map((r) => shapeRoom(r, req.userId)));
  res.json({ ok: true, rooms: shaped });
});

// POST /api/v1/chat/rooms/dm   body: { userId }
const openDm = asyncHandler(async (req, res) => {
  const otherId = v.requireObjectId(req.body?.userId, 'userId');
  if (otherId.equals(req.userId)) throw AppError.badRequest('self_dm', "Can't DM yourself");

  const other = await User.findById(otherId);
  if (!other) throw AppError.notFound('user_not_found');

  const fs = await Friendship.findOne(Friendship.pair(req.userId, otherId));
  if (fs?.status === 'blocked') throw AppError.forbidden('blocked', 'Cannot DM this user');
  if (!fs || fs.status !== 'accepted') {
    throw AppError.forbidden('not_friends', 'You must be friends to DM');
  }

  const participantIds = [req.userId, otherId].sort((a, b) => String(a).localeCompare(String(b)));

  let room = await ChatRoom.findOne({
    kind: 'dm',
    participantIds: { $all: participantIds, $size: 2 },
  });
  if (!room) {
    room = await ChatRoom.create({ kind: 'dm', participantIds, lastMessageAt: new Date() });
  }
  room = await ChatRoom.findById(room._id).populate(ROOM_POPULATE);
  res.json({ ok: true, room: await shapeRoom(room, req.userId) });
});

// POST /api/v1/chat/rooms/activity/:activityId
const openActivityRoom = asyncHandler(async (req, res) => {
  const activityId = v.requireObjectId(req.params.activityId, 'activityId');
  const activity = await Activity.findById(activityId);
  if (!activity) throw AppError.notFound('activity_not_found');

  const isCreator = activity.creatorId.equals(req.userId);
  const isParticipant = activity.participants.some((p) => p.userId.equals(req.userId));
  if (!isCreator && !isParticipant) {
    throw AppError.forbidden('not_a_participant', 'Join the activity first');
  }

  const memberIds = [activity.creatorId, ...activity.participants.map((p) => p.userId)];
  const uniq = [...new Map(memberIds.map((id) => [String(id), id])).values()];

  let room;
  try {
    room = await ChatRoom.findOneAndUpdate(
      { activityId },
      {
        $setOnInsert: {
          kind: 'activity',
          lastMessageAt: new Date(),
          name: activity.title,
          avatarUrl: activity.imageUrl || null,
        },
        $addToSet: { participantIds: { $each: uniq } },
      },
      { upsert: true, new: true, setDefaultsOnInsert: false },
    );
  } catch (err) {
    if (err.code === 11000) {
      room = await ChatRoom.findOne({ activityId });
      if (!room) throw err;
    } else {
      throw err;
    }
  }
  room = await ChatRoom.findById(room._id).populate(ROOM_POPULATE);
  res.json({ ok: true, room: await shapeRoom(room, req.userId) });
});

// POST /api/v1/chat/rooms/squad/:squadId
const openSquadRoom = asyncHandler(async (req, res) => {
  const squadId = v.requireObjectId(req.params.squadId, 'squadId');
  const squad = await Squad.findById(squadId);
  if (!squad) throw AppError.notFound('squad_not_found');
  if (!squad.memberIds.some((m) => m.equals(req.userId))) {
    throw AppError.forbidden('not_squad_member');
  }

  let room = await ChatRoom.findOne({ squadId });
  if (!room) {
    room = await ChatRoom.create({
      kind: 'squad',
      squadId,
      participantIds: squad.memberIds,
      name: squad.name,
      avatarUrl: squad.avatarUrl || null,
      lastMessageAt: new Date(),
    });
  } else {
    const set = new Set(room.participantIds.map(String));
    const toAdd = squad.memberIds.filter((id) => !set.has(String(id)));
    if (toAdd.length) {
      room.participantIds.push(...toAdd);
      await room.save();
    }
  }
  room = await ChatRoom.findById(room._id).populate(ROOM_POPULATE);
  res.json({ ok: true, room: await shapeRoom(room, req.userId) });
});

// GET /api/v1/chat/rooms/:id
const getRoom = asyncHandler(async (req, res) => {
  const id = v.requireObjectId(req.params.id, 'id');
  const room = await ChatRoom.findById(id).populate(ROOM_POPULATE);
  if (!room) throw AppError.notFound('room_not_found');
  if (!isMember(room, req.userId)) throw AppError.forbidden('not_a_participant');
  res.json({ ok: true, room: await shapeRoom(room, req.userId) });
});

// PATCH /api/v1/chat/rooms/:id  body: { name?, avatarUrl? }
const updateRoom = asyncHandler(async (req, res) => {
  const id = v.requireObjectId(req.params.id, 'id');
  const room = await ChatRoom.findById(id);
  if (!room) throw AppError.notFound('room_not_found');
  if (!isMember(room, req.userId)) throw AppError.forbidden('not_a_participant');
  await requireGroupOwner(room, req.userId);

  const me = await User.findById(req.userId).select('displayName username');
  const actor = me?.displayName || me?.username || 'Owner';

  if (req.body?.name !== undefined) {
    const name = v.requireString(req.body.name, 'name', { min: 1, max: 60 });
    room.name = name;
    await postSystemMessage(room._id, `${actor} renamed the group to "${name}"`, req.userId);
  }
  if (req.body?.avatarUrl !== undefined) {
    const url = req.body.avatarUrl
      ? v.requireString(req.body.avatarUrl, 'avatarUrl', { min: 5, max: 500 })
      : null;
    room.avatarUrl = url;
    await postSystemMessage(room._id, `${actor} updated the group photo`, req.userId);
  }

  await room.save();

  if (room.kind === 'activity' && room.activityId) {
    const patch = {};
    if (req.body?.name !== undefined) patch.title = room.name;
    if (req.body?.avatarUrl !== undefined) patch.imageUrl = room.avatarUrl;
    if (Object.keys(patch).length) await Activity.updateOne({ _id: room.activityId }, { $set: patch });
  }
  if (room.kind === 'squad' && room.squadId) {
    const patch = {};
    if (req.body?.name !== undefined) patch.name = room.name;
    if (req.body?.avatarUrl !== undefined) patch.avatarUrl = room.avatarUrl;
    if (Object.keys(patch).length) await Squad.updateOne({ _id: room.squadId }, { $set: patch });
  }

  const fresh = await ChatRoom.findById(id).populate(ROOM_POPULATE);
  res.json({ ok: true, room: await shapeRoom(fresh, req.userId) });
});

// POST /api/v1/chat/rooms/:id/members  body: { userIds: [] }
const addMembers = asyncHandler(async (req, res) => {
  const id = v.requireObjectId(req.params.id, 'id');
  const room = await ChatRoom.findById(id);
  if (!room) throw AppError.notFound('room_not_found');
  if (!isMember(room, req.userId)) throw AppError.forbidden('not_a_participant');
  await requireGroupOwner(room, req.userId);

  const candidates = Array.isArray(req.body?.userIds) ? req.body.userIds : [];
  if (candidates.length === 0) throw AppError.badRequest('no_members', 'userIds is required');

  const validIds = await validateFriendIds(req.userId, candidates);
  const existing = new Set(room.participantIds.map(String));
  const toAdd = validIds.filter((uid) => !existing.has(String(uid)));

  if (room.participantIds.length + toAdd.length > MAX_GROUP_MEMBERS) {
    throw AppError.badRequest('too_many_members', `Group would exceed ${MAX_GROUP_MEMBERS} members`);
  }

  if (toAdd.length === 0) {
    const fresh = await ChatRoom.findById(id).populate(ROOM_POPULATE);
    return res.json({ ok: true, room: await shapeRoom(fresh, req.userId), added: 0 });
  }

  if (room.kind === 'activity' && room.activityId) {
    const activity = await Activity.findById(room.activityId);
    if (activity?.maxParticipants) {
      const current = 1 + (activity.participants?.length || 0);
      if (current + toAdd.length > activity.maxParticipants) {
        throw AppError.badRequest('activity_full', 'Activity is at capacity');
      }
    }
    if (activity) {
      for (const uid of toAdd) {
        if (!activity.participants.some((p) => p.userId.equals(uid)) && !activity.creatorId.equals(uid)) {
          activity.participants.push({ userId: uid, joinedAt: new Date() });
        }
      }
      await activity.save();
    }
  }

  if (room.kind === 'squad' && room.squadId) {
    const squad = await Squad.findById(room.squadId);
    if (squad) {
      const set = new Set(squad.memberIds.map(String));
      for (const uid of toAdd) {
        if (!set.has(String(uid))) squad.memberIds.push(uid);
      }
      squad.lastActivityAt = new Date();
      await squad.save();
    }
  }

  room.participantIds.push(...toAdd);
  await room.save();

  const addedUsers = await User.find({ _id: { $in: toAdd } }).select('displayName username');
  const names = addedUsers.map((u) => u.displayName || u.username || 'Someone').join(', ');
  const me = await User.findById(req.userId).select('displayName username');
  const actor = me?.displayName || me?.username || 'Owner';
  await postSystemMessage(room._id, `${actor} added ${names}`, req.userId);

  const fresh = await ChatRoom.findById(id).populate(ROOM_POPULATE);
  res.json({ ok: true, room: await shapeRoom(fresh, req.userId), added: toAdd.length });
});

// DELETE /api/v1/chat/rooms/:id/members/:userId
const removeMember = asyncHandler(async (req, res) => {
  const id = v.requireObjectId(req.params.id, 'id');
  const targetId = v.requireObjectId(req.params.userId, 'userId');
  const room = await ChatRoom.findById(id);
  if (!room) throw AppError.notFound('room_not_found');
  if (!isMember(room, req.userId)) throw AppError.forbidden('not_a_participant');

  if (room.kind === 'dm') {
    throw AppError.badRequest('dm_immutable', 'Cannot remove members from a DM');
  }

  const isSelf = targetId.equals(req.userId);
  if (!isSelf) await requireGroupOwner(room, req.userId);

  const ownerId = await resolveOwnerId(room);
  if (ownerId && ownerId.equals(targetId) && !isSelf) {
    throw AppError.badRequest('cannot_remove_owner', 'Cannot remove the group owner');
  }
  if (ownerId && ownerId.equals(targetId) && isSelf) {
    throw AppError.badRequest('owner_cannot_leave', 'Owner cannot leave — transfer or end the group first');
  }

  if (!isMember(room, targetId)) {
    throw AppError.badRequest('not_in_room', 'User is not in this group');
  }

  room.participantIds = room.participantIds.filter((p) => !p.equals(targetId));
  await room.save();

  if (room.kind === 'activity' && room.activityId) {
    await Activity.updateOne(
      { _id: room.activityId },
      { $pull: { participants: { userId: targetId } } },
    );
  }
  if (room.kind === 'squad' && room.squadId) {
    await Squad.updateOne({ _id: room.squadId }, { $pull: { memberIds: targetId } });
  }

  const target = await User.findById(targetId).select('displayName username');
  const targetName = target?.displayName || target?.username || 'Someone';
  if (isSelf) {
    await postSystemMessage(room._id, `${targetName} left`, req.userId);
  } else {
    const me = await User.findById(req.userId).select('displayName username');
    const actor = me?.displayName || me?.username || 'Owner';
    await postSystemMessage(room._id, `${actor} removed ${targetName}`, req.userId);
  }

  const fresh = await ChatRoom.findById(id).populate(ROOM_POPULATE);
  res.json({ ok: true, room: fresh ? await shapeRoom(fresh, req.userId) : null, left: isSelf });
});

const listMessages = asyncHandler(async (req, res) => {
  const id = v.requireObjectId(req.params.id, 'id');
  const room = await ChatRoom.findById(id);
  if (!room) throw AppError.notFound('room_not_found');
  if (!isMember(room, req.userId)) throw AppError.forbidden('not_a_participant');

  const limit = Math.min(parseInt(req.query.limit, 10) || PAGE_SIZE, 100);
  const filter = { roomId: id, deletedAt: null };
  if (req.query.before) {
    const before = new Date(req.query.before);
    if (Number.isNaN(before.getTime())) throw AppError.badRequest('invalid_before');
    filter.createdAt = { $lt: before };
  }

  const messages = await Message.find(filter)
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate('senderId', 'displayName username avatarUrl');

  res.json({ ok: true, messages: messages.reverse() });
});

const sendMessage = asyncHandler(async (req, res) => {
  const id = v.requireObjectId(req.params.id, 'id');
  const room = await ChatRoom.findById(id);
  if (!room) throw AppError.notFound('room_not_found');
  if (!isMember(room, req.userId)) throw AppError.forbidden('not_a_participant');

  const type = req.body?.type
    ? v.requireEnum(req.body.type, 'type', MESSAGE_TYPE)
    : 'text';

  const data = {
    roomId: id,
    senderId: req.userId,
    type,
    readBy: [{ userId: req.userId, readAt: new Date() }],
  };

  let preview = '';
  if (type === 'text') {
    const body = v.requireString(req.body?.body, 'body', { min: 1, max: 4000 });
    data.body = body;
    preview = body.slice(0, 80);
  } else if (type === 'image') {
    const mediaUrl = v.requireString(req.body?.mediaUrl, 'mediaUrl', { min: 5, max: 1000 });
    data.mediaUrl = mediaUrl;
    data.body = (req.body?.body || '').toString().slice(0, 4000);
    preview = '📷 Photo';
  } else if (type === 'location') {
    const coords = v.requireLatLng(req.body?.lat, req.body?.lng);
    data.location = { type: 'Point', coordinates: coords };
    preview = '📍 Location';
  } else if (type === 'system') {
    throw AppError.forbidden('system_messages_only', 'system messages are server-generated');
  }

  const msg = await Message.create(data);
  room.lastMessageAt = msg.createdAt;
  room.lastMessagePreview = preview;
  await room.save();

  res.status(201).json({ ok: true, message: msg });
});

const markRead = asyncHandler(async (req, res) => {
  const id = v.requireObjectId(req.params.id, 'id');
  const room = await ChatRoom.findById(id);
  if (!room) throw AppError.notFound('room_not_found');
  if (!isMember(room, req.userId)) throw AppError.forbidden('not_a_participant');

  const upTo = req.body?.upTo ? new Date(req.body.upTo) : new Date();
  if (Number.isNaN(upTo.getTime())) throw AppError.badRequest('invalid_upTo');

  const result = await Message.updateMany(
    {
      roomId: id,
      createdAt: { $lte: upTo },
      'readBy.userId': { $ne: req.userId },
    },
    { $push: { readBy: { userId: req.userId, readAt: new Date() } } },
  );
  res.json({ ok: true, marked: result.modifiedCount });
});

const deleteMessage = asyncHandler(async (req, res) => {
  const id = v.requireObjectId(req.params.id, 'id');
  const msg = await Message.findById(id);
  if (!msg) throw AppError.notFound('message_not_found');
  if (!msg.senderId.equals(req.userId)) throw AppError.forbidden('not_sender');
  msg.deletedAt = new Date();
  msg.body = '';
  msg.mediaUrl = null;
  await msg.save();
  res.json({ ok: true });
});

module.exports = {
  listRooms,
  openDm,
  openActivityRoom,
  openSquadRoom,
  getRoom,
  updateRoom,
  addMembers,
  removeMember,
  listMessages,
  sendMessage,
  markRead,
  deleteMessage,
};
