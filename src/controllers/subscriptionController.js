const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const v = require('../utils/validate');
const env = require('../config/env');

const Payment = require('../models/Payment');
const User = require('../models/User');
const paymentService = require('../services/paymentService');
const subscriptionService = require('../services/subscriptionService');
const { SUBSCRIPTION_PLANS } = require('../utils/enums');

function listPlansPayload() {
  return Object.values(SUBSCRIPTION_PLANS).map((p) => ({
    planId: p.planId,
    tier: p.tier,
    label: p.label,
    intervalLabel: p.intervalLabel,
    amountMinor: p.amountMinor,
    amountRupees: p.amountMinor / 100,
    durationDays: p.durationDays,
  }));
}

// GET /api/v1/subscriptions/plans
const listPlans = asyncHandler(async (_req, res) => {
  res.json({
    ok: true,
    plans: listPlansPayload(),
    tiers: {
      free: {
        name: 'Free',
        features: [
          '1 ping create / week',
          '1 ping join / week',
          'Group chat in pings',
          'Friend requests',
        ],
      },
      pro: {
        name: 'Pro',
        features: [
          'Direct messages (DM)',
          'Direct pings to non-friends',
          '5 creates / week',
          '15 joins / week',
        ],
      },
      premium: {
        name: 'Premium',
        features: [
          'Unlimited create & join',
          'Tag people in Highlights',
          'Create activity groups',
          'Everything in Pro',
        ],
      },
    },
  });
});

// GET /api/v1/subscriptions/me
const getMine = asyncHandler(async (req, res) => {
  const user = await User.findById(req.userId);
  if (!user) throw AppError.notFound('user_not_found');
  res.json({ ok: true, subscription: subscriptionService.subscriptionSnapshot(user) });
});

// POST /api/v1/subscriptions/order  body: { planId }
const createOrder = asyncHandler(async (req, res) => {
  const planId = v.requireString(req.body?.planId, 'planId', { min: 3, max: 40 });
  const plan = SUBSCRIPTION_PLANS[planId];
  if (!plan) throw AppError.badRequest('invalid_plan', 'Unknown plan');

  const { payment, order } = await paymentService.createOrder({
    userId: req.userId,
    adId: null,
    amountMinor: plan.amountMinor,
    purpose: 'subscription',
    planId: plan.planId,
    notes: { purpose: 'subscription', planId: plan.planId, userId: String(req.userId) },
  });

  const checkoutUrl =
    `${env.API_BASE_URL}/pay?orderId=${encodeURIComponent(order.id)}` +
    `&amount=${order.amount}&keyId=${encodeURIComponent(order.keyId)}` +
    `&purpose=subscription&planId=${encodeURIComponent(plan.planId)}` +
    `&name=${encodeURIComponent(plan.label)}`;

  res.json({
    ok: true,
    paymentId: String(payment._id),
    order,
    plan,
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

  const payment = await paymentService.verifyPayment({
    gatewayOrderId, gatewayPaymentId, gatewaySignature, method,
  });
  if (payment.purpose !== 'subscription' || !payment.planId) {
    throw AppError.badRequest('not_subscription', 'This payment is not a subscription order');
  }
  if (!payment.userId.equals(req.userId)) {
    throw AppError.forbidden('not_your_payment');
  }

  const user = await subscriptionService.activateSubscription(req.userId, payment.planId);
  res.json({
    ok: true,
    subscription: subscriptionService.subscriptionSnapshot(user),
  });
});

// POST /api/v1/subscriptions/mock-activate  body: { planId }
// Testing bypass — always enabled; swap for real payment when going live
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

module.exports = { listPlans, getMine, createOrder, verifyPayment, mockActivate };
