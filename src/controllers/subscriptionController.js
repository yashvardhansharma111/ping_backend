const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const v = require('../utils/validate');
const env = require('../config/env');

const Payment = require('../models/Payment');
const User = require('../models/User');
const paymentService = require('../services/paymentService');
const subscriptionService = require('../services/subscriptionService');
const couponService = require('../services/couponService');
const { SUBSCRIPTION_PLANS } = require('../utils/enums');

// Razorpay refuses orders under ₹1
const GATEWAY_MIN_MINOR = 100;

const TIERS = {
  free: {
    name: 'Free',
    features: ['1 ping create / week', '1 ping join / week', 'Group chat in pings', 'Friend requests'],
  },
  pro: {
    name: 'Pro',
    features: ['Direct messages (DM)', 'Direct pings to non-friends', '5 creates / week', '7 joins / week'],
  },
  premium: {
    name: 'Premium',
    features: ['Unlimited create & join', 'Tag people in Highlights', 'Create activity groups', 'Everything in Pro'],
  },
};

// GET /api/v1/subscriptions/plans — prices come from the DB (admin-editable)
const listPlans = asyncHandler(async (_req, res) => {
  const plans = await couponService.listPlans();
  res.json({ ok: true, plans, tiers: TIERS });
});

// GET /api/v1/subscriptions/coupons/featured — public headline offer (may be null)
const featuredCoupon = asyncHandler(async (_req, res) => {
  res.json({ ok: true, coupon: await couponService.featuredCoupon() });
});

// GET /api/v1/subscriptions/me
const getMine = asyncHandler(async (req, res) => {
  const user = await User.findById(req.userId);
  if (!user) throw AppError.notFound('user_not_found');
  res.json({ ok: true, subscription: subscriptionService.subscriptionSnapshot(user) });
});

// POST /api/v1/subscriptions/coupon/preview  body: { code, planId }
const previewCoupon = asyncHandler(async (req, res) => {
  const code = v.requireString(req.body?.code, 'code', { min: 2, max: 24 });
  const planId = v.requireString(req.body?.planId, 'planId', { min: 3, max: 40 });
  const r = await couponService.validateCoupon({ code, planId, userId: req.userId });
  res.json({
    ok: true,
    coupon: couponService.publicCoupon(r.coupon),
    planId: r.plan.planId,
    baseMinor: r.baseMinor,
    discountMinor: r.discountMinor,
    finalMinor: r.finalMinor,
  });
});

// POST /api/v1/subscriptions/order  body: { planId, couponCode? }
// ₹0 after coupon → activates immediately (no gateway round-trip).
const createOrder = asyncHandler(async (req, res) => {
  const planId = v.requireString(req.body?.planId, 'planId', { min: 3, max: 40 });
  const couponCode = v.optionalString(req.body?.couponCode, 'couponCode', { max: 24 }) ?? null;

  let plan;
  let coupon = null;
  let discountMinor = 0;
  let amountMinor;

  if (couponCode) {
    const r = await couponService.validateCoupon({ code: couponCode, planId, userId: req.userId });
    plan = r.plan;
    coupon = r.coupon;
    discountMinor = r.discountMinor;
    amountMinor = r.finalMinor;
  } else {
    plan = await couponService.resolvePlan(planId, { requireActive: true });
    amountMinor = plan.amountMinor;
  }

  if (amountMinor <= 0) {
    const payment = await Payment.create({
      userId: req.userId,
      purpose: 'subscription',
      planId: plan.planId,
      gateway: 'razorpay',
      amountMinor: 0,
      currency: 'INR',
      status: 'paid',
      method: 'coupon',
      couponCode: coupon.code,
      discountMinor,
      rawCreate: { coupon: coupon.code },
    });
    await couponService.redeem({ coupon, userId: req.userId, planId: plan.planId, paymentId: payment._id });
    const user = await subscriptionService.activateSubscription(req.userId, plan.planId);
    return res.json({
      ok: true,
      activated: true,
      paymentId: String(payment._id),
      plan,
      amountMinor: 0,
      discountMinor,
      subscription: subscriptionService.subscriptionSnapshot(user),
    });
  }

  const chargeMinor = Math.max(GATEWAY_MIN_MINOR, amountMinor);
  const { payment, order } = await paymentService.createOrder({
    userId: req.userId,
    adId: null,
    amountMinor: chargeMinor,
    purpose: 'subscription',
    planId: plan.planId,
    notes: { purpose: 'subscription', planId: plan.planId, userId: String(req.userId), coupon: coupon?.code ?? '' },
  });
  if (coupon) {
    payment.couponCode = coupon.code;
    payment.discountMinor = discountMinor;
    await payment.save();
  }

  const checkoutUrl =
    `${env.API_BASE_URL}/pay?orderId=${encodeURIComponent(order.id)}` +
    `&amount=${order.amount}&keyId=${encodeURIComponent(order.keyId)}` +
    `&purpose=subscription&planId=${encodeURIComponent(plan.planId)}` +
    `&name=${encodeURIComponent(plan.label)}`;

  res.json({
    ok: true,
    activated: false,
    paymentId: String(payment._id),
    order,
    plan,
    amountMinor: chargeMinor,
    discountMinor,
    checkoutUrl,
  });
});

// POST /api/v1/subscriptions/verify-payment
// body: { gatewayOrderId, gatewayPaymentId, gatewaySignature, method? }
const verifyPayment = asyncHandler(async (req, res) => {
  const gatewayOrderId = v.requireString(req.body?.gatewayOrderId, 'gatewayOrderId', { min: 5, max: 80 });
  const gatewayPaymentId = v.requireString(req.body?.gatewayPaymentId, 'gatewayPaymentId', { min: 5, max: 80 });
  const gatewaySignature = v.requireString(req.body?.gatewaySignature, 'gatewaySignature', { min: 10, max: 200 });
  const method = v.optionalString(req.body?.method, 'method', { max: 40 }) ?? 'upi';

  const payment = await paymentService.verifyPayment({ gatewayOrderId, gatewayPaymentId, gatewaySignature, method });
  if (payment.purpose !== 'subscription' || !payment.planId) {
    throw AppError.badRequest('not_subscription', 'This payment is not a subscription order');
  }
  if (!payment.userId.equals(req.userId)) throw AppError.forbidden('not_your_payment');

  const user = await subscriptionService.activateSubscription(req.userId, payment.planId);
  await couponService.redeemForPayment(payment);
  res.json({ ok: true, subscription: subscriptionService.subscriptionSnapshot(user) });
});

// POST /api/v1/subscriptions/mock-activate  body: { planId } — dev/testing bypass
const mockActivate = asyncHandler(async (req, res) => {
  const planId = v.requireString(req.body?.planId, 'planId', { min: 3, max: 40 });
  if (!SUBSCRIPTION_PLANS[planId]) throw AppError.badRequest('invalid_plan');

  await Payment.create({
    userId: req.userId,
    purpose: 'subscription',
    planId,
    gateway: 'razorpay',
    amountMinor: SUBSCRIPTION_PLANS[planId].amountMinor,
    currency: 'INR',
    status: 'paid',
    method: 'mock',
    rawCreate: { mock: true },
  });

  const user = await subscriptionService.activateSubscription(req.userId, planId);
  res.json({ ok: true, subscription: subscriptionService.subscriptionSnapshot(user) });
});

module.exports = { listPlans, featuredCoupon, getMine, previewCoupon, createOrder, verifyPayment, mockActivate };
