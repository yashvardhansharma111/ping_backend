const router = require('express').Router();

router.use('/auth', require('./auth.routes'));
router.use('/users', require('./users.routes'));
router.use('/friends', require('./friends.routes'));
router.use('/squads', require('./squads.routes'));
router.use('/activities', require('./activities.routes'));
router.use('/chat', require('./chat.routes'));
router.use('/ads', require('./ads.routes'));
router.use('/reports', require('./reports.routes'));
router.use('/appeals', require('./appeals.routes'));

router.get('/', (_req, res) => {
  res.json({
    ok: true,
    version: 'v1',
    routes: [
      '/auth', '/users', '/friends', '/squads', '/activities',
      '/chat', '/ads', '/reports', '/appeals',
    ],
  });
});

module.exports = router;
