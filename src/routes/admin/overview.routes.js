const router = require('express').Router();
const c = require('../../controllers/admin/overviewController');
const { authAdmin, requireAdminRole } = require('../../middleware/adminAuth');

router.use(authAdmin);

router.get('/overview', c.overview);
router.get('/analytics', c.analytics);
router.get('/audit-logs', requireAdminRole(['super_admin']), c.auditLogs);

module.exports = router;
