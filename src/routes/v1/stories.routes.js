const router = require('express').Router();

const c = require('../../controllers/storyController');
const { authUser } = require('../../middleware/auth');

router.use(authUser);

router.post('/', c.create);
router.get('/feed', c.feed);
router.get('/user/:userId', c.byUser);
router.get('/:id/viewers', c.viewers);
router.post('/:id/view', c.view);
router.delete('/:id', c.remove);

module.exports = router;
