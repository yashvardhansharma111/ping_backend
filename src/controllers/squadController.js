const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const v = require('../utils/validate');

const Squad = require('../models/Squad');
const User = require('../models/User');
const Friendship = require('../models/Friendship');

const MAX_MEMBERS = 20;

// Make sure every proposed member is an accepted friend of `me` and not banned.
// Returns the validated, deduped, ObjectId-typed list (excluding `me`).
async function validateCandidateMembers(meId, candidateIds) {
  const ids = [...new Set(candidateIds.map(String))]
    .filter((id) => id !== String(meId))
    .map((id) => v.requireObjectId(id, 'memberId'));

  if (ids.length === 0) return [];

  const users = await User.find({ _id: { $in: ids } }).select('_id status');
  if (users.length !== ids.length) throw AppError.badRequest('member_not_found', 'One or more members do not exist');
  const banned = users.find((u) => u.status === 'perm_banned');
  if (banned) throw AppError.forbidden('member_banned', 'Cannot add a banned user');

  // Bulk-check friendships
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
    throw AppError.forbidden('not_friends', 'You can only add accepted friends to a squad', { notFriends });
  }

  return ids;
}

function requireOwner(squad, userId) {
  if (!squad.ownerId.equals(userId)) {
    throw AppError.forbidden('not_owner', 'Only the squad owner can do this');
  }
}

function requireMember(squad, userId) {
  if (!squad.memberIds.some((id) => id.equals(userId))) {
    throw AppError.forbidden('not_member', 'You are not in this squad');
  }
}

// GET /api/v1/squads
const listSquads = asyncHandler(async (req, res) => {
  const squads = await Squad.find({ memberIds: req.userId }).sort({ lastActivityAt: -1 });
  res.json({ ok: true, squads });
});

// POST /api/v1/squads  body: { name, memberIds: [...], description?, avatarUrl? }
const createSquad = asyncHandler(async (req, res) => {
  const name = v.requireString(req.body?.name, 'name', { min: 1, max: 40 });
  const memberIdsInput = Array.isArray(req.body?.memberIds) ? req.body.memberIds : [];
  if (memberIdsInput.length < 1) {
    throw AppError.badRequest('too_few_members', 'A squad needs at least one other member');
  }
  if (memberIdsInput.length + 1 > MAX_MEMBERS) {
    throw AppError.badRequest('too_many_members', `A squad has at most ${MAX_MEMBERS} members`);
  }

  const friendIds = await validateCandidateMembers(req.userId, memberIdsInput);
  const memberIds = [req.userId, ...friendIds];

  const squad = await Squad.create({
    name,
    description: v.optionalString(req.body?.description, 'description', { max: 200 }) ?? '',
    avatarUrl: req.body?.avatarUrl || null,
    ownerId: req.userId,
    memberIds,
    lastActivityAt: new Date(),
  });
  res.status(201).json({ ok: true, squad });
});

// GET /api/v1/squads/:id
const getSquad = asyncHandler(async (req, res) => {
  const id = v.requireObjectId(req.params.id, 'id');
  const squad = await Squad.findById(id).populate('memberIds', 'displayName username avatarUrl');
  if (!squad) throw AppError.notFound('squad_not_found');
  requireMember(squad, req.userId);
  res.json({ ok: true, squad });
});

// PATCH /api/v1/squads/:id  (owner)
const updateSquad = asyncHandler(async (req, res) => {
  const id = v.requireObjectId(req.params.id, 'id');
  const squad = await Squad.findById(id);
  if (!squad) throw AppError.notFound('squad_not_found');
  requireOwner(squad, req.userId);

  if (req.body.name !== undefined) {
    squad.name = v.requireString(req.body.name, 'name', { min: 1, max: 40 });
  }
  if (req.body.description !== undefined) {
    squad.description = v.optionalString(req.body.description, 'description', { max: 200 }) ?? '';
  }
  if (req.body.avatarUrl !== undefined) {
    squad.avatarUrl = req.body.avatarUrl || null;
  }
  await squad.save();
  res.json({ ok: true, squad });
});

// DELETE /api/v1/squads/:id  (owner)
const deleteSquad = asyncHandler(async (req, res) => {
  const id = v.requireObjectId(req.params.id, 'id');
  const squad = await Squad.findById(id);
  if (!squad) throw AppError.notFound('squad_not_found');
  requireOwner(squad, req.userId);
  await squad.deleteOne();
  res.json({ ok: true });
});

// POST /api/v1/squads/:id/members  body: { userIds: [...] }  (owner)
const addMembers = asyncHandler(async (req, res) => {
  const id = v.requireObjectId(req.params.id, 'id');
  const squad = await Squad.findById(id);
  if (!squad) throw AppError.notFound('squad_not_found');
  requireOwner(squad, req.userId);

  const candidates = Array.isArray(req.body?.userIds) ? req.body.userIds : [];
  if (candidates.length === 0) throw AppError.badRequest('no_members', 'userIds is required');

  const validIds = await validateCandidateMembers(req.userId, candidates);
  const existingSet = new Set(squad.memberIds.map(String));
  const toAdd = validIds.filter((id) => !existingSet.has(String(id)));

  if (squad.memberIds.length + toAdd.length > MAX_MEMBERS) {
    throw AppError.badRequest('too_many_members', `Squad would exceed the ${MAX_MEMBERS} member cap`);
  }

  squad.memberIds.push(...toAdd);
  squad.lastActivityAt = new Date();
  await squad.save();
  res.json({ ok: true, squad });
});

// DELETE /api/v1/squads/:id/members/:userId  (owner removes anyone, members remove themselves)
const removeMember = asyncHandler(async (req, res) => {
  const id = v.requireObjectId(req.params.id, 'id');
  const targetId = v.requireObjectId(req.params.userId, 'userId');

  const squad = await Squad.findById(id);
  if (!squad) throw AppError.notFound('squad_not_found');
  if (!squad.memberIds.some((m) => m.equals(targetId))) {
    throw AppError.notFound('member_not_in_squad');
  }

  const isSelf = targetId.equals(req.userId);
  if (!isSelf) requireOwner(squad, req.userId);

  if (squad.ownerId.equals(targetId)) {
    throw AppError.badRequest('cannot_remove_owner', 'The owner must transfer or delete the squad first');
  }

  squad.memberIds = squad.memberIds.filter((m) => !m.equals(targetId));
  if (squad.memberIds.length < 2) {
    // Spec: a squad has 2–20. Below that, dissolve it instead of leaving an
    // invalid doc behind.
    await squad.deleteOne();
    return res.json({ ok: true, dissolved: true });
  }

  squad.lastActivityAt = new Date();
  await squad.save();
  res.json({ ok: true, squad });
});

// POST /api/v1/squads/:id/leave   convenience wrapper
const leaveSquad = asyncHandler(async (req, res, next) => {
  req.params.userId = String(req.userId);
  return removeMember(req, res, next);
});

module.exports = {
  listSquads,
  createSquad,
  getSquad,
  updateSquad,
  deleteSquad,
  addMembers,
  removeMember,
  leaveSquad,
};
