const router = require('express').Router();

const c = require('../../controllers/reportController');
const { authUser } = require('../../middleware/auth');

router.use(authUser);

router.post('/', c.createReport);
router.get('/mine', c.listMyReports);

module.exports = router;
