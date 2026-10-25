/**
 * Lexicon matching.
 *
 * Two automata, two match semantics:
 *
 *   cjk   matches on the compact view (separators/emoji removed), but a match
 *         may only skip `maxGap` raw code units internally and must not cross a
 *         strong sentence terminator. `傻 逼` and `傻😀逼` hit; `傻。逼` does not.
 *
 *   latin matches on the folded view (separators kept) and requires ASCII word
 *         boundaries. `av` no longer hits `have`; `nt` no longer hits `content`.
 */
const { Automaton } = require('./automaton');
const { buildViews, viewRange } = require('../text/views');
const { isAsciiAlnum } = require('../text/fold');

const HAN = /\p{Script=Han}/u;
const ASCII_WORD = /^[a-z0-9]+$/;

function resolveMatchType(declared, pattern) {
  if (declared === 'cjk' || declared === 'latin') return declared;
  if (HAN.test(pattern)) return 'cjk';
  // Mixed patterns such as `s人` or `群p` are CJK entries: they need gap
  // tolerance around the CJK part.
  return ASCII_WORD.test(pattern) ? 'latin' : 'cjk';
}

function normalizePattern(pattern, matchType) {
  const views = buildViews(pattern);
  if (matchType === 'latin') {
    const folded = views.folded.text;
    return ASCII_WORD.test(folded) ? folded : '';
  }
  return views.compact.text;
}

function scopeAllowed(scopes, scope) {
  if (!Array.isArray(scopes) || scopes.length === 0) return true;
  return scopes.includes(scope);
}

function gapsAllowed(compact, start, end, maxGap) {
  for (let index = start + 1; index < end; index += 1) {
    if (compact.sentenceBreakBefore[index]) return false;
    if (compact.gapBefore[index] > maxGap) return false;
  }
  return true;
}

function latinBoundary(text, start, end) {
  const before = start > 0 ? text[start - 1] : '';
  const after = end < text.length ? text[end] : '';
  if (before && isAsciiAlnum(before)) return false;
  if (after && isAsciiAlnum(after)) return false;
  return true;
}

/**
 * @param {Array} entries validated dictionary entries
 * @param {{defaultMaxGap:number, logger:object}} options
 */
function buildLexicon(entries, options = {}) {
  const defaultMaxGap = Number.isInteger(options.defaultMaxGap) ? options.defaultMaxGap : 2;
  const logger = options.logger;
  const cjk = new Automaton();
  const latin = new Automaton();
  const seen = new Set();
  let patternCount = 0;

  const add = (patternText, matchType, meta) => {
    const normalized = normalizePattern(patternText, matchType);
    if (!normalized) return;

    if (matchType === 'cjk' && Array.from(normalized).length < 2) {
      logger?.warn('跳过单字违禁词', meta.id, JSON.stringify(patternText));
      return;
    }

    const key = `${matchType}\u0000${normalized}\u0000${meta.id}`;
    if (seen.has(key)) return;
    seen.add(key);

    (matchType === 'cjk' ? cjk : latin).add(normalized, meta);
    patternCount += 1;
  };

  for (const entry of entries) {
    const base = {
      id: entry.id,
      category: entry.category,
      level: entry.level,
      description: entry.description || '',
      dictionaryWord: entry.word,
      neverBlock: entry.neverBlock === true,
      source: 'lexicon',
    };

    const variants = [
      { word: entry.word },
      ...(Array.isArray(entry.aliases) ? entry.aliases : []),
    ];

    for (const variant of variants) {
      const matchType = resolveMatchType(
        variant.match || entry.match,
        variant.word
      );
      const meta = {
        ...base,
        matchType,
        severity: Number.isInteger(variant.severity) ? variant.severity : entry.severity,
        action: variant.action || entry.action,
        scopes: variant.scopes || entry.scopes || null,
        maxGap: Number.isInteger(variant.maxGap)
          ? variant.maxGap
          : (Number.isInteger(entry.maxGap) ? entry.maxGap : defaultMaxGap),
        original: entry.word,
      };

      add(variant.word, matchType, meta);
    }
  }

  cjk.build();
  latin.build();

  return { cjk, latin, patternCount };
}

function searchLexicon(lexicon, views, options = {}) {
  const scope = options.scope || 'chat';
  const hits = [];
  const seen = new Set();

  const push = (meta, range) => {
    const key = `${meta.id}\u0000${range.start}\u0000${range.end}`;
    if (seen.has(key)) return;
    seen.add(key);

    hits.push({
      type: 'word',
      id: meta.id,
      source: 'lexicon',
      category: meta.category,
      level: meta.level,
      severity: meta.severity,
      action: meta.action,
      neverBlock: meta.neverBlock,
      description: meta.description,
      original: meta.original,
      matched: views.raw.slice(range.start, range.end),
      start: range.start,
      end: range.end,
    });
  };

  for (const match of lexicon.cjk.search(views.compact.text)) {
    const meta = match.payload;
    if (!scopeAllowed(meta.scopes, scope)) continue;
    if (!gapsAllowed(views.compact, match.start, match.end, meta.maxGap)) continue;

    const range = viewRange(views.compact, match.start, match.end);
    if (range) push(meta, range);
  }

  for (const match of lexicon.latin.search(views.folded.text)) {
    const meta = match.payload;
    if (!scopeAllowed(meta.scopes, scope)) continue;
    if (!latinBoundary(views.folded.text, match.start, match.end)) continue;

    const range = viewRange(views.folded, match.start, match.end);
    if (range) push(meta, range);
  }

  // Evasion: `f a l u n` / `f.a.l.u.n` keeps the letters contiguous in the
  // compact view. Only accept this for patterns of 4+ letters with exactly one
  // separator per internal gap, no sentence terminator, and an all-ASCII raw
  // span. Two-letter abbreviations stay strict to avoid false positives.
  if (views.compact.text !== views.folded.text) {
    for (const match of lexicon.latin.search(views.compact.text)) {
      const meta = match.payload;
      if (match.end - match.start < 4) continue;
      if (!scopeAllowed(meta.scopes, scope)) continue;
      if (!latinBoundary(views.compact.text, match.start, match.end)) continue;

      let plausible = true;
      for (let index = match.start + 1; index < match.end; index += 1) {
        if (views.compact.sentenceBreakBefore[index]
          || views.compact.gapBefore[index] > 1) {
          plausible = false;
          break;
        }
      }
      if (!plausible) continue;

      const range = viewRange(views.compact, match.start, match.end);
      if (!range) continue;

      const rawSpan = views.raw.slice(range.start, range.end);
      if (/[^\p{ASCII}]/u.test(rawSpan)) continue;

      push(meta, range);
    }
  }

  return hits;
}

module.exports = {
  buildLexicon,
  searchLexicon,
  resolveMatchType,
  normalizePattern,
  gapsAllowed,
  latinBoundary,
  scopeAllowed,
};
