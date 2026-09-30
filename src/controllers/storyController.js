const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const v = require('../utils/validate');
const Story = require('../models/Story');
const Friendship = require('../models/Friendship');

const STORY_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_ACTIVE_PER_USER = 20;
const USER_FIELDS = 'displayName username avatarUrl';

async function getFriendIdSet(userId) {
  const fs = await Friendship.find({
    status: 'accepted',
    $or: [{ userA: userId }, { userB: userId }],
  }).select('userA userB');
  const set = new Set();
  for (const f of fs) set.add(f.userA.equals(userId) ? String(f.userB) : String(f.userA));
  return set;
}

function shapeStory(doc, viewerId, { isOwner }) {
  const s = doc.toObject ? doc.toObject() : doc;
  const seen = isOwner || (s.viewers ?? []).some((x) => String(x.userId) === String(viewerId));
  return {
    _id: s._id,
    userId: s.userId?._id ?? s.userId,
    mediaUrl: s.mediaUrl,
    mediaType: s.mediaType,
    caption: s.caption,
    createdAt: s.createdAt,
    expiresAt: s.expiresAt,
    seen,
    ...(isOwner ? { viewCount: (s.viewers ?? []).length } : {}),
  };
}

// POST /api/v1/stories  { mediaUrl, caption? }
const create = asyncHandler(async (req, res) => {
  const mediaUrl = v.requireString(req.body?.mediaUrl, 'mediaUrl', { max: 500 });
  if (!/^https?:\/\//i.test(mediaUrl)) throw AppError.badRequest('invalid_media', 'mediaUrl must be an http(s) URL');
  const caption = v.optionalString(req.body?.caption, 'caption', { max: 200 }) ?? '';

  const active = await Story.countDocuments({ userId: req.userId, expiresAt: { $gt: new Date() } });
  if (active >= MAX_ACTIVE_PER_USER) {
    throw AppError.tooMany('story_limit', `You can have up to ${MAX_ACTIVE_PER_USER} active stories`);
  }

  const story = await Story.create({
    userId: req.userId,
    mediaUrl,
    caption,
    expiresAt: new Date(Date.now() + STORY_TTL_MS),
  });

  res.status(201).json({ ok: true, story: shapeStory(story, req.userId, { isOwner: true }) });
});

// GET /api/v1/stories/feed — own + friends' active stories, grouped per user
const feed = asyncHandler(async (req, res) => {
  const me = String(req.userId);
  const friendIds = await getFriendIdSet(req.userId);
  const ids = [me, ...friendIds];

  const docs = await Story.find({ userId: { $in: ids }, expiresAt: { $gt: new Date() } })
    .sort({ createdAt: 1 })
    .populate('userId', USER_FIELDS)
    .lean();

  const byUser = new Map();
  for (const d of docs) {
    if (!d.userId) continue;
    const uid = String(d.userId._id);
    const isSelf = uid === me;
    if (!byUser.has(uid)) {
      byUser.set(uid, { user: d.userId, isSelf, stories: [], hasUnseen: false, latestAt: d.createdAt });
    }
    const g = byUser.get(uid);
    const shaped = shapeStory(d, me, { isOwner: isSelf });
    g.stories.push(shaped);
    if (!shaped.seen) g.hasUnseen = true;
    if (d.createdAt > g.latestAt) g.latestAt = d.createdAt;
  }

  // self first, then unseen (newest first), then seen (newest first)
  const groups = [...byUser.values()].sort((a, b) => {
    if (a.isSelf !== b.isSelf) return a.isSelf ? -1 : 1;
    if (a.hasUnseen !== b.hasUnseen) return a.hasUnseen ? -1 : 1;
    return new Date(b.latestAt) - new Date(a.latestAt);
  });

  res.json({ ok: true, groups });
});

// GET /api/v1/stories/user/:userId — active stories of one user (self or friend)
const byUser = asyncHandler(async (req, res) => {
  const target = v.requireObjectId(req.params.userId, 'userId');
  const isSelf = String(target) === String(req.userId);
  if (!isSelf) {
    const friends = await getFriendIdSet(req.userId);
    if (!friends.has(String(target))) throw AppError.forbidden('not_friends', 'Only friends can view stories');
  }
  const docs = await Story.find({ userId: target, expiresAt: { $gt: new Date() } }).sort({ createdAt: 1 }).lean();
  res.json({ ok: true, stories: docs.map((d) => shapeStory(d, req.userId, { isOwner: isSelf })) });
});

// POST /api/v1/stories/:id/view
const view = asyncHandler(async (req, res) => {
  const id = v.requireObjectId(req.params.id, 'id');
  const story = await Story.findOne({ _id: id, expiresAt: { $gt: new Date() } }).select('userId');
  if (!story) throw AppError.notFound('story_not_found', 'Story not found');
  if (String(story.userId) === String(req.userId)) return res.json({ ok: true });

  const friends = await getFriendIdSet(req.userId);
  if (!friends.has(String(story.userId))) throw AppError.forbidden('not_friends', 'Only friends can view stories');

  await Story.updateOne(
    { _id: id, 'viewers.userId': { $ne: req.userId } },
    { $push: { viewers: { userId: req.userId, at: new Date() } } },
  );
  res.json({ ok: true });
});

// GET /api/v1/stories/:id/viewers — owner only
const viewers = asyncHandler(async (req, res) => {
  const id = v.requireObjectId(req.params.id, 'id');
  const story = await Story.findById(id).populate('viewers.userId', USER_FIELDS).lean();
  if (!story) throw AppError.notFound('story_not_found', 'Story not found');
  if (String(story.userId) !== String(req.userId)) throw AppError.forbidden('not_owner', 'Not your story');
  const list = (story.viewers ?? [])
    .filter((x) => x.userId)
    .sort((a, b) => new Date(b.at) - new Date(a.at))
    .map((x) => ({ user: x.userId, at: x.at }));
  res.json({ ok: true, viewers: list });
});

// DELETE /api/v1/stories/:id — owner only
const remove = asyncHandler(async (req, res) => {
  const id = v.requireObjectId(req.params.id, 'id');
  const story = await Story.findById(id).select('userId');
  if (!story) throw AppError.notFound('story_not_found', 'Story not found');
  if (String(story.userId) !== String(req.userId)) throw AppError.forbidden('not_owner', 'Not your story');
  await story.deleteOne();
  res.json({ ok: true });
});

module.exports = { create, feed, byUser, view, viewers, remove };
