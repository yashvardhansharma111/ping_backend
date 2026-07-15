const mongoose = require('mongoose');

// Each issued refresh token gets a row keyed by `jti` (JWT id). Token plaintext
// is never stored — we keep a sha256 hash so a stolen DB row can't be replayed.
// Rotation: when a token is used, set `revokedAt` and `replacedByJti`.
const RefreshTokenSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    jti: { type: String, required: true, unique: true },
    tokenHash: { type: String, required: true },

    deviceInfo: {
      platform: String,
      model: String,
      appVersion: String,
      ip: String,
      userAgent: String,
    },

    revokedAt: { type: Date, default: null },
    replacedByJti: { type: String, default: null },
    revokeReason: { type: String, default: null }, // logout | rotated | reused | admin
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

RefreshTokenSchema.index({ userId: 1, revokedAt: 1 });

module.exports = mongoose.model('RefreshToken', RefreshTokenSchema);
