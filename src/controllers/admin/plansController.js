const asyncHandler = require('../../utils/asyncHandler');
const AppError = require('../../utils/AppError');
const SubscriptionPlan = require('../../models/SubscriptionPlan');

// GET /api/admin/v1/plans
const listPlans = asyncHandler(async (_req, res) => {
  await SubscriptionPlan.seedIfEmpty();
  const plans = await SubscriptionPlan.find().sort({ tier: 1, durationDays: 1 }).lean();
  res.json({ ok: true, plans });
});

// PATCH /api/admin/v1/plans/:planId
const updatePlan = asyncHandler(async (req, res) => {
  const plan = await SubscriptionPlan.findOne({ planId: req.params.planId });
  if (!plan) throw AppError.notFound('plan_not_found', 'Plan not found');

  if (req.body.amountMinor !== undefined) {
    const amount = Number(req.body.amountMinor);
    if (!Number.isInteger(amount) || amount < 100) {
      throw AppError.badRequest('invalid_amount', 'amountMinor must be an integer ≥ 100 (paise)');
    }
    plan.amountMinor = amount;
  }

  if (req.body.label !== undefined) {
    const label = String(req.body.label).trim();
    if (!label || label.length > 80) throw AppError.badRequest('invalid_label', 'label must be 1–80 chars');
    plan.label = label;
  }

  if (req.body.isActive !== undefined) {
    plan.isActive = !!req.body.isActive;
  }

  await plan.save();
  res.json({ ok: true, plan });
});

module.exports = { listPlans, updatePlan };
