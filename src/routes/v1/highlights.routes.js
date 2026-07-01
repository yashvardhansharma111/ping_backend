const router = require('express').Router();
const { authUser } = require('../../middleware/auth');
const c = require('../../controllers/highlightController');

router.get('/suggest', authUser, c.suggest);
router.get('/user/:userId', authUser, c.listByUser);
router.post('/', authUser, c.create);
router.put('/:id', authUser, c.update);
router.delete('/:id', authUser, c.remove);

module.exports = router;
