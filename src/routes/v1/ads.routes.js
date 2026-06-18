const router = require('express').Router();

const c = require('../../controllers/adController');
const { authUser, maybeAuthUser } = require('../../middleware/auth');

// Specific paths first
router.get('/feed', maybeAuthUser, c.feed);
router.post('/:id/view', maybeAuthUser, c.recordView);
router.post('/:id/swipe', maybeAuthUser, c.recordSwipe);
router.post('/:id/contact', maybeAuthUser, c.recordContactTap);

// Authed-only
router.use(authUser);

router.post('/', c.createDraft);
router.get('/mine', c.listMyAds);
router.get('/:id', c.getMyAd);
router.patch('/:id', c.updateDraft);
router.post('/:id/order', c.createPaymentOrder);
router.post('/:id/verify-payment', c.verifyPaymentAndLaunch);
router.post('/:id/mock-activate', c.mockActivate);
router.get('/:id/analytics', c.getAnalytics);

router.post('/:id/thumbs-up', c.thumbsUp);
router.post('/:id/want-to-visit', c.addWantToVisit);
router.delete('/:id/want-to-visit', c.removeWantToVisit);

module.exports = router;
