const AppError = require('../utils/AppError');
const Coupon = require('../models/Coupon');
const CouponRedemption = require('../models/CouponRedemption');
const Payment = require('../models/Payment');
const SubscriptionPlan = require('../models/SubscriptionPlan');
const { SUBSCRIPTION_PLANS } = require('../utils/enums');

/** Enum plan merged with the admin-editable DB price/label. */
async function resolvePlan(planId, { requireActive = false } = {}) {
  const enumPlan = SUBSCRIPTION_PLANS[planId];
  if (!enumPlan) throw AppError.badRequest('invalid_plan', 'Unknown plan');
  await SubscriptionPlan.seedIfEmpty();
  const db = await SubscriptionPlan.findOne({ planId }).lean().catch(() => null);
  if (requireActive && db && !db.isActive) throw AppError.badRequest('plan_inactive', 'This plan is not available right now');
  return db
    ? { ...enumPlan, amountMinor: db.amountMinor, label: db.label, isActive: db.isActive }
    : { ...enumPlan, isActive: true };
}

async function listPlans() {
  await SubscriptionPlan.seedIfEmpty();
  const rows = await SubscriptionPlan.find().lean();
  const byId = new Map(rows.map((r) => [r.planId, r]));
  return Object.values(SUBSCRIPTION_PLANS)
    .map((p) => {
      const db = byId.get(p.planId);
      return {
        planId: p.planId,
        tier: p.tier,
        label: db?.label ?? p.label,
        intervalLabel: p.intervalLabel,
        amountMinor: db?.amountMinor ?? p.amountMinor,
        amountRupees: (db?.amountMinor ?? p.amountMinor) / 100,
        durationDays: p.durationDays,
        isActive: db ? db.isActive : true,
      };
    })
    .filter((p) => p.isActive);
}

function computeDiscount(coupon, baseMinor) {
  const discount = coupon.discountType === 'percent'
    ? Math.round((baseMinor * coupon.value) / 100)
    : Math.min(baseMinor, coupon.value);
  return { discountMinor: discount, finalMinor: Math.max(0, baseMinor - discount) };
}

/**
 * Validates a coupon for a user + plan and returns the priced result.
 * Throws AppError with a user-readable message on any failure.
 */
async function validateCoupon({ code, planId, userId }) {
  const normalized = String(code ?? '').trim().toUpperCase();
  if (!normalized) throw AppError.badRequest('coupon_required', 'Enter a coupon code');

  const coupon = await Coupon.findOne({ code: normalized });
  if (!coupon) throw AppError.badRequest('coupon_not_found', "That coupon doesn't exist");
  if (!coupon.isActive) throw AppError.badRequest('coupon_inactive', 'This coupon is no longer active');

  const now = Date.now();
  if (coupon.startsAt && coupon.startsAt.getTime() > now) throw AppError.badRequest('coupon_not_started', 'This coupon is not live yet');
  if (coupon.expiresAt && coupon.expiresAt.getTime() < now) throw AppError.badRequest('coupon_expired', 'This coupon has expired');
  if (coupon.maxRedemptions != null && coupon.redemptionCount >= coupon.maxRedemptions) {
    throw AppError.badRequest('coupon_exhausted', 'This coupon has been fully redeemed');
  }

  const plan = await resolvePlan(planId, { requireActive: true });
  if (coupon.appliesToTiers.length && !coupon.appliesToTiers.includes(plan.tier)) {
    throw AppError.badRequest('coupon_not_applicable', `This coupon is for ${coupon.appliesToTiers.join(' / ')} plans`);
  }
  if (coupon.appliesToPlanIds.length && !coupon.appliesToPlanIds.includes(plan.planId)) {
    const labels = coupon.appliesToPlanIds.map((id) => SUBSCRIPTION_PLANS[id]?.label ?? id).join(', ');
    throw AppError.badRequest('coupon_not_applicable', `This coupon only works on ${labels}`);
  }

  const uses = await CouponRedemption.countDocuments({ couponId: coupon._id, userId });
  if (uses >= coupon.perUserLimit) throw AppError.badRequest('coupon_already_used', "You've already used this coupon");

  if (coupon.firstTimeOnly) {
    const paidBefore = await Payment.exists({ userId, purpose: 'subscription', status: 'paid' });
    if (paidBefore) throw AppError.badRequest('coupon_first_time_only', 'This coupon is only for your first plan');
  }

  const { discountMinor, finalMinor } = computeDiscount(coupon, plan.amountMinor);
  return { coupon, plan, baseMinor: plan.amountMinor, discountMinor, finalMinor };
}

async function redeem({ coupon, userId, planId, paymentId = null }) {
  if (paymentId && (await CouponRedemption.exists({ paymentId }))) return;
  await CouponRedemption.create({ couponId: coupon._id, userId, planId, paymentId });
  await Coupon.updateOne({ _id: coupon._id }, { $inc: { redemptionCount: 1 } });
}

/** Idempotent: records the redemption for a paid payment that carried a coupon. */
async function redeemForPayment(payment) {
  if (!payment?.couponCode) return;
  const coupon = await Coupon.findOne({ code: payment.couponCode });
  if (!coupon) return;
  await redeem({ coupon, userId: payment.userId, planId: payment.planId, paymentId: payment._id });
}

function publicCoupon(c) {
  return {
    code: c.code,
    description: c.description,
    discountType: c.discountType,
    value: c.value,
    appliesToTiers: c.appliesToTiers,
    appliesToPlanIds: c.appliesToPlanIds,
    firstTimeOnly: c.firstTimeOnly,
    expiresAt: c.expiresAt,
  };
}

async function featuredCoupon() {
  const now = new Date();
  const c = await Coupon.findOne({
    isFeatured: true,
    isActive: true,
    $and: [
      { $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] },
      { $or: [{ startsAt: null }, { startsAt: { $lte: now } }] },
    ],
  }).sort({ updatedAt: -1 }).lean();
  return c ? publicCoupon(c) : null;
}

module.exports = { resolvePlan, listPlans, validateCoupon, redeem, redeemForPayment, featuredCoupon, publicCoupon };
