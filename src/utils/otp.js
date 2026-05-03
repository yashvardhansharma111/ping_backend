const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const env = require('../config/env');

// E.164-ish: + then 8–15 digits. We don't enforce country here.
const PHONE_RE = /^\+[1-9]\d{7,14}$/;

function normalizePhone(input) {
  if (typeof input !== 'string') return null;
  let s = input.trim().replace(/[\s\-()]/g, '');
  if (s.startsWith('00')) s = `+${s.slice(2)}`;
  if (!s.startsWith('+')) {
    // bare 10-digit number → assume India (+91)
    if (/^[6-9]\d{9}$/.test(s)) s = `+91${s}`;
  }
  return PHONE_RE.test(s) ? s : null;
}

function generateOtp() {
  const max = 10 ** env.OTP_LENGTH;
  // crypto.randomInt is unbiased.
  const n = crypto.randomInt(0, max);
  return String(n).padStart(env.OTP_LENGTH, '0');
}

async function hashOtp(code) {
  return bcrypt.hash(code, 10);
}

function verifyOtp(code, hash) {
  return bcrypt.compare(code, hash);
}

// SMS sending stub — wire MSG91/Twilio here later.
async function sendOtpSms(phone, code) {
  if (env.SMS_PROVIDER === 'stub' || env.isDev) {
    console.log(`[otp] (stub) ${phone} -> ${code}`);
    return { delivered: true, provider: 'stub' };
  }
  // TODO: integrate real provider before production
  console.warn(`[otp] no provider configured for ${phone}, falling back to stub`);
  return { delivered: false, provider: 'none' };
}

module.exports = { normalizePhone, generateOtp, hashOtp, verifyOtp, sendOtpSms };
