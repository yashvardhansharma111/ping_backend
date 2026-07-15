const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const env = require('../config/env');
const RefreshToken = require('../models/RefreshToken');
const AppError = require('../utils/AppError');

const ACCESS_AUDIENCE = 'ping:user';
const REFRESH_AUDIENCE = 'ping:user:refresh';

function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

function signAccessToken(user) {
  return jwt.sign(
    { sub: String(user._id), typ: 'access' },
    env.JWT_ACCESS_SECRET,
    { audience: ACCESS_AUDIENCE, issuer: 'ping-api' },
  );
}

function verifyAccessToken(token) {
  try {
    return jwt.verify(token, env.JWT_ACCESS_SECRET, { audience: ACCESS_AUDIENCE, issuer: 'ping-api' });
  } catch {
    throw AppError.unauthorized('invalid_token', 'Invalid access token');
  }
}

async function issueRefreshToken(user, deviceInfo = {}) {
  const jti = crypto.randomUUID();
  const token = jwt.sign(
    { sub: String(user._id), typ: 'refresh', jti },
    env.JWT_REFRESH_SECRET,
    { audience: REFRESH_AUDIENCE, issuer: 'ping-api' },
  );
  await RefreshToken.create({
    userId: user._id,
    jti,
    tokenHash: sha256(token),
    deviceInfo,
  });
  return token;
}

async function rotateRefreshToken(oldToken, deviceInfo = {}) {
  let payload;
  try {
    payload = jwt.verify(oldToken, env.JWT_REFRESH_SECRET, {
      audience: REFRESH_AUDIENCE, issuer: 'ping-api',
    });
  } catch (err) {
    throw AppError.unauthorized('invalid_refresh', 'Invalid or expired refresh token');
  }

  const stored = await RefreshToken.findOne({ jti: payload.jti });
  if (!stored) throw AppError.unauthorized('refresh_unknown', 'Refresh token not recognized');

  if (stored.tokenHash !== sha256(oldToken)) {
    throw AppError.unauthorized('refresh_mismatch', 'Refresh token mismatch');
  }

  if (stored.revokedAt) {
    // Replay of a rotated token — treat as compromise: revoke the whole chain.
    await RefreshToken.updateMany(
      { userId: stored.userId, revokedAt: null },
      { $set: { revokedAt: new Date(), revokeReason: 'reused' } },
    );
    throw AppError.unauthorized('refresh_reused', 'Refresh token reuse detected; please log in again');
  }

  const newJti = crypto.randomUUID();
  const newToken = jwt.sign(
    { sub: String(stored.userId), typ: 'refresh', jti: newJti },
    env.JWT_REFRESH_SECRET,
    { audience: REFRESH_AUDIENCE, issuer: 'ping-api' },
  );

  stored.revokedAt = new Date();
  stored.replacedByJti = newJti;
  stored.revokeReason = 'rotated';
  await stored.save();

  await RefreshToken.create({
    userId: stored.userId,
    jti: newJti,
    tokenHash: sha256(newToken),
    deviceInfo,
  });

  return { token: newToken, userId: stored.userId };
}

async function revokeRefreshToken(token, reason = 'logout') {
  try {
    const payload = jwt.verify(token, env.JWT_REFRESH_SECRET, {
      audience: REFRESH_AUDIENCE, issuer: 'ping-api',
    });
    await RefreshToken.updateOne(
      { jti: payload.jti, revokedAt: null },
      { $set: { revokedAt: new Date(), revokeReason: reason } },
    );
  } catch {
    // ignore — already invalid
  }
}

async function revokeAllForUser(userId, reason = 'admin') {
  await RefreshToken.updateMany(
    { userId, revokedAt: null },
    { $set: { revokedAt: new Date(), revokeReason: reason } },
  );
}

module.exports = {
  signAccessToken,
  verifyAccessToken,
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAllForUser,
};
