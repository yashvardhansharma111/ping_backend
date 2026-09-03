const router = require('express').Router();
const { authAdmin } = require('../../middleware/adminAuth');
const c = require('../../controllers/admin/plansController');

router.use(authAdmin);

router.get('/',          c.listPlans);
router.patch('/:planId', c.updatePlan);

module.exports = router;
