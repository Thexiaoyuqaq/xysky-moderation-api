/**
 * Negation-aware downgrade.
 *
 * Chat moderation frequently sees condemnation, not abuse:
 *   "不要赌博", "远离诈骗", "举报外挂", "反对台独"
 * Blocking those punishes the person warning others. When a hard hit is
 * preceded by a negation / condemnation marker in the same clause, downgrade it
 * to `review` (still logged, never silently dropped).
 *
 * This is deliberately heuristic. It never turns a hit into `allow`; it only
 * removes the masking/blocking consequence.
 */
const { rankOf } = require('./actions');

const DOUBLE_NEGATION = /不(?:反对|抵制|禁止|拒绝|支持)/u;

const MULTI_MARKERS = [
  '不要', '不能', '不会', '不该', '不应', '不用', '反对', '抵制', '禁止',
  '严禁', '远离', '拒绝', '举报', '小心', '谨防', '警惕', '切勿', '打击',
  '惩罚', '制裁', '戒除', '杜绝', '防止', '拒绝', '劝阻',
];

// Single characters are only trusted when they are not part of a longer word.
const SINGLE_MARKERS = ['不', '勿', '莫'];

function clausePrefix(raw, start, maxLength = 14) {
  const from = Math.max(0, start - maxLength);
  let segment = raw.slice(from, start);

  let cut = -1;
  for (const char of '。！？!?；;，,\n\r') {
    const index = segment.lastIndexOf(char);
    if (index > cut) cut = index;
  }
  if (cut >= 0) segment = segment.slice(cut + 1);

  return segment;
}

function isNegated(raw, start) {
  const prefix = clausePrefix(raw, start);
  if (!prefix) return false;
  if (DOUBLE_NEGATION.test(prefix)) return false;

  if (MULTI_MARKERS.some(marker => prefix.includes(marker))) return true;
  if (SINGLE_MARKERS.some(marker => prefix.includes(marker))) return true;

  // "别赌博", "勿轻信" at the very end of the clause.
  return /[别勿莫]\s*$/u.test(prefix);
}

/**
 * @param {Array} hits
 * @param {string} raw
 * @returns {Array} adjusted copies (block/replace -> review when negated)
 */
function applyNegationContext(hits, raw) {
  return hits.map((hit) => {
    if (hit.end <= hit.start) return hit;
    if (rankOf(hit.action) < 3) return hit;
    if (!isNegated(raw, hit.start)) return hit;

    return {
      ...hit,
      action: 'review',
      // Keep it below the repeat-offender threshold: a warning is not abuse.
      severity: Math.min(Number(hit.severity) || 0, 1),
      negated: true,
    };
  });
}

module.exports = { applyNegationContext, isNegated, clausePrefix };
