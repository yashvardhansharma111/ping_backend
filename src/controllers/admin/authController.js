const env = require('../../config/env');
const asyncHandler = require('../../utils/asyncHandler');
const AppError = require('../../utils/AppError');
const v = require('../../utils/validate');
const { ADMIN_ROLE } = require('../../utils/enums');

const AdminUser = require('../../models/AdminUser');
const { signAdminToken } = require('../../services/adminTokenService');
const auditLogger = require('../../services/auditLogger');

// POST /api/admin/v1/auth/login   body: { email, password }
const login = asyncHandler(async (req, res) => {
  const email = v.requireString(req.body?.email, 'email').toLowerCase();
  const password = v.requireString(req.body?.password, 'password', { min: 6, max: 200 });

  // Generic message — don't leak whether the email exists.
  const fail = () => { throw AppError.unauthorized('invalid_credentials', 'Email or password incorrect'); };

  const admin = await AdminUser.findOne({ email });
  if (!admin || admin.disabledAt) return fail();
  const ok = await admin.verifyPassword(password);
  if (!ok) return fail();

  // MFA is described in the spec but not wired in this build — when the TOTP
  // path is enabled, we'd return { mfaRequired: true, challengeId } here and
  // require a follow-up POST /auth/totp/verify.

  admin.lastLoginAt = new Date();
  admin.lastLoginIp = req.ip;
  await admin.save();

  const token = signAdminToken(admin);
  await auditLogger.record({ admin, req, action: 'admin_login' });

  res.json({ ok: true, token, admin });
});

// GET /api/admin/v1/auth/me
const me = asyncHandler(async (req, res) => {
  res.json({ ok: true, admin: req.admin });
});

// POST /api/admin/v1/auth/seed   (dev only — bootstraps the first admin)
// body: { email, password, name, role }
const seed = asyncHandler(async (req, res) => {
  if (!env.isDev) throw AppError.forbidden('seed_disabled', 'Seed is only available in development');

  const email = v.requireString(req.body?.email, 'email').toLowerCase();
  const password = v.requireString(req.body?.password, 'password', { min: 8, max: 200 });
  const name = v.requireString(req.body?.name, 'name', { min: 1, max: 80 });
  const role = req.body?.role
    ? v.requireEnum(req.body.role, 'role', ADMIN_ROLE)
    : 'super_admin';

  const existing = await AdminUser.findOne({ email });
  if (existing) throw AppError.conflict('admin_exists', 'Admin with this email already exists');

  const admin = new AdminUser({ email, name, role });
  await admin.setPassword(password);
  await admin.save();

  res.status(201).json({ ok: true, admin });
});

module.exports = { login, me, seed };
