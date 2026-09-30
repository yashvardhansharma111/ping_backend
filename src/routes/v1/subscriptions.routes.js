const router = require('express').Router();
const { authUser } = require('../../middleware/auth');
const c = require('../../controllers/subscriptionController');

router.get('/plans', c.listPlans);
router.get('/coupons/featured', c.featuredCoupon);
router.get('/me', authUser, c.getMine);
router.post('/coupon/preview', authUser, c.previewCoupon);
router.post('/order', authUser, c.createOrder);
router.post('/verify-payment', authUser, c.verifyPayment);
router.post('/mock-activate', authUser, c.mockActivate);

module.exports = router;
