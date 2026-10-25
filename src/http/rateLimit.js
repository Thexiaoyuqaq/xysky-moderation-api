/**
 * Fixed-window per-IP rate limiter with a bounded bucket map. /health is
 * exempt so orchestrators can probe without spending the client's budget.
 */
function createRateLimiter(config, logger) {
  const settings = config.rateLimit || {};
  const buckets = new Map();

  const timer = setInterval(() => {
    const now = Date.now();
    for (const [ip, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(ip);
    }
  }, Math.max(1000, Number(settings.windowMs) || 10000));
  timer.unref?.();

  return (req, res, next) => {
    if (settings.enabled === false || req.path === '/health') return next();

    const ip = req.socket?.remoteAddress || 'unknown';
    const now = Date.now();
    let bucket = buckets.get(ip);

    if (!bucket || bucket.resetAt <= now) {
      if (buckets.size >= (Number(settings.maxBuckets) || 10000)) {
        // Drop the oldest entry instead of growing without bound.
        const oldest = buckets.keys().next().value;
        if (oldest !== undefined) buckets.delete(oldest);
      }
      bucket = { count: 0, resetAt: now + (Number(settings.windowMs) || 10000) };
      buckets.set(ip, bucket);
    }

    bucket.count += 1;
    if (bucket.count > (Number(settings.max) || 120)) {
      logger?.warn('Rate limit exceeded', ip, req.path);
      res.set('Retry-After', String(Math.ceil((bucket.resetAt - now) / 1000)));
      return res.status(429).json({ error: 'Too many requests' });
    }

    return next();
  };
}

module.exports = { createRateLimiter };
