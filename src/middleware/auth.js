const { verifyAccessToken } = require('../services/tokenService');
const User = require('../models/User');
const AppError = require('../utils/AppError');

function bearerToken(req) {
  const h = req.headers.authorization || '';
  const [scheme, token] = h.split(' ');
  if (scheme && scheme.toLowerCase() === 'bearer' && token) return token;
  return null;
}

async function authUser(req, _res, next) {
  try {
    const token = bearerToken(req);
    if (!token) throw AppError.unauthorized('missing_token', 'Authorization header missing');

    const payload = verifyAccessToken(token);
    const user = await User.findById(payload.sub);
    if (!user) throw AppError.unauthorized('user_not_found', 'User no longer exists');

    if (user.status === 'perm_banned') {
      throw AppError.forbidden('account_banned', 'Account is permanently banned');
    }
    if (user.status === 'temp_banned' && user.bannedUntil && user.bannedUntil > new Date()) {
      throw AppError.forbidden('account_suspended', 'Account is temporarily suspended', {
        until: user.bannedUntil,
      });
    }

    req.user = user;
    req.userId = user._id;
    next();
  } catch (err) {
    next(err);
  }
}

// Lighter variant for routes where auth is optional (e.g. public ad feed).
async function maybeAuthUser(req, _res, next) {
  const token = bearerToken(req);
  if (!token) return next();
  try {
    const payload = verifyAccessToken(token);
    const user = await User.findById(payload.sub);
    if (user && !user.isBanned()) {
      req.user = user;
      req.userId = user._id;
    }
  } catch {
    // ignore — treat as anonymous
  }
  next();
}

module.exports = { authUser, maybeAuthUser, bearerToken };
