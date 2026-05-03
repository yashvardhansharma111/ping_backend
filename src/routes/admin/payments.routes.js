const router = require('express').Router();
const c = require('../../controllers/admin/paymentController');
const { authAdmin, requireAdminRole } = require('../../middleware/adminAuth');

router.use(authAdmin);

router.get('/', requireAdminRole(['super_admin', 'finance']), c.listPayments);
router.get('/:id', requireAdminRole(['super_admin', 'finance']), c.getPayment);
router.post('/:id/refund', requireAdminRole(['super_admin', 'finance']), c.refundPayment);

module.exports = router;
