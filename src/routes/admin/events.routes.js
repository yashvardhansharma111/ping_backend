const router = require('express').Router();
const { authAdmin } = require('../../middleware/adminAuth');
const c = require('../../controllers/eventController');

router.use(authAdmin);

router.get('/',     c.adminList);
router.post('/',    c.adminCreate);
router.put('/:id',  c.adminUpdate);
router.delete('/:id', c.adminDelete);

module.exports = router;
