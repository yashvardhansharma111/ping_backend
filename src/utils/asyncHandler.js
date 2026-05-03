// Wrap async route handlers so thrown errors / rejections reach the
// errorHandler middleware instead of crashing the process.
module.exports = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
