const asyncHandler = require('../../utils/asyncHandler');
const AppError = require('../../utils/AppError');
const Coupon = require('../../models/Coupon');
const CouponRedemption = require('../../models/CouponRedemption');
const { SUBSCRIPTION_PLANS } = require('../../utils/enums');

const TIERS = ['pro', 'premium'];

function parseDate(val, field) {
  if (val === undefined) return undefined;
  if (val === null || val === '') return null;
  const d = new Date(val);
  if (isNaN(d.getTime())) throw AppError.badRequest(`invalid_${field}`, `${field} is not a valid date`);
  return d;
}

function readCouponBody(body, { partial = false } = {}) {
  const out = {};

  if (!partial || body.code !== undefined) {
    const code = String(body.code ?? '').trim().toUpperCase();
    if (!/^[A-Z0-9_-]{2,24}$/.test(code)) throw AppError.badRequest('invalid_code', 'Code must be 2–24 letters/numbers');
    out.code = code;
  }
  if (body.description !== undefined) out.description = String(body.description).slice(0, 120);

  if (!partial || body.discountType !== undefined) {
    if (!['percent', 'flat'].includes(body.discountType)) throw AppError.badRequest('invalid_discount_type', 'discountType must be percent or flat');
    out.discountType = body.discountType;
  }
  if (!partial || body.value !== undefined) {
    const value = Number(body.value);
    const type = out.discountType ?? body.discountType;
    if (!Number.isInteger(value) || value < 1) throw AppError.badRequest('invalid_value', 'value must be a positive integer');
    if (type === 'percent' && value > 100) throw AppError.badRequest('invalid_value', 'percent cannot exceed 100');
    out.value = value;
  }

  if (body.appliesToTiers !== undefined) {
    const tiers = Array.isArray(body.appliesToTiers) ? body.appliesToTiers.map(String) : [];
    if (tiers.some((t) => !TIERS.includes(t))) throw AppError.badRequest('invalid_tiers', 'appliesToTiers may only contain pro / premium');
    out.appliesToTiers = tiers;
  }
  if (body.appliesToPlanIds !== undefined) {
    const ids = Array.isArray(body.appliesToPlanIds) ? body.appliesToPlanIds.map(String) : [];
    if (ids.some((id) => !SUBSCRIPTION_PLANS[id])) throw AppError.badRequest('invalid_plan_ids', 'Unknown planId in appliesToPlanIds');
    out.appliesToPlanIds = ids;
  }

  if (body.firstTimeOnly !== undefined) out.firstTimeOnly = !!body.firstTimeOnly;
  if (body.isFeatured !== undefined) out.isFeatured = !!body.isFeatured;
  if (body.isActive !== undefined) out.isActive = !!body.isActive;

  if (body.maxRedemptions !== undefined) {
    if (body.maxRedemptions === null || body.maxRedemptions === '') out.maxRedemptions = null;
    else {
      const n = Number(body.maxRedemptions);
      if (!Number.isInteger(n) || n < 1) throw AppError.badRequest('invalid_max', 'maxRedemptions must be a positive integer or empty');
      out.maxRedemptions = n;
    }
  }
  if (body.perUserLimit !== undefined) {
    const n = Number(body.perUserLimit);
    if (!Number.isInteger(n) || n < 1) throw AppError.badRequest('invalid_per_user', 'perUserLimit must be ≥ 1');
    out.perUserLimit = n;
  }

  const startsAt = parseDate(body.startsAt, 'startsAt');
  if (startsAt !== undefined) out.startsAt = startsAt;
  const expiresAt = parseDate(body.expiresAt, 'expiresAt');
  if (expiresAt !== undefined) out.expiresAt = expiresAt;

  return out;
}

// GET /api/admin/v1/coupons
const list = asyncHandler(async (_req, res) => {
  await Coupon.seedDefaults();
  const coupons = await Coupon.find().sort({ createdAt: -1 }).lean();
  res.json({ ok: true, coupons, plans: Object.values(SUBSCRIPTION_PLANS).map((p) => ({ planId: p.planId, tier: p.tier, label: p.label })) });
});

// POST /api/admin/v1/coupons
const create = asyncHandler(async (req, res) => {
  const data = readCouponBody(req.body ?? {});
  if (await Coupon.exists({ code: data.code })) throw AppError.conflict('coupon_exists', 'A coupon with this code already exists');
  if (data.isFeatured) await Coupon.updateMany({ isFeatured: true }, { $set: { isFeatured: false } });
  const coupon = await Coupon.create({ ...data, createdByAdmin: req.adminId ?? null });
  res.status(201).json({ ok: true, coupon });
});

// PATCH /api/admin/v1/coupons/:id
const update = asyncHandler(async (req, res) => {
  const coupon = await Coupon.findById(req.params.id);
  if (!coupon) throw AppError.notFound('coupon_not_found', 'Coupon not found');
  const data = readCouponBody(req.body ?? {}, { partial: true });
  if (data.code && data.code !== coupon.code && (await Coupon.exists({ code: data.code }))) {
    throw AppError.conflict('coupon_exists', 'A coupon with this code already exists');
  }
  if (data.isFeatured) await Coupon.updateMany({ _id: { $ne: coupon._id }, isFeatured: true }, { $set: { isFeatured: false } });
  Object.assign(coupon, data);
  await coupon.save();
  res.json({ ok: true, coupon });
});

// DELETE /api/admin/v1/coupons/:id
const remove = asyncHandler(async (req, res) => {
  const coupon = await Coupon.findById(req.params.id);
  if (!coupon) throw AppError.notFound('coupon_not_found', 'Coupon not found');
  await coupon.deleteOne();
  res.json({ ok: true });
});

// GET /api/admin/v1/coupons/:id/redemptions
const redemptions = asyncHandler(async (req, res) => {
  const rows = await CouponRedemption.find({ couponId: req.params.id })
    .sort({ at: -1 })
    .limit(200)
    .populate('userId', 'displayName username phone')
    .lean();
  res.json({ ok: true, redemptions: rows });
});

module.exports = { list, create, update, remove, redemptions };
