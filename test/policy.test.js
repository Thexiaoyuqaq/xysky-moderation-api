const test = require('node:test');
const assert = require('node:assert/strict');
const {
  decideVerdict,
  dedupeHits,
  selectHits,
} = require('../src/policy/verdict');
const {
  normalizeAction,
  elevate,
  capAction,
  actionForRank,
} = require('../src/policy/actions');
const { isNegated, applyNegationContext } = require('../src/policy/context');

function hit(overrides = {}) {
  return {
    id: 'x',
    category: 'profanity',
    severity: 2,
    action: 'replace',
    neverBlock: false,
    start: 0,
    end: 2,
    ...overrides,
  };
}

test('action vocabulary normalizes legacy values', () => {
  assert.equal(normalizeAction('warn'), 'review');
  assert.equal(normalizeAction('nonsense'), 'replace');
  assert.equal(normalizeAction('block'), 'block');
  assert.equal(elevate('review'), 'replace');
  assert.equal(elevate('replace'), 'block');
  assert.equal(capAction('block', 'review'), 'review');
  assert.equal(actionForRank(0), 'allow');
  assert.equal(actionForRank(2), 'review');
  assert.equal(actionForRank(3), 'replace');
  assert.equal(actionForRank(4), 'block');
});

test('verdict uses the strongest hit', () => {
  const result = decideVerdict([
    hit({ action: 'review', severity: 1 }),
    hit({ id: 'y', action: 'block', start: 3, end: 5 }),
  ]);
  assert.equal(result.action, 'block');
});

test('neverBlock caps only its own contribution', () => {
  const onlySelfHarm = decideVerdict([
    hit({ category: 'selfharm', action: 'block', neverBlock: true }),
  ]);
  assert.equal(onlySelfHarm.action, 'review');

  const mixed = decideVerdict([
    hit({ category: 'selfharm', action: 'block', neverBlock: true }),
    hit({ id: 'y', category: 'violence', action: 'block', start: 2, end: 4 }),
  ]);
  assert.equal(mixed.action, 'block');
});

test('escalation raises one step and respects neverBlock', () => {
  const escalated = decideVerdict([
    hit({ action: 'review', severity: 1, start: 0, end: 2 }),
    hit({ id: 'b', action: 'review', severity: 1, start: 3, end: 5 }),
  ], { escalation: 1 });
  assert.equal(escalated.action, 'replace');
  assert.equal(escalated.escalated, true);

  const selfHarm = decideVerdict([
    hit({ category: 'selfharm', action: 'review', neverBlock: true }),
  ], { escalation: 1 });
  assert.equal(selfHarm.action, 'review');
});

test('scope policy can turn review into replace', () => {
  const result = decideVerdict([hit({ action: 'review' })], {
    scopePolicy: { reviewAction: 'replace' },
  });
  assert.equal(result.action, 'replace');
});

test('selection prefers earlier, longer and stronger spans', () => {
  const selected = selectHits([
    hit({ id: 'short', start: 0, end: 2 }),
    hit({ id: 'long', start: 0, end: 5 }),
    hit({ id: 'later', start: 5, end: 8 }),
  ]);
  assert.deepEqual(selected.map(item => item.id), ['long', 'later']);

  const deduped = dedupeHits([
    hit({ id: 'same' }),
    hit({ id: 'same' }),
  ]);
  assert.equal(deduped.length, 1);
});

test('negation only downgrades hard actions', () => {
  assert.equal(isNegated('不要赌博', 2), true);
  assert.equal(isNegated('远离诈骗', 2), true);
  assert.equal(isNegated('举报外挂', 2), true);
  assert.equal(isNegated('我不喜欢赌博', 4), true);
  assert.equal(isNegated('我不管，我要赌博', 6), false);
  assert.equal(isNegated('我不反对赌博', 4), false);
  assert.equal(isNegated('特别想赌博', 3), false);

  const adjusted = applyNegationContext(
    [hit({ action: 'block', start: 2, end: 4 })],
    '不要赌博'
  );
  assert.equal(adjusted[0].action, 'review');
  assert.equal(adjusted[0].negated, true);
});
