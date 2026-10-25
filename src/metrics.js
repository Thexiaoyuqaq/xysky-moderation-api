/**
 * In-process metrics for /v1/stats and /health. No external dependency and no
 * per-request allocation beyond a counter bump.
 */
class Metrics {
  constructor() {
    this.startedAt = Date.now();
    this.requests = 0;
    this.errors = 0;
    this.cacheHits = 0;
    this.cacheMisses = 0;
    this.actions = Object.create(null);
    this.categories = Object.create(null);
    this.durationSum = 0;
    this.durationMax = 0;
  }

  record({ action, violations = [], durationMs = 0, cached = false }) {
    this.requests += 1;
    this.actions[action] = (this.actions[action] || 0) + 1;

    if (cached) this.cacheHits += 1;

    this.durationSum += durationMs;
    if (durationMs > this.durationMax) this.durationMax = durationMs;

    const seen = new Set();
    for (const violation of violations) {
      if (!violation.category || seen.has(violation.category)) continue;
      seen.add(violation.category);
      this.categories[violation.category] = (this.categories[violation.category] || 0) + 1;
    }
  }

  recordMiss() {
    this.cacheMisses += 1;
  }

  recordError() {
    this.errors += 1;
  }

  snapshot() {
    return {
      uptimeMs: Date.now() - this.startedAt,
      requests: this.requests,
      errors: this.errors,
      actions: { ...this.actions },
      categories: { ...this.categories },
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
      avgMs: this.requests > 0 ? Number((this.durationSum / this.requests).toFixed(3)) : 0,
      maxMs: this.durationMax,
    };
  }
}

module.exports = { Metrics };
