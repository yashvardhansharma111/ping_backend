// Dummy payment service that mimics the Razorpay surface area we'll use.
// Swap the bodies of these functions for real SDK calls when the gateway
// keys land — the controllers above this file shouldn't need to change.
//
// Real flow we're shadowing:
//   1. createOrder()      → server hits Razorpay /orders, returns order_id
//   2. mobile launches Razorpay SDK with order_id → user pays → SDK returns
//      { razorpay_order_id, razorpay_payment_id, razorpay_signature }
//   3. verifyPayment()    → server HMAC-verifies the signature
//   4. webhook            → Razorpay POSTs payment.captured / refund.processed
//   5. refund()           → server hits Razorpay /payments/{id}/refund

const crypto = require('crypto');

const Payment = require('../models/Payment');

function fakeId(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

// Create a payment order. Returns the Payment document and the gateway order
// payload the client would normally hand to the Razorpay SDK.
async function createOrder({ userId, adId, amountMinor, notes = {} }) {
  const gatewayOrderId = fakeId('order');
  const payment = await Payment.create({
    userId,
    adId,
    gateway: 'razorpay',
    gatewayOrderId,
    amountMinor,
    currency: 'INR',
    status: 'created',
    rawCreate: { stub: true, notes, createdAt: new Date() },
  });
  return {
    payment,
    order: {
      id: gatewayOrderId,
      amount: amountMinor,
      currency: 'INR',
      receipt: String(payment._id),
      // In real Razorpay this is the public key id. With the stub we just
      // expose enough that the mobile-side flow can keep its shape.
      keyId: 'rzp_test_stub',
      stub: true,
    },
  };
}

// Verify a payment. In the stub we accept anything that contains the order id
// we issued — no signature math. Marks the Payment paid and returns it.
async function verifyPayment({
  gatewayOrderId,
  gatewayPaymentId,
  gatewaySignature,
  method = 'upi',
}) {
  const payment = await Payment.findOne({ gatewayOrderId });
  if (!payment) {
    const err = new Error('payment_order_not_found');
    err.code = 'payment_order_not_found';
    err.status = 404;
    err.expose = true;
    throw err;
  }
  if (payment.status === 'paid') return payment; // idempotent
  if (payment.status === 'refunded') {
    const err = new Error('Payment already refunded');
    err.code = 'already_refunded';
    err.status = 409;
    err.expose = true;
    throw err;
  }

  payment.gatewayPaymentId = gatewayPaymentId || fakeId('pay');
  payment.gatewaySignature = gatewaySignature || 'stub_signature';
  payment.method = method;
  payment.status = 'paid';
  payment.rawWebhooks.push({ stub: true, event: 'payment.captured', at: new Date() });
  await payment.save();
  return payment;
}

// Refund a paid payment. In the stub we just flip the status and stamp the
// refund subdoc; in production this would call Razorpay /refunds.
async function refund({ paymentId, reason, amountMinor, processedBy, notes }) {
  const payment = await Payment.findById(paymentId);
  if (!payment) {
    const err = new Error('Payment not found');
    err.code = 'payment_not_found';
    err.status = 404;
    err.expose = true;
    throw err;
  }
  if (payment.status !== 'paid') {
    const err = new Error('Only paid payments can be refunded');
    err.code = 'not_refundable';
    err.status = 409;
    err.expose = true;
    throw err;
  }

  payment.status = 'refunded';
  payment.refund = {
    refundId: fakeId('rfnd'),
    reason: reason || 'unspecified',
    amountMinor: amountMinor ?? payment.amountMinor,
    processedBy,
    processedAt: new Date(),
    notes: notes || null,
  };
  payment.rawWebhooks.push({ stub: true, event: 'refund.processed', at: new Date() });
  await payment.save();
  return payment;
}

module.exports = { createOrder, verifyPayment, refund };
