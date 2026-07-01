const router = require('express').Router();
const { authUser } = require('../../middleware/auth');
const c = require('../../controllers/eventController');

router.get('/',    authUser, c.list);
router.get('/:id', authUser, c.getById);

module.exports = router;
