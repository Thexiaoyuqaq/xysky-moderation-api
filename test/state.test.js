const test = require('node:test');
const assert = require('node:assert/strict');
const { UserStateStore } = require('../src/match/state');

function store(overrides = {}) {
  let now = 1_000_000;
  const config = {
    enabled: true,
    ttlSeconds: 600,
    maxUsers: 100,
    duplicateWindowMs: 60_000,
    duplicateThreshold: 3,
    violationWindowMs: 600_000,
    violationThreshold: 3,
    flood: { windowMs: 10_000, max: 2 },
    ...overrides,
  };
  return {
    instance: new UserStateStore(config, { now: () => now }),
    advance(ms) { now += ms; },
    now() { return now; },
  };
}

test('duplicate messages are reported at the threshold', () => {
  const env = store({ flood: { windowMs: 10_000, max: 99 } });
  const hash = 'abc';

  assert.deepEqual(env.instance.observe('u1', hash, [], env.now()).hits, []);
  assert.deepEqual(env.instance.observe('u1', hash, [], env.now()).hits, []);

  const third = env.instance.observe('u1', hash, [], env.now());
  assert.equal(third.hits.length, 1);
  assert.equal(third.hits[0].id, 'state.duplicate');
});

test('flood is reported once per window', () => {
  const env = store();
  assert.equal(env.instance.observe('u1', 'a', [], env.now()).hits.length, 0);
  assert.equal(env.instance.observe('u1', 'b', [], env.now()).hits.length, 0);

  const third = env.instance.observe('u1', 'c', [], env.now());
  assert.equal(third.hits[0].id, 'state.flood');

  // Same window: do not raise again for every message.
  assert.equal(env.instance.observe('u1', 'd', [], env.now()).hits.length, 0);

  env.advance(10_001);
  assert.equal(env.instance.observe('u1', 'e', [], env.now()).hits.length, 0);
});

test('repeat violations raise the escalation flag', () => {
  const env = store();
  const severity = [{ severity: 3 }];

  assert.equal(env.instance.observe('u1', 'a', severity, env.now()).escalation, 0);
  assert.equal(env.instance.observe('u1', 'b', severity, env.now()).escalation, 0);

  const third = env.instance.observe('u1', 'c', severity, env.now());
  assert.equal(third.escalation, 1);
});

test('state expires after the TTL and can be disabled', () => {
  const env = store({ duplicateThreshold: 2 });
  assert.equal(env.instance.observe('u1', 'same', [], env.now()).hits.length, 0);

  env.advance(601_000);
  assert.equal(env.instance.observe('u1', 'same', [], env.now()).hits.length, 0);

  const disabled = store({ enabled: false });
  assert.equal(disabled.instance.observe('u1', 'a', [], disabled.now()).hits.length, 0);
});

test('user cache is bounded', () => {
  const env = store({ maxUsers: 2 });
  env.instance.observe('a', 'x', [], env.now());
  env.instance.observe('b', 'y', [], env.now());
  env.instance.observe('c', 'z', [], env.now());
  assert.equal(env.instance.size, 2);
});
