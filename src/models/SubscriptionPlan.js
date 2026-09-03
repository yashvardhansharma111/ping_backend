const mongoose = require('mongoose');
const { SUBSCRIPTION_PLANS } = require('../utils/enums');

const SubscriptionPlanSchema = new mongoose.Schema(
  {
    planId:        { type: String, required: true, unique: true },
    tier:          { type: String, enum: ['pro', 'premium'], required: true },
    label:         { type: String, required: true, maxlength: 80 },
    intervalLabel: { type: String, required: true, maxlength: 40 },
    amountMinor:   { type: Number, required: true, min: 100 },
    durationDays:  { type: Number, required: true, min: 1 },
    isActive:      { type: Boolean, default: true },
  },
  { timestamps: true },
);

/** Seeds the collection from the hardcoded enum if it is empty. */
SubscriptionPlanSchema.statics.seedIfEmpty = async function () {
  const count = await this.countDocuments();
  if (count > 0) return;
  const docs = Object.values(SUBSCRIPTION_PLANS);
  await this.insertMany(docs);
};

module.exports = mongoose.model('SubscriptionPlan', SubscriptionPlanSchema);
