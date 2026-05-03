const mongoose = require('mongoose');
const { USER_STATUS } = require('../utils/enums');

const PointSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: {
      type: [Number],
      validate: {
        validator: (v) => Array.isArray(v) && v.length === 2,
        message: 'coordinates must be [lng, lat]',
      },
    },
  },
  { _id: false },
);

const PrivacySchema = new mongoose.Schema(
  {
    ghostMode: { type: Boolean, default: false },
    locationSharing: { type: Boolean, default: true },
    autoShutoffAt: { type: Date, default: null },
  },
  { _id: false },
);

const UserSchema = new mongoose.Schema(
  {
    phone: { type: String, required: true, trim: true },
    phoneVerifiedAt: { type: Date, default: null },

    email: { type: String, lowercase: true, trim: true, default: null },
    emailVerifiedAt: { type: Date, default: null },

    displayName: { type: String, required: true, trim: true, maxlength: 60 },
    username: { type: String, trim: true, lowercase: true, default: null, maxlength: 32 },
    avatarUrl: { type: String, default: null },
    bio: { type: String, default: '', maxlength: 280 },
    dob: { type: Date, default: null },

    privacy: { type: PrivacySchema, default: () => ({}) },

    currentLocation: { type: PointSchema, default: null },
    locationUpdatedAt: { type: Date, default: null },

    status: { type: String, enum: USER_STATUS, default: 'active', index: true },
    bannedUntil: { type: Date, default: null },
    strikeCount: { type: Number, default: 0, min: 0 },
    trustRate: { type: Number, default: 100, min: 0, max: 100 },

    fcmTokens: { type: [String], default: [] },
    deviceFingerprints: { type: [String], default: [] },

    lastActiveAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true, toJSON: { virtuals: true, versionKey: false }, toObject: { virtuals: true } },
);

UserSchema.virtual('id').get(function () {
  return this._id.toHexString();
});

UserSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform(_doc, ret) {
    ret.id = ret._id;
    delete ret._id;
    delete ret.deviceFingerprints;
    delete ret.fcmTokens;
    return ret;
  },
});

UserSchema.index({ phone: 1 }, { unique: true });
UserSchema.index({ email: 1 }, { unique: true, sparse: true });
UserSchema.index({ username: 1 }, { unique: true, sparse: true });
UserSchema.index({ currentLocation: '2dsphere' });

UserSchema.methods.isBanned = function () {
  if (this.status === 'perm_banned') return true;
  if (this.status === 'temp_banned' && this.bannedUntil && this.bannedUntil > new Date()) return true;
  return false;
};

module.exports = mongoose.model('User', UserSchema);
