const rateLimit = require('express-rate-limit');

// Per-IP limit — coarse first line of defence. The OTP endpoint also enforces
// a per-phone cooldown inside the controller.
const otpRequestLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'rate_limited', message: 'Too many OTP requests from this IP' } },
});

const otpVerifyLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'rate_limited', message: 'Too many verification attempts from this IP' } },
});

module.exports = { otpRequestLimiter, otpVerifyLimiter };
