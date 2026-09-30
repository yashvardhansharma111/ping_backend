const router = require('express').Router();
const { authAdmin } = require('../../middleware/adminAuth');
const c = require('../../controllers/admin/couponsController');

router.use(authAdmin);

router.get('/', c.list);
router.post('/', c.create);
router.patch('/:id', c.update);
router.delete('/:id', c.remove);
router.get('/:id/redemptions', c.redemptions);

module.exports = router;
