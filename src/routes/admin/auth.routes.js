const router = require('express').Router();
const c = require('../../controllers/admin/authController');
const { authAdmin } = require('../../middleware/adminAuth');

router.post('/login', c.login);
router.post('/seed', c.seed); // dev-only — guarded inside the controller
router.get('/me', authAdmin, c.me);

module.exports = router;
