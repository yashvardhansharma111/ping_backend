const router = require('express').Router();

const c = require('../../controllers/chatController');
const { authUser } = require('../../middleware/auth');

router.use(authUser);

router.get('/rooms', c.listRooms);
router.post('/rooms/dm', c.openDm);
router.post('/rooms/activity/:activityId', c.openActivityRoom);
router.post('/rooms/squad/:squadId', c.openSquadRoom);
router.get('/rooms/:id', c.getRoom);
router.get('/rooms/:id/messages', c.listMessages);
router.post('/rooms/:id/messages', c.sendMessage);
router.post('/rooms/:id/read', c.markRead);

router.delete('/messages/:id', c.deleteMessage);

module.exports = router;
