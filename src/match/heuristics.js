/**
 * Per-message heuristics. These need no user state, so they still work when the
 * optional state module is disabled.
 *
 * Everything here is deliberately `review`-level: repeating "hahaha" or being
 * excited with emoji is not, by itself, a reason to block a player's message.
 */
const WORD_CHAR = /[\p{L}\p{N}]/u;
const ASCII_LETTER = /[a-z]/i;

// Characters that are normal when repeated in chat.
const BENIGN_REPEAT = new Set([
  '哈', '嘿', '嘻', '呵', '啊', '呀', '哦', '嗯', '呜', '喵', '哇', '呃',
  'h', 'H', 'w', 'W', '6', '2', '3', '0', '1', '4', '5', '7', '8', '9',
]);

const BENIGN_PHRASES = new Set([
  '谢谢', '哈哈', '嘿嘿', '呵呵', '晚安', '早安', '你好', '拜拜',
  '233', '666',
]);

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

function isBenignRun(char) {
  return BENIGN_REPEAT.has(char) || !WORD_CHAR.test(char);
}

function findRepeatRun(raw) {
  const regex = /(.)\1{5,}/gu;
  for (const match of raw.matchAll(regex)) {
    if (isBenignRun(match[1])) continue;
    const length = match[0].length;
    return makeHit(
      'heuristic.repeat_run',
      match.index,
      match.index + length,
      length >= 10 ? 2 : 1,
      'review',
      `单字符重复 ${length} 次`
    );
  }
  return null;
}

function findRepeatedPhrase(raw) {
  if (raw.length < 8) return null;

  for (let unit = 2; unit <= 4; unit += 1) {
    for (let start = 0; start + unit * 4 <= raw.length; start += 1) {
      const phrase = raw.slice(start, start + unit);
      if (!WORD_CHAR.test(phrase[0])) continue;
      if (BENIGN_PHRASES.has(phrase)) continue;
      if (Array.from(phrase).every(isBenignRun)) continue;

      let count = 1;
      let index = start + unit;
      while (raw.startsWith(phrase, index)) {
        count += 1;
        index += unit;
      }

      const covered = index - start;
      if (count >= 4 && covered >= raw.length * 0.6) {
        return makeHit(
          'heuristic.repeat_phrase',
          start,
          index,
          2,
          'review',
          `短语重复 ${count} 次`
        );
      }
    }
  }
  return null;
}

function findLowEntropy(raw) {
  const chars = Array.from(raw).filter(char => WORD_CHAR.test(char));
  if (chars.length < 12) return null;

  // "666666666666" and "2333333" are celebration, not spam.
  if (chars.every(char => char >= '0' && char <= '9')) return null;

  const unique = new Set(chars).size;
  if (unique / chars.length >= 0.28) return null;

  return makeHit(
    'heuristic.low_entropy',
    0,
    raw.length,
    2,
    'review',
    `字符多样性低 (${unique}/${chars.length})`
  );
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
    findRepeatRun(views.raw),
    findRepeatedPhrase(views.raw),
    findLowEntropy(views.raw),
    findSymbolFlood(views.raw),
    findCapsFlood(views.raw),
  ].filter(Boolean);
}

module.exports = { searchHeuristics };
