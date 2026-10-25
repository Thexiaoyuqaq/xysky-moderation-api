const crypto = require('crypto');

function safeEqual(left, right) {
  const a = Buffer.from(String(left ?? ''));
  const b = Buffer.from(String(right ?? ''));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function bearerToken(req) {
  const header = String(req.headers.authorization || '');
  if (!header.startsWith('Bearer ')) return '';
  return header.slice('Bearer '.length).trim();
}

function isLoopback(req) {
  const address = req.socket?.remoteAddress || '';
  return address === '127.0.0.1'
    || address === '::1'
    || address === '::ffff:127.0.0.1';
}

/**
 * Optional bearer auth. With an empty token the API is open (bind to loopback).
 */
function requireToken(config, logger) {
  const token = config.auth?.token || '';

  return (req, res, next) => {
    if (!token) return next();

    const provided = bearerToken(req);
    if (provided && safeEqual(provided, token)) return next();

    logger?.warn('Unauthorized request', req.method, req.path, req.socket?.remoteAddress);
    return res.status(401).json({ error: 'Unauthorized' });
  };
}

/**
 * Dictionary reload is more sensitive: with no token configured it is only
 * allowed from the loopback interface.
 */
function requireReloadAuth(config, logger) {
  const tokenAuth = requireToken(config, logger);

  return (req, res, next) => {
    if (config.auth?.token) return tokenAuth(req, res, next);
    if (isLoopback(req)) return next();
    return res.status(403).json({
      error: 'Reload is only allowed from localhost when auth.token is empty',
    });
  };
}

module.exports = { requireToken, requireReloadAuth, bearerToken, isLoopback, safeEqual };
