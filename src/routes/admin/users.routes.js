const router = require('express').Router();
const c = require('../../controllers/admin/userController');
const { authAdmin, requireAdminRole } = require('../../middleware/adminAuth');

router.use(authAdmin);

router.get('/', c.listUsers);
router.get('/verifications', c.listPendingVerifications);
router.get('/:id', c.getUserDetail);

// Mutating actions: super_admin and moderator
router.post('/:id/warn', requireAdminRole(['super_admin', 'moderator']), c.warnUser);
router.post('/:id/ban', requireAdminRole(['super_admin', 'moderator']), c.banUser);
router.post('/:id/unban', requireAdminRole(['super_admin', 'moderator']), c.unbanUser);

// Hard delete is super_admin only
router.delete('/:id', requireAdminRole(['super_admin']), c.deleteUser);

router.post('/:id/verify/approve', requireAdminRole(['super_admin', 'moderator']), c.approveVerification);
router.post('/:id/verify/reject', requireAdminRole(['super_admin', 'moderator']), c.rejectVerification);

module.exports = router;
