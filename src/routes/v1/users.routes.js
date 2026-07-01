const router = require('express').Router();

const c = require('../../controllers/userController');
const { authUser } = require('../../middleware/auth');

router.use(authUser);

router.patch('/me', c.updateMe);
router.patch('/me/privacy', c.updatePrivacy);
router.post('/me/location', c.updateLocation);
router.put('/me/push-token', c.updatePushToken);
router.post('/me/fcm-token', c.addFcmToken);
router.delete('/me/fcm-token', c.removeFcmToken);
router.get('/me/saved', c.getSaved);
router.post('/me/saved/:userId', c.saveProfile);
router.delete('/me/saved/:userId', c.unsaveProfile);
router.delete('/me', c.deleteMe);

router.get('/me/verification', c.getVerificationStatus);
router.post('/me/verification', c.submitVerification);

router.get('/search', c.searchUsers);
router.get('/nearby', c.nearbyUsers);
router.get('/:id', c.getUser);

module.exports = router;
