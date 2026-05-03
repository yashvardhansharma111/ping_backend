const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const env = require('./config/env');
const v1Routes = require('./routes/v1');
const adminRoutes = require('./routes/admin');
const sanitize = require('./middleware/sanitize');
const errorHandler = require('./middleware/errorHandler');
const { notFoundHandler } = require('./middleware/errorHandler');

function buildApp() {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(helmet());
  app.use(
    cors({
      origin(origin, cb) {
        if (!origin) return cb(null, true);
        if (env.CORS_ALLOWED_ORIGINS.length === 0) return cb(null, true);
        if (env.CORS_ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
        return cb(new Error(`CORS: origin ${origin} not allowed`));
      },
      credentials: true,
    }),
  );

  if (!env.isTest) app.use(morgan(env.isProd ? 'combined' : 'dev'));

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.use(sanitize);

  app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'ping-api', env: env.NODE_ENV });
  });

  app.use('/api/v1', v1Routes);
  app.use('/api/admin/v1', adminRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = buildApp;
