const test = require('node:test');
const assert = require('node:assert/strict');
const { fixtureEngine } = require('./support/helpers');

const { engine } = fixtureEngine();
const run = (text, scope = 'chat') => engine.moderate({ text, scope });

test('latin words require word boundaries', () => {
  assert.equal(run('badword').action, 'block');
  assert.equal(run('have').action, 'allow');       // contains "av"
  assert.equal(run('avocado').action, 'allow');    // contains "av"
  assert.equal(run('av').action, 'block');
  assert.equal(run('content').action, 'allow');    // contains "nt"
  assert.equal(run('nt').action, 'review');
  assert.equal(run('asb').action, 'allow');
  assert.equal(run('sb').action, 'review');
});

test('cjk matching tolerates short gaps but not sentence breaks', () => {
  assert.equal(run('法 轮').action, 'block');
  assert.equal(run('法😀轮').action, 'block');
  assert.equal(run('法；轮').action, 'allow');
  assert.equal(run('法。轮').action, 'allow');
  assert.equal(run('傻 逼').action, 'block');
  assert.equal(run('法\n轮').action, 'block');
});

test('traditional, full-width and latin-spaced evasions still match', () => {
  assert.equal(run('廢物').action, 'replace');
  assert.equal(run('法 輪').action, 'block');
  assert.equal(run('ｂａｄｗｏｒｄ').action, 'block');
  assert.equal(run('f a l u n').action, 'block');
  assert.equal(run('f.a.l.u.n').action, 'block');
  assert.equal(run('f。a。l。u。n').action, 'allow');
});

test('scope-limited entries only apply in their scope', () => {
  assert.equal(run('nickonly', 'chat').action, 'allow');
  assert.equal(run('nickonly', 'nickname').action, 'block');
});

test('allowlist suppresses only the overlapping span', () => {
  const all = run('垃圾桶');
  assert.equal(all.action, 'allow');
  assert.equal(all.whitelisted, true);
  assert.equal(all.suppressedCount, 1);

  const mixed = run('垃圾桶法轮');
  assert.equal(mixed.action, 'block');
  assert.equal(mixed.violations.length, 1);
  assert.equal(mixed.violations[0].id, 'block.falun');
  assert.equal(mixed.suppressedCount, 1);

  // Latin boundary already means "badword" is not inside "badwordish".
  assert.equal(run('badwordish').action, 'allow');
});

test('regex rules map matches back to the original text', () => {
  const phone = run('13912345678');
  assert.equal(phone.action, 'replace');
  assert.equal(phone.filteredText, '***********');
  assert.equal(phone.violations[0].category, 'privacy');

  // Overlapping phone + digits rules must not escalate to block.
  assert.notEqual(phone.action, 'block');

  const url = run('www.example.com');
  assert.equal(url.action, 'replace');
  assert.equal(url.violations[0].id, 'privacy.url');
});

test('heuristics stay review-level and ignore benign repetition', () => {
  assert.equal(run('aaaaaaaaaaaa').action, 'review');
  assert.equal(run('😀😀😀😀😀😀😀😀😀😀').action, 'review');
  assert.equal(run('哈哈哈哈哈哈').action, 'allow');
  assert.equal(run('666666666666').action, 'allow');
});

test('same-category escalation raises the verdict one step', () => {
  const result = run('spammy spammy spammy spammy');
  assert.equal(result.action, 'replace');
  assert.equal(result.escalated, true);
});

test('neverBlock categories stop at review even when escalated', () => {
  assert.equal(run('自杀').action, 'review');
  assert.equal(run('自杀自杀自杀').action, 'review');
});

test('negation context downgrades hard hits in the same clause', () => {
  const negated = run('不要法轮');
  assert.equal(negated.action, 'review');
  assert.equal(negated.violations[0].negated, true);

  const doubleNegation = run('我不反对法轮');
  assert.equal(doubleNegation.action, 'block');

  assert.equal(run('我要法轮').action, 'block');
});

test('response keeps the wire contract', () => {
  const result = run('法轮');
  for (const key of [
    'ok', 'clean', 'whitelisted', 'action', 'shouldBlock', 'shouldReview',
    'filteredText', 'violations', 'matchedCount', 'version', 'cached',
  ]) {
    assert.ok(key in result, `missing ${key}`);
  }
  assert.equal(result.ok, false);
  assert.equal(result.clean, false);
  assert.equal(result.shouldBlock, true);
  assert.equal(result.shouldReview, false);
  assert.equal(result.matchedCount, 1);
  assert.equal(result.violations[0].type, 'word');
  assert.equal(result.version, 'test-2026-10-25');
});
