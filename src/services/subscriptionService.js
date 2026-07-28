const AppError = require('../utils/AppError');
const User = require('../models/User');
const { SUBSCRIPTION_PLANS, TIER_ENTITLEMENTS } = require('../utils/enums');

/** Monday-based week key in Asia/Kolkata, e.g. 2026-W31 */
function currentWeekKey(date = new Date()) {
  // Convert to IST (+5:30)
  const ist = new Date(date.getTime() + 5.5 * 60 * 60 * 1000);
  const day = ist.getUTCDay(); // 0 Sun … 6 Sat
  const diffToMon = (day + 6) % 7;
  const monday = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() - diffToMon));
  const oneJan = new Date(Date.UTC(monday.getUTCFullYear(), 0, 1));
  const week = Math.floor(((monday - oneJan) / 86400000 + oneJan.getUTCDay() + 6) / 7) + 1;
  return `${monday.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function entitlementsFor(tier) {
  return TIER_ENTITLEMENTS[tier] || TIER_ENTITLEMENTS.free;
}

/**
 * Resolve effective tier — expired paid plans fall back to free.
 */
function getEffectiveTier(user) {
  if (!user) return 'free';
  const tier = user.subscriptionTier || 'free';
  if (tier === 'free') return 'free';
  if (user.subscriptionExpiresAt && new Date(user.subscriptionExpiresAt) <= new Date()) {
    return 'free';
  }
  return tier;
}

async function loadUser(userId) {
  const user = await User.findById(userId);
  if (!user) throw AppError.notFound('user_not_found');
  return user;
}

async function ensureWeek(user) {
  const key = currentWeekKey();
  if (user.usageWeekKey !== key) {
    user.usageWeekKey = key;
    user.usageCreateCount = 0;
    user.usageJoinCount = 0;
  }
  return key;
}

function subscriptionSnapshot(user) {
  const tier = getEffectiveTier(user);
  const ents = entitlementsFor(tier);
  const weekKey = user.usageWeekKey === currentWeekKey() ? user.usageWeekKey : currentWeekKey();
  const createUsed = user.usageWeekKey === weekKey ? (user.usageCreateCount || 0) : 0;
  const joinUsed = user.usageWeekKey === weekKey ? (user.usageJoinCount || 0) : 0;
  return {
    tier,
    planId: tier === 'free' ? null : user.subscriptionPlanId ?? null,
    expiresAt: tier === 'free' ? null : user.subscriptionExpiresAt ?? null,
    entitlements: {
      createPerWeek: ents.createPerWeek === Infinity ? null : ents.createPerWeek,
      joinPerWeek: ents.joinPerWeek === Infinity ? null : ents.joinPerWeek,
      dm: ents.dm,
      directPing: ents.directPing,
      unlimitedPings: ents.unlimitedPings,
      highlightTag: ents.highlightTag,
      createSquad: ents.createSquad,
    },
    usage: {
      weekKey,
      createCount: createUsed,
      joinCount: joinUsed,
      createRemaining: ents.unlimitedPings || ents.createPerWeek === Infinity
        ? null
        : Math.max(0, ents.createPerWeek - createUsed),
      joinRemaining: ents.unlimitedPings || ents.joinPerWeek === Infinity
        ? null
        : Math.max(0, ents.joinPerWeek - joinUsed),
    },
  };
}

async function assertCanCreatePing(userId) {
  const user = await loadUser(userId);
  await ensureWeek(user);
  const tier = getEffectiveTier(user);
  const ents = entitlementsFor(tier);
  if (!ents.unlimitedPings && user.usageCreateCount >= ents.createPerWeek) {
    throw AppError.forbidden(
      'quota_create_exhausted',
      `Free plan allows ${ents.createPerWeek} ping(s) per week. Upgrade to create more.`,
      { tier, upgradeTo: tier === 'free' ? 'pro' : 'premium' },
    );
  }
  return user;
}

async function assertCanJoinPing(userId) {
  const user = await loadUser(userId);
  await ensureWeek(user);
  const tier = getEffectiveTier(user);
  const ents = entitlementsFor(tier);
  if (!ents.unlimitedPings && user.usageJoinCount >= ents.joinPerWeek) {
    throw AppError.forbidden(
      'quota_join_exhausted',
      `You've hit this week's join limit (${ents.joinPerWeek}). Upgrade for more.`,
      { tier, upgradeTo: tier === 'free' ? 'pro' : 'premium' },
    );
  }
  return user;
}

async function bumpCreate(userId) {
  const user = await loadUser(userId);
  await ensureWeek(user);
  user.usageCreateCount = (user.usageCreateCount || 0) + 1;
  await user.save();
}

async function bumpJoin(userId) {
  const user = await loadUser(userId);
  await ensureWeek(user);
  user.usageJoinCount = (user.usageJoinCount || 0) + 1;
  await user.save();
}

async function assertCanDm(userId) {
  const user = await loadUser(userId);
  const tier = getEffectiveTier(user);
  if (!entitlementsFor(tier).dm) {
    throw AppError.forbidden(
      'upgrade_required_dm',
      'Direct messages are a Pro feature. Upgrade to chat 1:1.',
      { tier, upgradeTo: 'pro' },
    );
  }
  return user;
}

async function assertCanDirectPing(userId) {
  const user = await loadUser(userId);
  const tier = getEffectiveTier(user);
  if (!entitlementsFor(tier).directPing) {
    throw AppError.forbidden(
      'upgrade_required_direct_ping',
      'Direct pings to non-friends require Pro.',
      { tier, upgradeTo: 'pro' },
    );
  }
  return user;
}

async function assertCanCreateSquad(userId) {
  const user = await loadUser(userId);
  const tier = getEffectiveTier(user);
  if (!entitlementsFor(tier).createSquad) {
    throw AppError.forbidden(
      'upgrade_required_squad',
      'Creating activity groups is a Premium feature.',
      { tier, upgradeTo: 'premium' },
    );
  }
  return user;
}

async function assertCanTagHighlight(userId) {
  const user = await loadUser(userId);
  const tier = getEffectiveTier(user);
  if (!entitlementsFor(tier).highlightTag) {
    throw AppError.forbidden(
      'upgrade_required_highlight',
      'Tagging people in Highlights is a Premium feature.',
      { tier, upgradeTo: 'premium' },
    );
  }
  return user;
}

async function activateSubscription(userId, planId) {
  const plan = SUBSCRIPTION_PLANS[planId];
  if (!plan) throw AppError.badRequest('invalid_plan', 'Unknown subscription plan');

  const user = await loadUser(userId);
  const now = new Date();
  const base =
    user.subscriptionExpiresAt && new Date(user.subscriptionExpiresAt) > now
      && getEffectiveTier(user) === plan.tier
      ? new Date(user.subscriptionExpiresAt)
      : now;
  const expires = new Date(base.getTime() + plan.durationDays * 86_400_000);

  // Allow upgrade: premium replaces pro even if pro still active
  const current = getEffectiveTier(user);
  const rank = { free: 0, pro: 1, premium: 2 };
  if (rank[plan.tier] < rank[current]) {
    throw AppError.badRequest('downgrade_not_allowed', 'Choose a higher tier or wait until your plan expires.');
  }

  user.subscriptionTier = plan.tier;
  user.subscriptionPlanId = plan.planId;
  user.subscriptionExpiresAt = expires;
  if (!user.subscriptionStartedAt) user.subscriptionStartedAt = now;
  await user.save();
  return user;
}

module.exports = {
  currentWeekKey,
  getEffectiveTier,
  entitlementsFor,
  subscriptionSnapshot,
  assertCanCreatePing,
  assertCanJoinPing,
  bumpCreate,
  bumpJoin,
  assertCanDm,
  assertCanDirectPing,
  assertCanCreateSquad,
  assertCanTagHighlight,
  activateSubscription,
  SUBSCRIPTION_PLANS,
};
