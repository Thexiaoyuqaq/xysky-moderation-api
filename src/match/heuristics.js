/**
 * Per-message heuristics that indicate structural evasion (invisible runs,
 * Zalgo, flood-style contact spam). These need no user state, so they still
 * work when the optional state module is disabled.
 *
 * Everything here is deliberately `review`-level: repeating "hahaha" or being
 * excited with emoji is not, by itself, a reason to block a player's message.
 *
 * Repetition/entropy/caps spam detection was removed: normal chat floods like
 * "啊啊啊啊…" and "4343464643443" triggered it, and the game server does not
 * want flood messages masked anyway (duplicate/flood handling lives in the
 * optional state module instead).
 */
const WORD_CHAR = /[\p{L}\p{N}]/u;
const ASCII_LETTER = /[a-z]/i;

function makeHit(id, start, end, severity, action, description) {
  return {
    type: 'heuristic',
    id,
    source: 'heuristic',
    category: 'spam',
    level: severity >= 3 ? 'high' : severity === 2 ? 'medium' : 'low',
    severity,
    action,
    neverBlock: false,
    description,
    original: null,
    matched: '',
    start,
    end,
  };
}

function findSymbolFlood(raw) {
  const chars = Array.from(raw);
  if (chars.length < 10) return null;

  const symbols = chars.filter(
    char => !WORD_CHAR.test(char) && !/\s/u.test(char)
  ).length;

  if (symbols / chars.length <= 0.6) return null;

  return makeHit(
    'heuristic.symbol_flood',
    0,
    raw.length,
    1,
    'review',
    `符号/表情占比 ${Math.round((symbols / chars.length) * 100)}%`
  );
}

function findCapsFlood(raw) {
  const letters = Array.from(raw).filter(char => ASCII_LETTER.test(char));
  if (letters.length < 12) return null;

  const upper = letters.filter(char => char === char.toUpperCase()).length;
  if (upper / letters.length <= 0.8) return null;

  return makeHit(
    'heuristic.caps_flood',
    0,
    raw.length,
    1,
    'review',
    '全大写长文本'
  );
}

function searchHeuristics(views, options = {}) {
  if (options.enabled === false) return [];

  return [
    findSymbolFlood(views.raw),
    findCapsFlood(views.raw),
  ].filter(Boolean);
}

module.exports = { searchHeuristics };
