// Throw these from controllers/services. The errorHandler middleware turns them
// into well-formed JSON responses; anything else becomes a 500.
class AppError extends Error {
  constructor(status, code, message, details = undefined) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
    this.expose = true; // safe to send to client
  }
}

AppError.badRequest = (code, msg, details) => new AppError(400, code, msg, details);
AppError.unauthorized = (code = 'unauthorized', msg = 'Unauthorized') => new AppError(401, code, msg);
AppError.forbidden = (code = 'forbidden', msg = 'Forbidden', details) => new AppError(403, code, msg, details);
AppError.notFound = (code = 'not_found', msg = 'Not found') => new AppError(404, code, msg);
AppError.conflict = (code, msg) => new AppError(409, code, msg);
AppError.tooMany = (code = 'rate_limited', msg = 'Too many requests') => new AppError(429, code, msg);

module.exports = AppError;
