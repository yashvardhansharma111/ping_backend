const router = require('express').Router();
const c = require('../../controllers/admin/appealController');
const { authAdmin, requireAdminRole } = require('../../middleware/adminAuth');

router.use(authAdmin);
router.use(requireAdminRole(['super_admin', 'moderator']));

router.get('/', c.listAppeals);
router.get('/:id', c.getAppeal);
router.post('/:id/approve', c.approve);
router.post('/:id/deny', c.deny);
router.post('/:id/request-info', c.requestInfo);

module.exports = router;
