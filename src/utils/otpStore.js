const NodeCache = require('node-cache');
const env = require('../config/env');

const cache = new NodeCache({ checkperiod: 30, useClones: false });

const K = {
  challenge: (phone) => `c:${phone}`,
  cooldown:  (phone) => `cd:${phone}`,
};

function setChallenge(phone, data) {
  return cache.set(K.challenge(phone), { ...data, attempts: 0 }, env.OTP_TTL_SECONDS);
}

function getChallenge(phone) {
  return cache.get(K.challenge(phone)) ?? null;
}

function bumpAttempts(phone) {
  const c = cache.get(K.challenge(phone));
  if (!c) return;
  const ttlMs = cache.getTtl(K.challenge(phone));
  const remaining = ttlMs ? Math.max(1, Math.floor((ttlMs - Date.now()) / 1000)) : env.OTP_TTL_SECONDS;
  c.attempts += 1;
  cache.set(K.challenge(phone), c, remaining);
}

function consumeChallenge(phone) {
  const exists = cache.has(K.challenge(phone));
  cache.del(K.challenge(phone));
  return exists;
}

function setCooldown(phone) {
  return cache.set(K.cooldown(phone), true, env.OTP_REQUEST_COOLDOWN_SECONDS);
}

function isOnCooldown(phone) {
  return cache.has(K.cooldown(phone));
}

function cooldownTtl(phone) {
  const ttlMs = cache.getTtl(K.cooldown(phone));
  if (!ttlMs) return 0;
  return Math.max(0, Math.ceil((ttlMs - Date.now()) / 1000));
}

module.exports = { setChallenge, getChallenge, bumpAttempts, consumeChallenge, setCooldown, isOnCooldown, cooldownTtl };
