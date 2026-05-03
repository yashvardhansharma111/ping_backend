const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const v = require('../utils/validate');

const Appeal = require('../models/Appeal');
const Ban = require('../models/Ban');
const User = require('../models/User');
const { verifyAccessToken } = require('../services/tokenService');

// Banned users can't pass authUser middleware (it 403s). So this endpoint is
// public and accepts the ban'd user's still-valid access token in the header
// — we manually decode and look up the user without the ban check.
async function loadBannedUserFromToken(req) {
  const h = req.headers.authorization || '';
  const [scheme, token] = h.split(' ');
  if (!scheme || scheme.toLowerCase() !== 'bearer' || !token) {
    throw AppError.unauthorized('missing_token');
  }
  const payload = verifyAccessToken(token);
  const user = await User.findById(payload.sub);
  if (!user) throw AppError.unauthorized('user_not_found');
  if (!['temp_banned', 'perm_banned'].includes(user.status)) {
    throw AppError.badRequest('not_banned', 'Only banned users can submit appeals');
  }
  return user;
}

// POST /api/v1/appeals   body: { message }
const submitAppeal = asyncHandler(async (req, res) => {
  const user = await loadBannedUserFromToken(req);
  const message = v.requireString(req.body?.message, 'message', { min: 10, max: 2000 });

  const ban = await Ban.findOne({ userId: user._id, removedAt: null }).sort({ createdAt: -1 });
  if (!ban) throw AppError.badRequest('no_active_ban');

  const existing = await Appeal.findOne({
    userId: user._id,
    banId: ban._id,
    status: { $in: ['pending', 'info_requested'] },
  });
  if (existing) throw AppError.conflict('already_pending', 'An appeal is already under review');

  // Per spec — permanent bans get one appeal.
  if (ban.type === 'perm') {
    const past = await Appeal.countDocuments({ userId: user._id, banId: ban._id });
    if (past >= 1) throw AppError.forbidden('appeal_used', 'You have already used your one appeal');
  }

  const appeal = await Appeal.create({
    userId: user._id,
    banId: ban._id,
    message,
  });
  res.status(201).json({ ok: true, appeal });
});

// POST /api/v1/appeals/respond   body: { response }
// Used after admin sets status='info_requested'.
const respondToInfoRequest = asyncHandler(async (req, res) => {
  const user = await loadBannedUserFromToken(req);
  const response = v.requireString(req.body?.response, 'response', { min: 1, max: 2000 });

  const appeal = await Appeal.findOne({ userId: user._id, status: 'info_requested' })
    .sort({ createdAt: -1 });
  if (!appeal) throw AppError.notFound('no_info_request');

  appeal.userResponse = response;
  appeal.status = 'pending';
  await appeal.save();
  res.json({ ok: true, appeal });
});

module.exports = { submitAppeal, respondToInfoRequest };
