const mongoose = require('mongoose');

const CouponRedemptionSchema = new mongoose.Schema(
  {
    couponId: { type: mongoose.Schema.Types.ObjectId, ref: 'Coupon', required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    planId: { type: String, required: true },
    paymentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment', default: null },
    at: { type: Date, default: Date.now },
  },
  { timestamps: false },
);

CouponRedemptionSchema.index({ couponId: 1, userId: 1 });
CouponRedemptionSchema.index({ paymentId: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('CouponRedemption', CouponRedemptionSchema);
