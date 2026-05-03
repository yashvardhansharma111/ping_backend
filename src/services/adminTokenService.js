const jwt = require('jsonwebtoken');
const env = require('../config/env');
const AppError = require('../utils/AppError');

const ADMIN_AUDIENCE = 'ping:admin';
const ADMIN_TTL = '1h'; // per spec — admin sessions expire after 1 hour

function signAdminToken(admin) {
  return jwt.sign(
    { sub: String(admin._id), typ: 'admin', role: admin.role },
    env.JWT_ACCESS_SECRET,
    { expiresIn: ADMIN_TTL, audience: ADMIN_AUDIENCE, issuer: 'ping-api' },
  );
}

function verifyAdminToken(token) {
  try {
    return jwt.verify(token, env.JWT_ACCESS_SECRET, {
      audience: ADMIN_AUDIENCE,
      issuer: 'ping-api',
    });
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      throw AppError.unauthorized('admin_token_expired', 'Admin session expired — log in again');
    }
    throw AppError.unauthorized('invalid_admin_token', 'Invalid admin token');
  }
}

module.exports = { signAdminToken, verifyAdminToken, ADMIN_TTL };
