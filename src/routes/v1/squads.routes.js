const router = require('express').Router();

const c = require('../../controllers/squadController');
const { authUser } = require('../../middleware/auth');

router.use(authUser);

router.get('/', c.listSquads);
router.post('/', c.createSquad);
router.get('/:id', c.getSquad);
router.patch('/:id', c.updateSquad);
router.delete('/:id', c.deleteSquad);

router.post('/:id/members', c.addMembers);
router.delete('/:id/members/:userId', c.removeMember);
router.post('/:id/leave', c.leaveSquad);

module.exports = router;
