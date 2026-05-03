const mongoose = require('mongoose');
const AppError = require('./AppError');

function isObjectId(v) {
  return mongoose.Types.ObjectId.isValid(v) && String(new mongoose.Types.ObjectId(v)) === String(v);
}

function requireObjectId(v, field = 'id') {
  if (!isObjectId(v)) throw AppError.badRequest('invalid_id', `${field} must be a valid ObjectId`);
  return new mongoose.Types.ObjectId(v);
}

function requireString(v, field, { min = 1, max = 1000, trim = true } = {}) {
  if (typeof v !== 'string') throw AppError.badRequest('invalid_input', `${field} must be a string`);
  const s = trim ? v.trim() : v;
  if (s.length < min) throw AppError.badRequest('invalid_input', `${field} must be at least ${min} chars`);
  if (s.length > max) throw AppError.badRequest('invalid_input', `${field} must be at most ${max} chars`);
  return s;
}

function optionalString(v, field, opts = {}) {
  if (v === undefined || v === null || v === '') return undefined;
  return requireString(v, field, opts);
}

function requireNumber(v, field, { min, max, integer = false } = {}) {
  const n = Number(v);
  if (!Number.isFinite(n)) throw AppError.badRequest('invalid_input', `${field} must be a number`);
  if (integer && !Number.isInteger(n)) throw AppError.badRequest('invalid_input', `${field} must be an integer`);
  if (min !== undefined && n < min) throw AppError.badRequest('invalid_input', `${field} must be >= ${min}`);
  if (max !== undefined && n > max) throw AppError.badRequest('invalid_input', `${field} must be <= ${max}`);
  return n;
}

function requireEnum(v, field, values) {
  if (!values.includes(v)) {
    throw AppError.badRequest('invalid_input', `${field} must be one of: ${values.join(', ')}`);
  }
  return v;
}

function requireLatLng(lat, lng) {
  const la = requireNumber(lat, 'lat', { min: -90, max: 90 });
  const ln = requireNumber(lng, 'lng', { min: -180, max: 180 });
  return [ln, la]; // GeoJSON order
}

module.exports = {
  isObjectId,
  requireObjectId,
  requireString,
  optionalString,
  requireNumber,
  requireEnum,
  requireLatLng,
};
