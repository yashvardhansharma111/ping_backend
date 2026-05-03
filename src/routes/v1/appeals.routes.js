const router = require('express').Router();

// Note: no authUser middleware — banned users can't pass it. The controller
// validates the token manually and only allows banned users through.
const c = require('../../controllers/appealController');

router.post('/', c.submitAppeal);
router.post('/respond', c.respondToInfoRequest);

module.exports = router;
