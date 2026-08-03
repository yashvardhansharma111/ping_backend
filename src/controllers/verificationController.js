const { uploadBuffer } = require('../services/storageService');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const VerificationRequest = require('../models/VerificationRequest');
const User = require('../models/User');

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_SIZE = 10 * 1024 * 1024; // 10 MB

function selfieExt(mimetype) {
  if (mimetype === 'image/png') return 'png';
  if (mimetype === 'image/webp') return 'webp';
  return 'jpg';
}

/**
 * POST /api/v1/verification/request
 * multipart/form-data field: "selfie"
 * body field:  poseInstruction (string)
 * Returns { ok, request: { _id, status, poseInstruction, createdAt } }
 */
exports.requestVerification = asyncHandler(async (req, res) => {
  console.log('[verify] requestVerification called — userId:', req.userId);
  console.log('[verify] file received:', req.file
    ? `name=${req.file.originalname} mime=${req.file.mimetype} size=${req.file.size}`
    : 'NONE');

  if (!req.file) {
    throw new AppError(400, 'missing_file', 'Selfie image is required (field name: "selfie")');
  }
  if (!ALLOWED_MIME.has(req.file.mimetype)) {
    throw new AppError(400, 'invalid_type', 'Only JPEG, PNG and WebP images are allowed');
  }
  if (req.file.size > MAX_SIZE) {
    throw new AppError(400, 'file_too_large', 'Selfie must be 10 MB or smaller');
  }

  const poseInstruction = (req.body?.poseInstruction || '').toString().trim();
  console.log('[verify] poseInstruction:', poseInstruction || 'MISSING');
  if (!poseInstruction) {
    throw new AppError(400, 'missing_pose', 'poseInstruction is required');
  }

  const userId = req.userId;

  // Upload selfie to R2
  const key = `verifications/${userId}/${Date.now()}.${selfieExt(req.file.mimetype)}`;
  console.log('[verify] uploading to R2 key:', key);
  const selfieUrl = await uploadBuffer(key, req.file.buffer, req.file.mimetype);
  console.log('[verify] R2 upload done — selfieUrl:', selfieUrl);

  // Delete any existing pending requests for this user (clean slate for retry)
  await VerificationRequest.deleteMany({ userId, status: 'pending' });

  // Create new request
  const request = await VerificationRequest.create({
    userId,
    selfieUrl,
    poseInstruction,
    status: 'pending',
  });
  console.log('[verify] VerificationRequest created — _id:', request._id, 'selfieUrl:', request.selfieUrl);

  // Mark user as pending verification
  await User.findByIdAndUpdate(userId, {
    verificationStatus: 'pending',
    verificationSelfieUrl: selfieUrl,
  });

  res.json({
    ok: true,
    request: {
      _id: request._id,
      status: request.status,
      poseInstruction: request.poseInstruction,
      createdAt: request.createdAt,
    },
  });
});

/**
 * GET /api/v1/verification/status
 * Returns { ok, verificationStatus, request? }
 */
exports.getVerificationStatus = asyncHandler(async (req, res) => {
  const userId = req.userId;

  // Fetch the user's current verification status
  const user = await User.findById(userId).select('verificationStatus verifiedAt verificationRejectionReason').lean();
  if (!user) throw AppError.notFound('user_not_found');

  // Find the most recent verification request
  const request = await VerificationRequest.findOne({ userId })
    .sort({ createdAt: -1 })
    .select('_id status poseInstruction selfieUrl rejectionReason createdAt reviewedAt')
    .lean();

  res.json({
    ok: true,
    verificationStatus: user.verificationStatus,
    verifiedAt: user.verifiedAt ?? null,
    rejectionReason: user.verificationRejectionReason ?? null,
    request: request || null,
  });
});
