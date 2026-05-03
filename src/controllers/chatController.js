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

function isMember(room, userId) {
  return room.participantIds.some((p) => p.equals(userId));
}

// GET /api/v1/chat/rooms
const listRooms = asyncHandler(async (req, res) => {
  const rooms = await ChatRoom.find({ participantIds: req.userId })
    .sort({ lastMessageAt: -1 })
    .limit(100)
    .populate('participantIds', 'displayName username avatarUrl');
  res.json({ ok: true, rooms });
});

// POST /api/v1/chat/rooms/dm   body: { userId }   (idempotent — returns existing)
const openDm = asyncHandler(async (req, res) => {
  const otherId = v.requireObjectId(req.body?.userId, 'userId');
  if (otherId.equals(req.userId)) throw AppError.badRequest('self_dm', "Can't DM yourself");

  const other = await User.findById(otherId);
  if (!other) throw AppError.notFound('user_not_found');

  // Block check + (optional) friendship requirement
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
  res.json({ ok: true, room });
});

// POST /api/v1/chat/rooms/activity/:activityId  — opens or creates the room
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

  let room = await ChatRoom.findOne({ activityId });
  if (!room) {
    room = await ChatRoom.create({
      kind: 'activity',
      activityId,
      participantIds: uniq,
      lastMessageAt: new Date(),
    });
  } else {
    // Reconcile in case new participants joined since the room was created.
    const set = new Set(room.participantIds.map(String));
    const toAdd = uniq.filter((id) => !set.has(String(id)));
    if (toAdd.length) {
      room.participantIds.push(...toAdd);
      await room.save();
    }
  }
  res.json({ ok: true, room });
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
  res.json({ ok: true, room });
});

// GET /api/v1/chat/rooms/:id
const getRoom = asyncHandler(async (req, res) => {
  const id = v.requireObjectId(req.params.id, 'id');
  const room = await ChatRoom.findById(id).populate('participantIds', 'displayName username avatarUrl');
  if (!room) throw AppError.notFound('room_not_found');
  if (!isMember(room, req.userId)) throw AppError.forbidden('not_a_participant');
  res.json({ ok: true, room });
});

// GET /api/v1/chat/rooms/:id/messages?before=&limit=
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

// POST /api/v1/chat/rooms/:id/messages   body: { type?, body, mediaUrl?, lat?, lng? }
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

// POST /api/v1/chat/rooms/:id/read    body: { upTo? }
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

// DELETE /api/v1/chat/messages/:id   (sender only, soft delete)
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
  listMessages,
  sendMessage,
  markRead,
  deleteMessage,
};
