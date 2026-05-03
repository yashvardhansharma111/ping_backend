// Strip Mongo operator keys ($foo) and dotted keys from request bodies and
// params. Express 5 makes req.query a getter-only property, so we don't touch
// it — Mongoose `strictQuery: true` already blocks unknown query operators.
function clean(value) {
  if (Array.isArray(value)) {
    for (const v of value) clean(v);
    return;
  }
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      if (key.startsWith('$') || key.includes('.')) {
        delete value[key];
      } else {
        clean(value[key]);
      }
    }
  }
}

module.exports = function sanitize(req, _res, next) {
  if (req.body) clean(req.body);
  if (req.params) clean(req.params);
  next();
};
