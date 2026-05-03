const env = require('../config/env');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { normalizePhone, generateOtp, hashOtp, verifyOtp, sendOtpSms } = require('../utils/otp');

const User = require('../models/User');
const OtpChallenge = require('../models/OtpChallenge');
const RefreshToken = require('../models/RefreshToken');

const {
  signAccessToken,
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAllForUser,
} = require('../services/tokenService');

function deviceInfoFrom(req) {
  return {
    platform: req.body?.device?.platform || null,
    model: req.body?.device?.model || null,
    appVersion: req.body?.device?.appVersion || null,
    ip: req.ip,
    userAgent: req.headers['user-agent'] || null,
  };
}

// POST /api/v1/auth/otp/request
// body: { phone }
const requestOtp = asyncHandler(async (req, res) => {
  const phone = normalizePhone(req.body?.phone);
  if (!phone) throw AppError.badRequest('invalid_phone', 'Phone must be in E.164 (+countrycode) format');

  // Per-phone cooldown — the IP rate limiter handles broader abuse.
  const last = await OtpChallenge.findOne({ phone }).sort({ createdAt: -1 });
  if (last) {
    const cooldownMs = env.OTP_REQUEST_COOLDOWN_SECONDS * 1000;
    const waitMs = last.createdAt.getTime() + cooldownMs - Date.now();
    if (waitMs > 0) {
      throw AppError.tooMany('otp_cooldown', `Try again in ${Math.ceil(waitMs / 1000)}s`);
    }
  }

  const code = generateOtp();
  const codeHash = await hashOtp(code);
  const expiresAt = new Date(Date.now() + env.OTP_TTL_SECONDS * 1000);

  await OtpChallenge.create({
    phone,
    codeHash,
    expiresAt,
    requestIp: req.ip,
  });

  await sendOtpSms(phone, code);

  res.json({
    ok: true,
    phone,
    expiresAt,
    // Only present when OTP_DEBUG=true — strictly for local dev / E2E tests.
    devCode: env.OTP_DEBUG ? code : undefined,
  });
});

// POST /api/v1/auth/otp/verify
// body: { phone, code, displayName?, device? }
const verifyOtpAndLogin = asyncHandler(async (req, res) => {
  const phone = normalizePhone(req.body?.phone);
  const code = (req.body?.code || '').toString().trim();
  const displayName = (req.body?.displayName || '').toString().trim();

  if (!phone) throw AppError.badRequest('invalid_phone', 'Phone must be in E.164 format');
  if (!/^\d{4,8}$/.test(code)) throw AppError.badRequest('invalid_code', 'OTP code is invalid');

  const challenge = await OtpChallenge.findOne({ phone, consumedAt: null }).sort({ createdAt: -1 });
  if (!challenge) throw AppError.badRequest('otp_not_found', 'No active OTP for this phone');
  if (challenge.expiresAt < new Date()) throw AppError.badRequest('otp_expired', 'OTP has expired');
  if (challenge.attempts >= env.OTP_MAX_ATTEMPTS) {
    throw AppError.tooMany('otp_attempts_exceeded', 'Too many attempts; request a new OTP');
  }

  const ok = await verifyOtp(code, challenge.codeHash);
  if (!ok) {
    challenge.attempts += 1;
    await challenge.save();
    throw AppError.unauthorized('otp_incorrect', 'Incorrect code');
  }

  challenge.consumedAt = new Date();
  await challenge.save();

  let user = await User.findOne({ phone });
  let isNew = false;
  if (!user) {
    if (!displayName) {
      throw AppError.badRequest('display_name_required', 'displayName is required for first-time signup');
    }
    user = await User.create({
      phone,
      displayName,
      phoneVerifiedAt: new Date(),
      lastActiveAt: new Date(),
    });
    isNew = true;
  } else {
    if (user.status === 'perm_banned') throw AppError.forbidden('account_banned', 'Account is permanently banned');
    if (user.status === 'temp_banned' && user.bannedUntil && user.bannedUntil > new Date()) {
      throw AppError.forbidden('account_suspended', 'Account is temporarily suspended', {
        until: user.bannedUntil,
      });
    }
    if (!user.phoneVerifiedAt) user.phoneVerifiedAt = new Date();
    user.lastActiveAt = new Date();
    await user.save();
  }

  const accessToken = signAccessToken(user);
  const refreshToken = await issueRefreshToken(user, deviceInfoFrom(req));

  res.json({
    ok: true,
    isNew,
    user,
    accessToken,
    refreshToken,
  });
});

// POST /api/v1/auth/refresh
// body: { refreshToken }
const refresh = asyncHandler(async (req, res) => {
  const oldToken = (req.body?.refreshToken || '').toString();
  if (!oldToken) throw AppError.badRequest('missing_refresh', 'refreshToken is required');

  const { token, userId } = await rotateRefreshToken(oldToken, deviceInfoFrom(req));
  const user = await User.findById(userId);
  if (!user) throw AppError.unauthorized('user_not_found', 'User no longer exists');
  if (user.isBanned()) throw AppError.forbidden('account_banned', 'Account is banned');

  const accessToken = signAccessToken(user);
  res.json({ ok: true, accessToken, refreshToken: token });
});

// POST /api/v1/auth/logout
// body: { refreshToken }   (auth header optional — refresh token is the truth)
const logout = asyncHandler(async (req, res) => {
  const token = (req.body?.refreshToken || '').toString();
  if (token) await revokeRefreshToken(token, 'logout');
  res.json({ ok: true });
});

// POST /api/v1/auth/logout-all  (authed)
const logoutAll = asyncHandler(async (req, res) => {
  await revokeAllForUser(req.userId, 'logout_all');
  res.json({ ok: true });
});

// GET /api/v1/auth/me  (authed)
const me = asyncHandler(async (req, res) => {
  res.json({ ok: true, user: req.user });
});

// GET /api/v1/auth/sessions  (authed) — useful for a "manage devices" screen
const listSessions = asyncHandler(async (req, res) => {
  const sessions = await RefreshToken.find({ userId: req.userId, revokedAt: null })
    .sort({ createdAt: -1 })
    .select('-tokenHash');
  res.json({ ok: true, sessions });
});

module.exports = {
  requestOtp,
  verifyOtpAndLogin,
  refresh,
  logout,
  logoutAll,
  me,
  listSessions,
};
