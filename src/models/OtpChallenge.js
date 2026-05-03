const mongoose = require('mongoose');

// One row per OTP request. Code is stored hashed. Mongo TTL index expires the
// document automatically once `expiresAt` passes — no cron needed.
const OtpChallengeSchema = new mongoose.Schema(
  {
    phone: { type: String, required: true, index: true },
    purpose: { type: String, enum: ['signup_login'], default: 'signup_login' },
    codeHash: { type: String, required: true },
    attempts: { type: Number, default: 0 },
    consumedAt: { type: Date, default: null },
    expiresAt: { type: Date, required: true },
    requestIp: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

OtpChallengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
OtpChallengeSchema.index({ phone: 1, createdAt: -1 });

module.exports = mongoose.model('OtpChallenge', OtpChallengeSchema);
