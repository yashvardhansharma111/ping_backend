const mongoose = require('mongoose');
const {
  USER_STATUS, USER_GENDER,
  OCCUPATION, SLEEP_TYPE, SPONTANEITY, FOOD_PERSONALITY,
  TIME_RESPECT, DISTANCE_TOLERANCE, AVAILABILITY_PATTERN, INTENT_SYNC,
} = require('../utils/enums');

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

    displayName: { type: String, trim: true, maxlength: 60, default: null },
    username: { type: String, trim: true, lowercase: true, default: null, maxlength: 32 },
    avatarUrl: { type: String, default: null },
    bio: { type: String, default: '', maxlength: 500 },
    dob: { type: Date, default: null },
    gender: { type: String, enum: USER_GENDER, default: null },

    city: { type: String, trim: true, maxlength: 60, default: null },
    institute: { type: String, trim: true, maxlength: 80, default: null },
    hobbies: { type: [String], default: [] },
    vibePreferences: { type: [String], default: [] },
    favoriteActivities: { type: [String], default: [] },
    socialPreference: { type: String, default: null },
    instagramHandle: { type: String, trim: true, maxlength: 40, default: null },
    savedProfiles: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

    photos: {
      type: [String],
      default: [],
      validate: { validator: (v) => v.length <= 6, message: 'max 6 photos allowed' },
    },

    // Occupation
    occupation: { type: String, enum: [...OCCUPATION, null], default: null },

    // Compatibility hooks
    sleepType:           { type: String, enum: [...SLEEP_TYPE, null],           default: null },
    spontaneity:         { type: String, enum: [...SPONTANEITY, null],          default: null },
    foodPersonality:     { type: String, enum: [...FOOD_PERSONALITY, null],     default: null },
    timeRespect:         { type: String, enum: [...TIME_RESPECT, null],         default: null },
    distanceTolerance:   { type: String, enum: [...DISTANCE_TOLERANCE, null],   default: null },
    availabilityPattern: { type: String, enum: [...AVAILABILITY_PATTERN, null], default: null },
    intentSync:          { type: String, enum: [...INTENT_SYNC, null],          default: null },
    pingPitch:           { type: String, maxlength: 120, default: null },
    funTruth:            { type: String, maxlength: 120, default: null },

    // Identity verification
    verificationStatus: {
      type: String,
      enum: ['none', 'pending', 'verified', 'rejected'],
      default: 'none',
      index: true,
    },
    verificationSelfieUrl: { type: String, default: null },
    verifiedAt: { type: Date, default: null },
    verificationRejectionReason: { type: String, maxlength: 200, default: null },

    averageRating: { type: Number, default: null },
    ratingCount:   { type: Number, default: 0, min: 0 },

    privacy: { type: PrivacySchema, default: () => ({}) },

    currentLocation: { type: PointSchema, default: null },
    locationUpdatedAt: { type: Date, default: null },

    status: { type: String, enum: USER_STATUS, default: 'active', index: true },
    bannedUntil: { type: Date, default: null },
    strikeCount: { type: Number, default: 0, min: 0 },
    trustRate: { type: Number, default: 100, min: 0, max: 100 },

    fcmTokens: { type: [String], default: [] },
    expoPushToken: { type: String, default: null },
    deviceFingerprints: { type: [String], default: [] },

    lastActiveAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true, toJSON: { virtuals: true, versionKey: false }, toObject: { virtuals: true } },
);

UserSchema.virtual('id').get(function () {
  return this._id.toHexString();
});

// 10-point profile completion: 10% per filled field
UserSchema.virtual('profileCompletion').get(function () {
  const checks = [
    !!this.displayName,
    !!this.username,
    !!(this.bio && this.bio.length > 0),
    !!(this.avatarUrl || this.photos?.length),
    !!this.dob,
    !!this.gender,
    !!this.city,
    !!this.institute,
    !!(this.hobbies?.length),
    !!this.instagramHandle,
  ];
  return checks.filter(Boolean).length * 10; // 0–100
});

UserSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform(_doc, ret) {
    ret.id = ret._id;
    // Keep _id so frontend code using _id works alongside id
    delete ret.deviceFingerprints;
    delete ret.fcmTokens;
    return ret;
  },
});

UserSchema.index({ phone: 1 }, { unique: true });
// Partial-filter indexes: only enforce uniqueness when the field is an actual string,
// so null/missing values (users who haven't set email/username) don't conflict.
UserSchema.index({ email: 1 }, { unique: true, partialFilterExpression: { email: { $type: 'string' } } });
UserSchema.index({ username: 1 }, { unique: true, partialFilterExpression: { username: { $type: 'string' } } });
UserSchema.index({ currentLocation: '2dsphere' });

UserSchema.methods.isBanned = function () {
  if (this.status === 'perm_banned') return true;
  if (this.status === 'temp_banned' && this.bannedUntil && this.bannedUntil > new Date()) return true;
  return false;
};

module.exports = mongoose.model('User', UserSchema);
