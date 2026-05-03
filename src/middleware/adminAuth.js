const { verifyAdminToken } = require('../services/adminTokenService');
const AdminUser = require('../models/AdminUser');
const AppError = require('../utils/AppError');
const { bearerToken } = require('./auth');

async function authAdmin(req, _res, next) {
  try {
    const token = bearerToken(req);
    if (!token) throw AppError.unauthorized('missing_token', 'Authorization header missing');

    const payload = verifyAdminToken(token);
    if (payload.typ !== 'admin') throw AppError.unauthorized('not_admin_token');

    const admin = await AdminUser.findById(payload.sub);
    if (!admin) throw AppError.unauthorized('admin_not_found');
    if (admin.disabledAt) throw AppError.forbidden('admin_disabled', 'Admin account disabled');

    req.admin = admin;
    req.adminId = admin._id;
    next();
  } catch (err) {
    next(err);
  }
}

// Per-route role guard. Pass an array of acceptable roles.
function requireAdminRole(roles) {
  return (req, _res, next) => {
    if (!req.admin) return next(AppError.unauthorized());
    if (!roles.includes(req.admin.role)) {
      return next(AppError.forbidden('insufficient_role', `Requires one of: ${roles.join(', ')}`));
    }
    next();
  };
}

module.exports = { authAdmin, requireAdminRole };
