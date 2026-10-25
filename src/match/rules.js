/**
 * Declarative regex rules: contact info, URLs, invites, scam patterns and
 * structural evasion. Rules run on a named view (default: canonical), and every
 * match is mapped back to the original text before it leaves this module.
 */
const { viewRange } = require('../text/views');
const { scopeAllowed } = require('./lexicon');

function compileRule(rule) {
  const flags = rule.flags && rule.flags.includes('g') ? rule.flags : `${rule.flags || ''}g`;
  return {
    ...rule,
    view: rule.view || 'canonical',
    regex: new RegExp(rule.pattern, flags),
    maxMatches: Number.isInteger(rule.maxMatches) ? rule.maxMatches : 20,
  };
}

function buildRules(rules) {
  return (rules || []).map(compileRule);
}

function searchRules(rules, views, options = {}) {
  const scope = options.scope || 'chat';
  const hits = [];

  for (const rule of rules) {
    if (!scopeAllowed(rule.scopes, scope)) continue;

    const view = rule.view === 'raw' ? null : views[rule.view];
    const text = rule.view === 'raw' ? views.raw : view?.text;
    if (typeof text !== 'string') continue;

    rule.regex.lastIndex = 0;
    let matched = 0;

    for (const match of text.matchAll(rule.regex)) {
      if (!match[0]) continue;

      const start = match.index;
      const end = start + match[0].length;
      const range = rule.view === 'raw'
        ? { start, end }
        : viewRange(view, start, end);
      if (!range) continue;

      hits.push({
        type: 'regex',
        id: rule.id,
        source: 'rule',
        category: rule.category,
        level: rule.level,
        severity: rule.severity,
        action: rule.action,
        neverBlock: rule.neverBlock === true,
        description: rule.description || '',
        original: null,
        matched: views.raw.slice(range.start, range.end),
        start: range.start,
        end: range.end,
      });

      matched += 1;
      if (matched >= rule.maxMatches) break;
    }
  }

  return hits;
}

module.exports = { buildRules, searchRules, compileRule };
