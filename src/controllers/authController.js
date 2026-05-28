const env = require('../config/env');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { normalizePhone, generateOtp, hashOtp, verifyOtp, sendOtpSms } = require('../utils/otp');
const otpStore = require('../utils/otpStore');

const User = require('../models/User');
const AdminUser = require('../models/AdminUser');
const RefreshToken = require('../models/RefreshToken');

const {
  signAccessToken,
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAllForUser,
} = require('../services/tokenService');
const { signAdminToken } = require('../services/adminTokenService');

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

  // Hardcoded admin bypass — skip SMS, use fixed OTP
  const isAdminPhone = phone === env.ADMIN_PHONE;

  if (!isAdminPhone) {
    if (otpStore.isOnCooldown(phone)) {
      const wait = otpStore.cooldownTtl(phone);
      throw AppError.tooMany('otp_cooldown', `Try again in ${wait}s`);
    }
  }

  const code = isAdminPhone ? env.ADMIN_OTP : generateOtp();
  const expiresAt = new Date(Date.now() + env.OTP_TTL_SECONDS * 1000);

  if (!isAdminPhone) {
    const codeHash = await hashOtp(code);
    otpStore.setChallenge(phone, { codeHash, expiresAt: expiresAt.getTime(), requestIp: req.ip });
    otpStore.setCooldown(phone);
    await sendOtpSms(phone, code);
  }

  res.json({
    ok: true,
    phone,
    expiresAt,
    code: (env.OTP_DEBUG || isAdminPhone) ? code : undefined,
  });
});

// POST /api/v1/auth/otp/verify
// body: { phone, code, device? }
const verifyOtpAndLogin = asyncHandler(async (req, res) => {
  const phone = normalizePhone(req.body?.phone);
  const code = (req.body?.code || '').toString().trim();

  if (!phone) throw AppError.badRequest('invalid_phone', 'Phone must be in E.164 format');
  if (!/^\d{4,8}$/.test(code)) throw AppError.badRequest('invalid_code', 'OTP code is invalid');

  // Admin phone — verify directly against hardcoded OTP, no in-memory store needed
  if (phone === env.ADMIN_PHONE) {
    if (code !== env.ADMIN_OTP) {
      throw AppError.unauthorized('otp_incorrect', 'Incorrect admin code');
    }
  } else {
    const challenge = otpStore.getChallenge(phone);
    if (!challenge) throw AppError.badRequest('otp_not_found', 'No active OTP for this phone');
    if (challenge.expiresAt < Date.now()) throw AppError.badRequest('otp_expired', 'OTP has expired');
    if (challenge.attempts >= env.OTP_MAX_ATTEMPTS) {
      throw AppError.tooMany('otp_attempts_exceeded', 'Too many attempts; request a new OTP');
    }

    const ok = await verifyOtp(code, challenge.codeHash);
    if (!ok) {
      otpStore.bumpAttempts(phone);
      throw AppError.unauthorized('otp_incorrect', 'Incorrect code');
    }

    otpStore.consumeChallenge(phone);
  }

  let user = await User.findOne({ phone });
  let isNewUser = false;
  if (!user) {
    user = await User.create({
      phone,
      phoneVerifiedAt: new Date(),
      lastActiveAt: new Date(),
    });
    isNewUser = true;
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

  // Admin phone → also issue an admin JWT
  let isAdmin = false;
  let adminToken = undefined;
  if (phone === env.ADMIN_PHONE) {
    isAdmin = true;
    let adminUser = await AdminUser.findOne({ email: 'admin@ping.app' });
    if (!adminUser) {
      const bcrypt = require('bcryptjs');
      const passwordHash = await bcrypt.hash(env.ADMIN_OTP + '_ping_secret', 12);
      try {
        adminUser = await AdminUser.create({
          email: 'admin@ping.app', name: 'Admin', role: 'super_admin', passwordHash,
        });
      } catch (e) {
        if (e.code !== 11000) throw e;
        adminUser = await AdminUser.findOne({ email: 'admin@ping.app' });
      }
    }
    adminToken = signAdminToken(adminUser);
  }

  res.json({
    ok: true,
    isNewUser,
    isAdmin,
    user,
    accessToken,
    refreshToken,
    ...(adminToken ? { adminToken } : {}),
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
