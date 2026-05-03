const router = require('express').Router();

const c = require('../../controllers/activityController');
const { authUser } = require('../../middleware/auth');

router.use(authUser);

// Specific paths first so they don't get swallowed by /:id
router.get('/nearby', c.nearby);
router.get('/mine', c.mine);
router.get('/joined', c.joined);

router.post('/', c.createActivity);
router.get('/:id', c.getActivity);
router.patch('/:id', c.updateActivity);
router.delete('/:id', c.cancelActivity);

router.post('/:id/join', c.joinActivity);
router.post('/:id/leave', c.leaveActivity);
router.post('/:id/on-my-way', c.onMyWay);
router.post('/:id/arrived', c.arrived);

module.exports = router;
