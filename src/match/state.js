/**
 * Optional in-process user state.
 *
 * The service must stay useful when this is disabled, so nothing here is
 * required for correctness - it only adds signals that need history:
 * duplicate messages, flood, and repeat-offender escalation.
 *
 * Privacy: only a truncated text hash, timestamps and counters are stored.
 * Raw messages never enter this module.
 */
const { LRUCache } = require('lru-cache');

function stateHit(id, description, severity = 2, action = 'review') {
  return {
    type: 'state',
    id,
    source: 'state',
    category: 'spam',
    level: severity >= 3 ? 'high' : 'medium',
    severity,
    action,
    neverBlock: false,
    description,
    original: null,
    matched: '',
    start: 0,
    end: 0,
  };
}

class UserStateStore {
  constructor(config = {}, options = {}) {
    this.config = config;
    this.now = options.now || (() => Date.now());
    this.store = new LRUCache({ max: Math.max(1, config.maxUsers || 20000) });
  }

  get enabled() {
    return this.config.enabled !== false;
  }

  get size() {
    return this.store.size;
  }

  _entry(userId, now) {
    const ttlMs = Math.max(1, Number(this.config.ttlSeconds) || 600) * 1000;
    let entry = this.store.get(userId);

    if (!entry || now - entry.lastAt > ttlMs) {
      entry = {
        lastHash: '',
        lastAt: now,
        duplicateCount: 0,
        windowStart: now,
        count: 0,
        floodFlagged: false,
        violations: [],
      };
      this.store.set(userId, entry);
    }

    return entry;
  }

  /**
   * @param {string} userId
   * @param {string} textHash
   * @param {Array} messageHits hits found for the current message
   * @param {number} now epoch ms
   * @returns {{hits:Array, escalation:number}}
   */
  observe(userId, textHash, messageHits, now = this.now()) {
    if (!this.enabled || !userId) return { hits: [], escalation: 0 };

    const entry = this._entry(userId, now);
    const hits = [];

    // flood window
    const flood = this.config.flood || {};
    const floodWindowMs = Math.max(1000, Number(flood.windowMs) || 10000);
    if (now - entry.windowStart > floodWindowMs) {
      entry.windowStart = now;
      entry.count = 0;
      entry.floodFlagged = false;
    }
    entry.count += 1;

    if (entry.count > Math.max(1, Number(flood.max) || 8) && !entry.floodFlagged) {
      entry.floodFlagged = true;
      hits.push(stateHit('state.flood', `发送频率过高 (${entry.count}/${floodWindowMs}ms)`));
    }

    // duplicate messages
    const duplicateWindowMs = Math.max(
      1000,
      Number(this.config.duplicateWindowMs) || 60000
    );
    const duplicateThreshold = Math.max(2, Number(this.config.duplicateThreshold) || 3);

    if (entry.lastHash && entry.lastHash === textHash && now - entry.lastAt <= duplicateWindowMs) {
      entry.duplicateCount += 1;
    } else {
      entry.duplicateCount = 1;
    }

    if (entry.duplicateCount >= duplicateThreshold) {
      entry.duplicateCount = 0;
      hits.push(stateHit('state.duplicate', '短时间内重复发送相同内容'));
    }

    entry.lastHash = textHash;
    entry.lastAt = now;

    // repeat offender: count messages (not individual hits) with severity >= 2
    const worstSeverity = messageHits.reduce(
      (max, hit) => Math.max(max, Number(hit.severity) || 0),
      0
    );
    if (worstSeverity >= 2) entry.violations.push(now);
    if (entry.violations.length > 200) {
      entry.violations = entry.violations.slice(-200);
    }

    const violationWindowMs = Math.max(
      60000,
      Number(this.config.violationWindowMs) || 600000
    );
    entry.violations = entry.violations.filter(time => now - time <= violationWindowMs);

    const violationThreshold = Math.max(
      2,
      Number(this.config.violationThreshold) || 3
    );
    const escalation = entry.violations.length >= violationThreshold ? 1 : 0;

    return { hits, escalation };
  }
}

module.exports = { UserStateStore, stateHit };
