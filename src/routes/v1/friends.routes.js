const router = require('express').Router();

const c = require('../../controllers/friendController');
const { authUser } = require('../../middleware/auth');

router.use(authUser);

router.get('/', c.listFriends);
router.get('/requests', c.listRequests);
router.post('/request', c.sendRequest);
router.post('/:userId/accept', c.acceptRequest);
router.post('/:userId/reject', c.rejectRequest);
router.post('/:userId/block', c.blockUser);
router.post('/:userId/unblock', c.unblockUser);
router.delete('/:userId', c.removeFriend);

module.exports = router;
