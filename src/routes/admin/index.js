const router = require('express').Router();

// Index handler must come before any sub-router mounted at '/' so it isn't
// shadowed by their middleware (e.g. authAdmin in overview.routes.js).
router.get('/', (_req, res) => {
  res.json({
    ok: true,
    version: 'admin-v1',
    routes: ['/auth', '/users', '/payments', '/reports', '/appeals', '/overview', '/analytics', '/audit-logs'],
  });
});

router.use('/auth', require('./auth.routes'));
router.use('/users', require('./users.routes'));
router.use('/payments', require('./payments.routes'));
router.use('/reports', require('./moderation.routes'));
router.use('/appeals', require('./appeals.routes'));
router.use('/events', require('./events.routes'));

// /overview, /analytics, /audit-logs all live in overview.routes.js
router.use('/', require('./overview.routes'));

module.exports = router;
