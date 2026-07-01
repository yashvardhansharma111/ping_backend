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
router.use('/upload', require('./upload.routes'));
router.use('/highlights', require('./highlights.routes'));
router.use('/events', require('./events.routes'));

router.get('/', (_req, res) => {
  res.json({
    ok: true,
    version: 'v1',
    routes: [
      '/auth', '/users', '/friends', '/squads', '/activities',
      '/chat', '/ads', '/reports', '/appeals', '/upload', '/highlights', '/events',
    ],
  });
});

module.exports = router;
