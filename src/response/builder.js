/**
 * Wire response builder. This is the only module that shapes the JSON the game
 * server sees, which keeps the existing contract stable while the engine
 * underneath is free to change.
 */
const { normalizeAction } = require('../policy/actions');

function levelFromSeverity(severity) {
  if (severity >= 4) return 'critical';
  if (severity === 3) return 'high';
  if (severity === 2) return 'medium';
  return 'low';
}

function mergeRanges(ranges) {
  const sorted = [...ranges].sort((left, right) => left.start - right.start);
  const merged = [];

  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) {
      last.end = Math.max(last.end, range.end);
    } else {
      merged.push({ start: range.start, end: range.end });
    }
  }

  return merged;
}

function maskRanges(raw, ranges, replacementChar) {
  const merged = mergeRanges(ranges.filter(range => range.end > range.start));
  if (merged.length === 0) return raw;

  let result = raw;
  for (let index = merged.length - 1; index >= 0; index -= 1) {
    const { start, end } = merged[index];
    result = result.slice(0, start)
      + replacementChar.repeat(Math.max(1, end - start))
      + result.slice(end);
  }
  return result;
}

function toViolation(hit, raw) {
  const hasSpan = hit.end > hit.start;

  return {
    type: hit.type,
    word: hasSpan ? raw.slice(hit.start, hit.end) : '',
    original: hit.original ?? null,
    category: hit.category,
    level: hit.level || levelFromSeverity(Number(hit.severity) || 0),
    action: normalizeAction(hit.action),
    description: hit.description || '',
    position: { start: hit.start, end: hit.end },
    // Additive fields; old clients ignore them.
    severity: Number.isInteger(hit.severity) ? hit.severity : 0,
    source: hit.source || 'lexicon',
    id: hit.id || null,
    negated: hit.negated === true,
  };
}

function buildResponse(options) {
  const {
    raw,
    selected,
    action,
    version,
    replacementChar = '*',
    hitCount = 0,
    suppressedCount = 0,
    escalated = false,
    flags = [],
    allHitsSuppressed = false,
  } = options;

  const violations = selected.map(hit => toViolation(hit, raw));
  const masked = action === 'allow'
    ? raw
    : maskRanges(raw, selected, replacementChar);

  return {
    ok: action !== 'block',
    clean: violations.length === 0,
    whitelisted: Boolean(allHitsSuppressed),
    action,
    shouldBlock: action === 'block',
    shouldReview: action === 'review',
    filteredText: masked,
    violations,
    matchedCount: violations.length,
    version: version || '',
    // Additive observability fields.
    hitCount,
    suppressedCount,
    escalated,
    flags,
  };
}

module.exports = { buildResponse, maskRanges, toViolation, mergeRanges, levelFromSeverity };
