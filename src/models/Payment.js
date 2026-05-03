const mongoose = require('mongoose');
const { PAYMENT_STATUS, PAYMENT_GATEWAY } = require('../utils/enums');

const RefundSchema = new mongoose.Schema(
  {
    refundId: { type: String, default: null },
    reason: { type: String, default: null },
    amountMinor: { type: Number, default: 0 },
    processedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'AdminUser', default: null },
    processedAt: { type: Date, default: null },
    notes: { type: String, default: null },
  },
  { _id: false },
);

const PaymentSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    adId: { type: mongoose.Schema.Types.ObjectId, ref: 'Ad', default: null, index: true },

    gateway: { type: String, enum: PAYMENT_GATEWAY, default: 'razorpay' },
    gatewayOrderId: { type: String, default: null, index: true },
    gatewayPaymentId: { type: String, default: null, index: true },
    gatewaySignature: { type: String, default: null },

    amountMinor: { type: Number, required: true, min: 0 }, // INR paise
    currency: { type: String, default: 'INR' },
    method: { type: String, default: null }, // upi, card, netbanking, ...

    status: { type: String, enum: PAYMENT_STATUS, default: 'created', index: true },
    refund: { type: RefundSchema, default: null },

    rawCreate: { type: mongoose.Schema.Types.Mixed, default: null },
    rawWebhooks: { type: [mongoose.Schema.Types.Mixed], default: [] },
  },
  { timestamps: true },
);

PaymentSchema.index({ status: 1, createdAt: -1 });
PaymentSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('Payment', PaymentSchema);
