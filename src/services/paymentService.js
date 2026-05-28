const Razorpay = require('razorpay');
const crypto = require('crypto');

const env = require('../config/env');
const Payment = require('../models/Payment');

let _rzp = null;
function getRzp() {
  if (!_rzp) {
    if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) {
      throw Object.assign(new Error('Razorpay credentials not configured'), { status: 500, expose: true });
    }
    _rzp = new Razorpay({ key_id: env.RAZORPAY_KEY_ID, key_secret: env.RAZORPAY_KEY_SECRET });
  }
  return _rzp;
}

async function createOrder({ userId, adId, amountMinor, notes = {} }) {
  const rzpOrder = await getRzp().orders.create({
    amount: amountMinor,
    currency: 'INR',
    receipt: adId.toString().slice(-12),
    notes,
  });

  const payment = await Payment.create({
    userId,
    adId,
    gateway: 'razorpay',
    gatewayOrderId: rzpOrder.id,
    amountMinor,
    currency: 'INR',
    status: 'created',
    rawCreate: rzpOrder,
  });

  return {
    payment,
    order: {
      id: rzpOrder.id,
      amount: rzpOrder.amount,
      currency: rzpOrder.currency,
      keyId: env.RAZORPAY_KEY_ID,
    },
  };
}

async function verifyPayment({ gatewayOrderId, gatewayPaymentId, gatewaySignature, method = 'upi' }) {
  const body = `${gatewayOrderId}|${gatewayPaymentId}`;
  const expected = crypto
    .createHmac('sha256', env.RAZORPAY_KEY_SECRET)
    .update(body)
    .digest('hex');

  if (expected !== gatewaySignature) {
    throw Object.assign(new Error('Payment signature verification failed'), {
      code: 'invalid_signature', status: 400, expose: true,
    });
  }

  const payment = await Payment.findOne({ gatewayOrderId });
  if (!payment) {
    throw Object.assign(new Error('Order not found'), {
      code: 'payment_order_not_found', status: 404, expose: true,
    });
  }
  if (payment.status === 'paid') return payment;
  if (payment.status === 'refunded') {
    throw Object.assign(new Error('Payment already refunded'), {
      code: 'already_refunded', status: 409, expose: true,
    });
  }

  payment.gatewayPaymentId = gatewayPaymentId;
  payment.gatewaySignature = gatewaySignature;
  payment.method = method;
  payment.status = 'paid';
  payment.rawWebhooks.push({ event: 'client_verify', at: new Date() });
  await payment.save();
  return payment;
}

async function refund({ paymentId, reason, amountMinor, processedBy, notes }) {
  const payment = await Payment.findById(paymentId);
  if (!payment) {
    throw Object.assign(new Error('Payment not found'), {
      code: 'payment_not_found', status: 404, expose: true,
    });
  }
  if (payment.status !== 'paid') {
    throw Object.assign(new Error('Only paid payments can be refunded'), {
      code: 'not_refundable', status: 409, expose: true,
    });
  }

  const rzpRefund = await getRzp().payments.refund(payment.gatewayPaymentId, {
    amount: amountMinor ?? payment.amountMinor,
    notes: { reason: reason || 'admin_refund', ...(notes ? { extra: notes } : {}) },
  });

  payment.status = 'refunded';
  payment.refund = {
    refundId: rzpRefund.id,
    reason: reason || 'unspecified',
    amountMinor: rzpRefund.amount,
    processedBy,
    processedAt: new Date(),
    notes: notes || null,
  };
  payment.rawWebhooks.push({ event: 'refund.processed', data: rzpRefund, at: new Date() });
  await payment.save();
  return payment;
}

// Called from the Razorpay webhook — verifies signature and marks payment paid.
async function handleWebhookCapture(rawBody, signature) {
  if (env.RAZORPAY_WEBHOOK_SECRET) {
    const expected = crypto
      .createHmac('sha256', env.RAZORPAY_WEBHOOK_SECRET)
      .update(rawBody)
      .digest('hex');
    if (expected !== signature) {
      throw Object.assign(new Error('Invalid webhook signature'), {
        code: 'invalid_webhook_sig', status: 400, expose: true,
      });
    }
  }

  const event = JSON.parse(rawBody.toString());
  if (event.event !== 'payment.captured') return null;

  const gatewayOrderId = event.payload?.payment?.entity?.order_id;
  const gatewayPaymentId = event.payload?.payment?.entity?.id;
  const method = event.payload?.payment?.entity?.method || 'unknown';
  if (!gatewayOrderId) return null;

  const payment = await Payment.findOne({ gatewayOrderId });
  if (!payment || payment.status === 'paid') return payment;

  payment.gatewayPaymentId = gatewayPaymentId;
  payment.method = method;
  payment.status = 'paid';
  payment.rawWebhooks.push({ event: 'payment.captured', data: event.payload?.payment?.entity, at: new Date() });
  await payment.save();
  return payment;
}

module.exports = { createOrder, verifyPayment, refund, handleWebhookCapture };
