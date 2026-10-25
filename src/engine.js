/**
 * Moderation engine: orchestrates text views, matchers, optional user state,
 * allowlist suppression, policy and the wire response.
 *
 * Controllers/routes only call `moderate()`; every matching and policy decision
 * happens here or below.
 */
const crypto = require('crypto');
const { LRUCache } = require('lru-cache');
const { buildViews } = require('./text/views');
const { searchLexicon } = require('./match/lexicon');
const { searchRules } = require('./match/rules');
const { searchHeuristics } = require('./match/heuristics');
const { applyAllowlist } = require('./match/allowlist');
const { UserStateStore } = require('./match/state');
const { decideVerdict } = require('./policy/verdict');
const { applyNegationContext } = require('./policy/context');
const { buildResponse } = require('./response/builder');

function hashText(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16);
}

function cacheKey(scope, text) {
  return `${scope}\u0000${text}`;
}

class ModerationEngine {
  constructor(options) {
    this.config = options.config;
    this.dictionary = options.dictionary;
    this.logger = options.logger;
    this.metrics = options.metrics;
    this.state = new UserStateStore(this.config.state || {});

    const cacheConfig = this.config.cache || {};
    this.cache = cacheConfig.enabled === false
      ? null
      : new LRUCache({ max: Math.max(1, cacheConfig.maxEntries || 5000) });
  }

  get cacheTtlMs() {
    return Math.max(0, Number(this.config.cache?.ttlSeconds) || 0) * 1000;
  }

  replaceDictionary(dictionary) {
    this.dictionary = dictionary;
    if (this.cache) this.cache.clear();
  }

  /**
   * @param {{text:string, scope?:string, userId?:string|null, locale?:string|null, context?:any}} input
   */
  moderate(input = {}) {
    const startedAt = Date.now();
    const raw = String(input.text ?? '');
    const scope = input.scope || this.config.moderation.defaultScope || 'chat';
    const userId = input.userId || null;

    // Stateful verdicts depend on history, so they must never be served from
    // the shared text cache.
    const stateful = this.state.enabled && Boolean(userId);
    const ttlMs = this.cacheTtlMs;

    if (this.cache && !stateful && ttlMs > 0) {
      const key = cacheKey(scope, raw);
      const cached = this.cache.get(key);
      if (cached) {
        this.metrics.record({
          action: cached.action,
          violations: cached.violations,
          durationMs: Date.now() - startedAt,
          cached: true,
        });
        return { ...cached, cached: true };
      }
      this.metrics.recordMiss();
    }

    const views = buildViews(raw);
    const rawHits = this._collectHits(views, scope);

    // Allowlist and negation run before state so suppressed/condemned hits do
    // not feed duplicate/flood history or the repeat-offender counter.
    const allowed = applyAllowlist(
      this.dictionary.allowlist,
      views,
      rawHits,
      { scope }
    );
    const contextualHits = applyNegationContext(allowed.kept, raw);

    const stateResult = stateful
      ? this.state.observe(userId, hashText(raw), contextualHits)
      : { hits: [], escalation: 0 };

    const allHits = [...contextualHits, ...stateResult.hits];
    const escalation = this._escalation(allHits, stateResult.escalation);
    const scopePolicy = this.config.moderation.scopes?.[scope] || null;
    const verdict = decideVerdict(allHits, { escalation, scopePolicy });

    const flags = this._flags(verdict.selected, stateResult.escalation, verdict.escalated);

    const response = buildResponse({
      raw,
      selected: verdict.selected,
      action: verdict.action,
      version: this.dictionary.version,
      replacementChar: this.config.moderation.replacementChar || '*',
      hitCount: allHits.length,
      suppressedCount: allowed.suppressed,
      escalated: verdict.escalated,
      flags,
      allHitsSuppressed: rawHits.length > 0 && allHits.length === 0,
    });

    const result = { ...response, cached: false };

    if (this.config.moderation.logViolations !== false && result.violations.length > 0) {
      this.logger?.info(
        `moderation ${result.action}`,
        `scope=${scope}`,
        `hits=${result.violations.length}`,
        `categories=${flags.join(',') || '-'}`
      );
    }

    if (this.cache && !stateful && ttlMs > 0) {
      this.cache.set(cacheKey(scope, raw), result, { ttl: ttlMs });
    }

    this.metrics.record({
      action: result.action,
      violations: result.violations,
      durationMs: Date.now() - startedAt,
      cached: false,
    });

    return result;
  }

  _collectHits(views, scope) {
    return [
      ...searchLexicon(this.dictionary.lexicon, views, { scope }),
      ...searchRules(this.dictionary.rules, views, { scope }),
      ...searchHeuristics(views, {
        enabled: this.config.heuristics?.enabled !== false,
      }),
    ];
  }

  _escalation(kept, stateEscalation) {
    const config = this.config.moderation.escalation || {};
    let escalation = Math.max(0, Number(stateEscalation) || 0);

    if (config.enabled === false) return escalation;

    // Collapse byte-for-byte identical spans first: one phone number can match
    // several rules (phone, spaced phone, long digits) and must count once.
    // Different spans in the same message still count separately, even if a
    // broad heuristic happens to cover them.
    const bySpan = new Map();
    for (const hit of kept) {
      const key = `${hit.start}:${hit.end}`;
      const current = bySpan.get(key);
      if (!current || (Number(hit.severity) || 0) > (Number(current.severity) || 0)) {
        bySpan.set(key, hit);
      }
    }

    const counts = new Map();
    let severitySum = 0;

    for (const hit of bySpan.values()) {
      counts.set(hit.category, (counts.get(hit.category) || 0) + 1);
      severitySum += Number(hit.severity) || 0;
    }

    const sameCategory = Math.max(0, ...counts.values());
    if (Number(config.sameCategory) > 0 && sameCategory >= Number(config.sameCategory)) {
      escalation = Math.max(escalation, 1);
    }
    if (Number(config.totalSeverity) > 0 && severitySum >= Number(config.totalSeverity)) {
      escalation = Math.max(escalation, 1);
    }

    return escalation;
  }

  _flags(selected, stateEscalation, escalated) {
    const flags = new Set();

    for (const hit of selected) {
      if (hit.category === 'selfharm') flags.add('self_harm');
      else if (hit.category === 'minor_safety') flags.add('minor_safety');
      else if (hit.category === 'privacy') flags.add('pii');
      else if (hit.category === 'evasion') flags.add('evasion');
      else if (hit.category === 'spam') flags.add('spam');
    }

    if (stateEscalation > 0) flags.add('repeat_offender');
    if (escalated) flags.add('escalated');
    if (selected.some(hit => hit.negated)) flags.add('negated');

    return [...flags];
  }

  stats() {
    return {
      ...this.metrics.snapshot(),
      cacheSize: this.cache ? this.cache.size : 0,
      stateUsers: this.state.enabled ? this.state.size : 0,
      dictionary: {
        version: this.dictionary.version,
        words: this.dictionary.wordCount,
        patterns: this.dictionary.patternCount,
        rules: this.dictionary.ruleCount,
        allowlist: this.dictionary.allowCount,
      },
    };
  }
}

module.exports = { ModerationEngine, hashText };
