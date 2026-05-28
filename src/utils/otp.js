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

async function _renflairSend(phone, code) {
  // Strip +91 prefix — Renflair V1 expects a bare 10-digit Indian number
  const mobile = phone.replace(/^\+91/, '').replace(/^\+/, '');
  const url = `https://sms.renflair.in/V1.php?API=${env.RENFLAIR_API_KEY}&PHONE=${mobile}&OTP=${code}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  let res;
  try {
    res = await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();

  let data;
  try { data = JSON.parse(text); } catch { data = null; }

  // Renflair V1 returns { status: 'success', ... } or { status: 'error', ... }
  if (data?.status === 'error' || (data === null && !res.ok)) {
    throw new Error(`Renflair error: ${text.trim()}`);
  }
  return { delivered: true, provider: 'renflair', msgId: data?.message_id ?? null };
}

async function sendOtpSms(phone, code) {
  if (env.SMS_PROVIDER === 'stub') {
    console.log(`[otp] (stub) ${phone} -> ${code}`);
    return { delivered: true, provider: 'stub' };
  }

  if (env.SMS_PROVIDER === 'renflair') {
    try {
      return await _renflairSend(phone, code);
    } catch (err) {
      console.error(`[otp] Renflair delivery failed for ${phone}:`, err.message);
      return { delivered: false, provider: 'renflair', error: err.message };
    }
  }

  console.warn(`[otp] unknown SMS_PROVIDER "${env.SMS_PROVIDER}" — falling back to stub`);
  console.log(`[otp] (stub) ${phone} -> ${code}`);
  return { delivered: true, provider: 'stub' };
}

module.exports = { normalizePhone, generateOtp, hashOtp, verifyOtp, sendOtpSms };
