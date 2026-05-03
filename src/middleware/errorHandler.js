const env = require('../config/env');
const AppError = require('../utils/AppError');

function notFoundHandler(req, res, _next) {
  res.status(404).json({
    error: { code: 'route_not_found', message: `No route for ${req.method} ${req.originalUrl}` },
  });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  // Mongoose validation
  if (err.name === 'ValidationError') {
    const fields = Object.fromEntries(
      Object.entries(err.errors).map(([k, v]) => [k, v.message]),
    );
    return res.status(400).json({ error: { code: 'validation_error', message: 'Invalid input', fields } });
  }

  // Duplicate key
  if (err.code === 11000) {
    return res.status(409).json({
      error: { code: 'duplicate_key', message: 'Already exists', fields: err.keyValue },
    });
  }

  if (err instanceof AppError || err.expose) {
    return res.status(err.status || 400).json({
      error: { code: err.code || 'error', message: err.message, details: err.details },
    });
  }

  console.error('[err]', err);
  res.status(500).json({
    error: {
      code: 'internal_error',
      message: 'Something went wrong',
      ...(env.isDev ? { stack: err.stack } : {}),
    },
  });
}

module.exports = errorHandler;
module.exports.notFoundHandler = notFoundHandler;
