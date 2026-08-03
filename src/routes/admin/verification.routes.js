const express = require('express');
const router = express.Router();
const { authAdmin, requireAdminRole } = require('../../middleware/adminAuth');
const ctrl = require('../../controllers/adminVerificationController');

router.use(authAdmin);

// GET /api/admin/v1/verifications?status=pending
router.get('/', ctrl.list);

// POST /api/admin/v1/verifications/:id/approve
router.post('/:id/approve', requireAdminRole(['super_admin', 'moderator']), ctrl.approve);

// POST /api/admin/v1/verifications/:id/reject
router.post('/:id/reject', requireAdminRole(['super_admin', 'moderator']), ctrl.reject);

module.exports = router;
