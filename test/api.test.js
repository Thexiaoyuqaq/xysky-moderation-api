const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const { silentLogger, makeConfig, FIXTURE_DIR } = require('./support/helpers');

async function withServer(config, run) {
  const { app } = createApp({ config, logger: silentLogger });
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    await run(base);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

function post(base, path, body, headers = {}) {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

test('health reports dictionary stats', async () => {
  await withServer(makeConfig(FIXTURE_DIR), async (base) => {
    const response = await fetch(`${base}/health`);
    assert.equal(response.status, 200);

    const body = await response.json();
    assert.equal(body.ok, true);
    assert.ok(body.words > 0);
    assert.ok(body.rules > 0);
    assert.equal(body.version, 'test-2026-10-25');
  });
});

test('moderation response keeps the game-server contract', async () => {
  await withServer(makeConfig(FIXTURE_DIR), async (base) => {
    const response = await post(base, '/v1/moderate', { text: '法轮', scope: 'chat' });
    assert.equal(response.status, 200);

    const body = await response.json();
    for (const key of [
      'ok', 'clean', 'whitelisted', 'action', 'shouldBlock', 'shouldReview',
      'filteredText', 'violations', 'matchedCount', 'version', 'cached',
    ]) {
      assert.ok(key in body, `missing ${key}`);
    }
    assert.equal(body.action, 'block');
    assert.equal(body.shouldBlock, true);
    assert.equal(body.filteredText, '**');
    assert.equal(body.violations[0].word, '法轮');
  });
});

test('bearer auth is enforced when configured', async () => {
  const config = makeConfig(FIXTURE_DIR, { auth: { token: 'secret-token' } });

  await withServer(config, async (base) => {
    const anonymous = await post(base, '/v1/moderate', { text: 'badword' });
    assert.equal(anonymous.status, 401);

    const authorized = await post(
      base,
      '/v1/moderate',
      { text: 'badword', scope: 'chat' },
      { authorization: 'Bearer secret-token' }
    );
    assert.equal(authorized.status, 200);
    assert.equal((await authorized.json()).action, 'block');
  });
});

test('batch moderation and the response cache work', async () => {
  const config = makeConfig(FIXTURE_DIR, { cache: true });

  await withServer(config, async (base) => {
    const response = await post(base, '/v1/moderate/batch', {
      items: [{ text: 'silly' }, { text: 'clean text' }],
    });
    assert.equal(response.status, 200);

    const { results } = await response.json();
    assert.equal(results[0].action, 'replace');
    assert.equal(results[1].action, 'allow');

    const first = await post(base, '/v1/moderate', { text: 'silly' });
    assert.equal((await first.json()).cached, true);
  });
});

test('stateful requests bypass the shared text cache', async () => {
  const config = makeConfig(FIXTURE_DIR, { cache: true, state: true });

  await withServer(config, async (base) => {
    const first = await post(base, '/v1/moderate', { text: 'silly', userId: 'u1' });
    const second = await post(base, '/v1/moderate', { text: 'silly', userId: 'u1' });
    assert.equal((await first.json()).cached, false);
    assert.equal((await second.json()).cached, false);
  });
});

test('invalid bodies are rejected with 400', async () => {
  const config = makeConfig(FIXTURE_DIR, { moderation: { maxTextLength: 5 } });

  await withServer(config, async (base) => {
    const tooLong = await post(base, '/v1/moderate', { text: 'too long for the limit' });
    assert.equal(tooLong.status, 400);

    const malformed = await post(base, '/v1/moderate', '{not json');
    assert.equal(malformed.status, 400);
  });
});

test('reload, stats and 404 behave as documented', async () => {
  await withServer(makeConfig(FIXTURE_DIR), async (base) => {
    const reload = await post(base, '/v1/reload', {});
    assert.equal(reload.status, 200);
    assert.equal((await reload.json()).ok, true);

    const stats = await fetch(`${base}/v1/stats`);
    assert.equal(stats.status, 200);
    assert.ok((await stats.json()).dictionary.words > 0);

    const missing = await fetch(`${base}/nope`);
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).error, 'Not found');
  });
});

test('rate limiting returns 429 after the configured budget', async () => {
  const config = makeConfig(FIXTURE_DIR);
  config.rateLimit.enabled = true;
  config.rateLimit.windowMs = 10000;
  config.rateLimit.max = 1;

  await withServer(config, async (base) => {
    assert.equal((await fetch(`${base}/health`)).status, 200);
    assert.equal((await post(base, '/v1/moderate', { text: 'clean' })).status, 200);

    const limited = await post(base, '/v1/moderate', { text: 'clean' });
    assert.equal(limited.status, 429);
    assert.ok(limited.headers.get('retry-after'));
  });
});
