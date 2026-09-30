const mongoose = require('mongoose');

const CouponSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true, maxlength: 24 },
    description: { type: String, default: '', maxlength: 120 },
    discountType: { type: String, enum: ['percent', 'flat'], required: true },
    // percent: 1–100; flat: paise
    value: { type: Number, required: true, min: 1 },
    // [] means "any"
    appliesToTiers: { type: [String], default: [] },
    appliesToPlanIds: { type: [String], default: [] },
    firstTimeOnly: { type: Boolean, default: false },
    // Surfaced in the app (onboarding + plan picker) as the headline offer
    isFeatured: { type: Boolean, default: false },
    maxRedemptions: { type: Number, default: null },
    perUserLimit: { type: Number, default: 1, min: 1 },
    redemptionCount: { type: Number, default: 0 },
    startsAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
    isActive: { type: Boolean, default: true },
    createdByAdmin: { type: mongoose.Schema.Types.ObjectId, ref: 'AdminUser', default: null },
  },
  { timestamps: true },
);

CouponSchema.statics.seedDefaults = async function () {
  if (await this.exists({ code: 'WELCOME0' })) return;
  await this.create({
    code: 'WELCOME0',
    description: '1 month of Pro free for new members',
    discountType: 'percent',
    value: 100,
    appliesToTiers: ['pro'],
    appliesToPlanIds: ['pro_monthly'],
    firstTimeOnly: true,
    isFeatured: true,
    perUserLimit: 1,
  });
};

module.exports = mongoose.model('Coupon', CouponSchema);
