const { uploadBuffer } = require('../services/storageService');
const AppError = require('../utils/AppError');

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MAX_SIZE = 5 * 1024 * 1024; // 5 MB

function ext(mimetype) {
  switch (mimetype) {
    case 'image/jpeg': return 'jpg';
    case 'image/png':  return 'png';
    case 'image/webp': return 'webp';
    case 'image/gif':  return 'gif';
    default: return 'jpg';
  }
}

/**
 * POST /api/v1/upload/image
 * multipart/form-data field: "image"
 * Returns { ok, url }
 */
exports.uploadImage = async (req, res, next) => {
  try {
    if (!req.file) throw new AppError(400, 'missing_file', 'No image file provided (field name: "image")');
    if (!ALLOWED_MIME.has(req.file.mimetype)) throw new AppError(400, 'invalid_type', 'Only JPEG, PNG, WebP, and GIF images are allowed');
    if (req.file.size > MAX_SIZE) throw new AppError(400, 'file_too_large', 'Image must be 5 MB or smaller');

    const folder = req.body.folder || 'misc';
    const key = `${folder}/${req.user.id}/${Date.now()}.${ext(req.file.mimetype)}`;
    const url = await uploadBuffer(key, req.file.buffer, req.file.mimetype);
    res.json({ ok: true, url });
  } catch (err) {
    next(err);
  }
};
