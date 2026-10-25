/**
 * Span-level allowlist.
 *
 * Previous behavior suppressed the whole message if any allow pattern matched
 * anywhere. That made a single benign phrase a free pass for an entire line.
 * Now an allow span only suppresses hits fully contained inside it.
 */
const { buildLexicon, searchLexicon, scopeAllowed } = require('./lexicon');
const { viewRange } = require('../text/views');

function buildAllowlist(entries, options = {}) {
  const defaultMaxGap = options.defaultMaxGap;
  const logger = options.logger;

  const wordEntries = [];
  const regexEntries = [];

  for (const entry of entries || []) {
    if (entry.regex) {
      const flags = entry.flags && entry.flags.includes('g')
        ? entry.flags
        : `${entry.flags || ''}g`;
      regexEntries.push({
        ...entry,
        view: entry.view || 'canonical',
        regex: new RegExp(entry.regex, flags),
      });
      continue;
    }

    if (!entry.pattern) continue;

    wordEntries.push({
      id: entry.id,
      word: entry.pattern,
      aliases: [],
      match: entry.match || 'auto',
      maxGap: entry.maxGap,
      category: 'allow',
      level: 'low',
      severity: 0,
      action: 'allow',
      description: entry.description || '',
      scopes: entry.scopes || null,
    });
  }

  const lexicon = buildLexicon(wordEntries, { defaultMaxGap, logger });

  return {
    lexicon,
    regexEntries,
    size: wordEntries.length + regexEntries.length,
  };
}

function collectSpans(allowlist, views, scope) {
  const spans = [];

  const lexiconHits = searchLexicon(allowlist.lexicon, views, { scope });
  for (const hit of lexiconHits) {
    spans.push({ start: hit.start, end: hit.end });
  }

  for (const entry of allowlist.regexEntries) {
    if (!scopeAllowed(entry.scopes, scope)) continue;

    const view = entry.view === 'raw' ? null : views[entry.view];
    const text = entry.view === 'raw' ? views.raw : view?.text;
    if (typeof text !== 'string') continue;

    entry.regex.lastIndex = 0;
    for (const match of text.matchAll(entry.regex)) {
      if (!match[0]) continue;
      const start = match.index;
      const end = start + match[0].length;
      const range = entry.view === 'raw'
        ? { start, end }
        : viewRange(view, start, end);
      if (range) spans.push(range);
    }
  }

  return spans;
}

/**
 * @returns {{kept:Array, suppressed:number, spans:number}}
 */
function applyAllowlist(allowlist, views, hits, options = {}) {
  if (!allowlist || allowlist.size === 0) {
    return { kept: hits, suppressed: 0, spans: 0 };
  }

  const scope = options.scope || 'chat';
  const spans = collectSpans(allowlist, views, scope);
  if (spans.length === 0) {
    return { kept: hits, suppressed: 0, spans: 0 };
  }

  const kept = [];
  let suppressed = 0;

  for (const hit of hits) {
    const hasSpan = hit.end > hit.start;

    const isAllowed = hasSpan && spans.some(
      span => hit.start >= span.start && hit.end <= span.end
    );

    if (isAllowed) suppressed += 1;
    else kept.push(hit);
  }

  return { kept, suppressed, spans: spans.length };
}

module.exports = { buildAllowlist, applyAllowlist, collectSpans };
