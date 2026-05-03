const asyncHandler = require('../../utils/asyncHandler');
const AppError = require('../../utils/AppError');
const v = require('../../utils/validate');
const { PAYMENT_STATUS, AD_TIER } = require('../../utils/enums');

const Payment = require('../../models/Payment');
const Ad = require('../../models/Ad');
const auditLogger = require('../../services/auditLogger');
const paymentService = require('../../services/paymentService');

// GET /api/admin/v1/payments?from=&to=&tier=&status=&q=&page=
const listPayments = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);

  const where = {};
  if (req.query.status) where.status = v.requireEnum(req.query.status, 'status', PAYMENT_STATUS);
  if (req.query.from || req.query.to) {
    where.createdAt = {};
    if (req.query.from) where.createdAt.$gte = new Date(req.query.from);
    if (req.query.to) where.createdAt.$lte = new Date(req.query.to);
  }

  // tier filter requires joining to Ad
  if (req.query.tier) {
    const tier = v.requireEnum(req.query.tier, 'tier', AD_TIER);
    const adIds = await Ad.find({ tier }).distinct('_id');
    where.adId = { $in: adIds };
  }

  if (req.query.q) {
    where.$or = [
      { gatewayOrderId: req.query.q },
      { gatewayPaymentId: req.query.q },
    ];
  }

  const [items, total, summary] = await Promise.all([
    Payment.find(where)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('userId', 'displayName username phone'),
    Payment.countDocuments(where),
    Payment.aggregate([
      { $match: { status: 'paid' } },
      { $group: { _id: null, totalMinor: { $sum: '$amountMinor' }, count: { $sum: 1 } } },
    ]),
  ]);

  res.json({
    ok: true,
    items,
    page,
    limit,
    total,
    summary: summary[0] || { totalMinor: 0, count: 0 },
  });
});

// GET /api/admin/v1/payments/:id
const getPayment = asyncHandler(async (req, res) => {
  const id = v.requireObjectId(req.params.id, 'id');
  const payment = await Payment.findById(id)
    .populate('userId', 'displayName username phone email')
    .populate('adId', 'businessName tier status');
  if (!payment) throw AppError.notFound('payment_not_found');
  res.json({ ok: true, payment });
});

// POST /api/admin/v1/payments/:id/refund   body: { reason, amountMinor?, notes? }
const refundPayment = asyncHandler(async (req, res) => {
  const id = v.requireObjectId(req.params.id, 'id');
  const reason = v.requireString(req.body?.reason, 'reason', { min: 2, max: 200 });
  const notes = v.optionalString(req.body?.notes, 'notes', { max: 500 }) ?? null;
  const amountMinor = req.body?.amountMinor != null
    ? v.requireNumber(req.body.amountMinor, 'amountMinor', { min: 1, integer: true })
    : undefined;

  const payment = await paymentService.refund({
    paymentId: id,
    reason,
    amountMinor,
    processedBy: req.adminId,
    notes,
  });

  // Knock the related ad off the live feed if it's still active.
  if (payment.adId) {
    await Ad.updateOne(
      { _id: payment.adId, status: 'live' },
      { $set: { status: 'refunded' } },
    );
  }

  await auditLogger.record({
    admin: req.admin, req, action: 'refund_processed',
    targetType: 'payment', targetId: id,
    details: { reason, amountMinor: payment.refund.amountMinor, adId: payment.adId },
  });

  res.json({ ok: true, payment });
});

module.exports = { listPayments, getPayment, refundPayment };
