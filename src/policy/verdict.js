/**
 * Verdict policy: turn candidate hits into one wire action plus the
 * non-overlapping spans that should be reported/masked.
 *
 * This module never matches text and never builds the HTTP response.
 */
const {
  normalizeAction,
  rankOf,
  capAction,
  actionForRank,
} = require('./actions');

function dedupeHits(hits) {
  const seen = new Set();
  const output = [];

  for (const hit of hits) {
    const key = [
      hit.id || hit.category,
      hit.category,
      hit.start,
      hit.end,
    ].join('\u0000');
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(hit);
  }

  return output;
}

/**
 * Pick non-overlapping spans for reporting. Zero-length behavioral hits are
 * always kept (they carry no span and cannot overlap anything).
 */
function selectHits(hits) {
  const sorted = [...hits].sort((left, right) => {
    if (left.start !== right.start) return left.start - right.start;
    const leftLength = left.end - left.start;
    const rightLength = right.end - right.start;
    if (leftLength !== rightLength) return rightLength - leftLength;
    return rankOf(right.action) - rankOf(left.action);
  });

  const selected = [];
  let lastEnd = -1;

  for (const hit of sorted) {
    if (hit.end <= hit.start) {
      selected.push(hit);
      continue;
    }
    if (hit.start < lastEnd) continue;
    selected.push(hit);
    lastEnd = hit.end;
  }

  return selected;
}

function decideVerdict(hits, options = {}) {
  const deduped = dedupeHits(hits);

  let maxRank = 0;
  let hasHardHit = false;

  for (const hit of deduped) {
    let rank = rankOf(hit.action);

    // Self-harm and similar categories may be reported but never block.
    if (hit.neverBlock) rank = Math.min(rank, 2);
    else if (rank > 0) hasHardHit = true;

    if (rank > maxRank) maxRank = rank;
  }

  let escalated = false;
  const escalation = Math.max(0, Number(options.escalation) || 0);

  if (maxRank > 0 && escalation > 0) {
    const target = Math.min(4, maxRank + escalation);
    // If every contributing hit is neverBlock, escalation stops at review.
    const capped = hasHardHit ? target : Math.min(target, 2);
    escalated = capped !== maxRank;
    maxRank = capped;
  }

  let action = actionForRank(maxRank);

  const profile = options.scopePolicy || {};
  if (profile.reviewAction && action === 'review') {
    action = normalizeAction(profile.reviewAction, 'replace');
  }
  if (profile.maxAction) {
    action = capAction(action, profile.maxAction);
  }

  return {
    action,
    escalated,
    selected: selectHits(deduped),
    hits: deduped,
  };
}

module.exports = { decideVerdict, dedupeHits, selectHits };
