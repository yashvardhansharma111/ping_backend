const router = require('express').Router();

const c = require('../../controllers/authController');
const { authUser } = require('../../middleware/auth');
const { otpRequestLimiter, otpVerifyLimiter } = require('../../middleware/rateLimit');

router.post('/otp/request', otpRequestLimiter, c.requestOtp);
router.post('/otp/verify', otpVerifyLimiter, c.verifyOtpAndLogin);
router.post('/refresh', c.refresh);
router.post('/logout', c.logout);

router.post('/logout-all', authUser, c.logoutAll);
router.get('/me', authUser, c.me);
router.get('/sessions', authUser, c.listSessions);

module.exports = router;
