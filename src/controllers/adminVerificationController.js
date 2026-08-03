const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const VerificationRequest = require('../models/VerificationRequest');
const User = require('../models/User');
const auditLogger = require('../services/auditLogger');

/**
 * GET /api/admin/v1/verifications?status=pending
 * Lists verification requests. status: pending | approved | rejected | all
 */
exports.list = asyncHandler(async (req, res) => {
  const statusParam = (req.query.status || 'pending').toString();
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);

  const filter = {};
  if (statusParam !== 'all') {
    const allowed = ['pending', 'approved', 'rejected'];
    if (!allowed.includes(statusParam)) {
      throw new AppError(400, 'invalid_status', `status must be one of: ${allowed.join(', ')} or all`);
    }
    filter.status = statusParam;
  }

  const [requests, total] = await Promise.all([
    VerificationRequest.find(filter)
      .sort({ createdAt: statusParam === 'pending' ? 1 : -1 }) // oldest pending first
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('userId', 'displayName username avatarUrl phone')
      .lean(),
    VerificationRequest.countDocuments(filter),
  ]);

  console.log('[admin/verify] list — filter:', filter, 'total:', total, 'returned:', requests.length);
  requests.forEach((r) => {
    console.log(`  _id=${r._id} status=${r.status} selfieUrl=${r.selfieUrl} userId=${r.userId?._id ?? r.userId}`);
  });

  res.json({ ok: true, requests, total, page });
});

/**
 * POST /api/admin/v1/verifications/:id/approve
 */
exports.approve = asyncHandler(async (req, res) => {
  const request = await VerificationRequest.findById(req.params.id);
  if (!request) throw AppError.notFound('request_not_found', 'Verification request not found');
  if (request.status !== 'pending') {
    throw AppError.badRequest('not_pending', 'This request is not in pending state');
  }

  request.status = 'approved';
  request.reviewedBy = req.adminId;
  request.reviewedAt = new Date();
  request.rejectionReason = null;
  await request.save();

  await User.findByIdAndUpdate(request.userId, {
    verificationStatus: 'verified',
    verifiedAt: new Date(),
    verificationRejectionReason: null,
  });

  await auditLogger.record({
    admin: req.admin,
    req,
    action: 'verify_approve',
    targetType: 'user',
    targetId: request.userId,
    details: { requestId: request._id },
  });

  res.json({ ok: true });
});

/**
 * POST /api/admin/v1/verifications/:id/reject
 * body: { reason? }
 */
exports.reject = asyncHandler(async (req, res) => {
  const request = await VerificationRequest.findById(req.params.id);
  if (!request) throw AppError.notFound('request_not_found', 'Verification request not found');
  if (request.status !== 'pending') {
    throw AppError.badRequest('not_pending', 'This request is not in pending state');
  }

  const reason = (req.body?.reason || 'Verification rejected.').toString().slice(0, 200);

  request.status = 'rejected';
  request.reviewedBy = req.adminId;
  request.reviewedAt = new Date();
  request.rejectionReason = reason;
  await request.save();

  await User.findByIdAndUpdate(request.userId, {
    verificationStatus: 'none',
    verifiedAt: null,
    verificationRejectionReason: reason,
  });

  await auditLogger.record({
    admin: req.admin,
    req,
    action: 'verify_reject',
    targetType: 'user',
    targetId: request.userId,
    details: { requestId: request._id, reason },
  });

  res.json({ ok: true });
});
