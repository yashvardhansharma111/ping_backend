const router = require('express').Router();
const c = require('../../controllers/admin/moderationController');
const { authAdmin, requireAdminRole } = require('../../middleware/adminAuth');

router.use(authAdmin);
router.use(requireAdminRole(['super_admin', 'moderator']));

router.get('/', c.listReports);
router.get('/:id', c.getReport);
router.post('/:id/dismiss', c.dismiss);
router.post('/:id/remove', c.remove);
router.post('/:id/remove-and-warn', c.removeAndWarn);
router.post('/:id/remove-and-ban', c.removeAndBan);
router.post('/:id/escalate', c.escalate);

module.exports = router;
