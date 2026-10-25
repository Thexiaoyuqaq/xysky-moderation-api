const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { execFileSync, spawnSync } = require('node:child_process');
const { FIXTURE_DIR } = require('./support/helpers');

const TOOL = path.join(__dirname, '..', 'tools', 'testText.js');

function run(args, input) {
  return execFileSync(
    process.execPath,
    [TOOL, '--dictionary', FIXTURE_DIR, ...args],
    { encoding: 'utf8', input }
  );
}

test('testText CLI returns a JSON verdict for one line', () => {
  const payload = JSON.parse(run(['--json', '法轮']));
  assert.equal(payload.action, 'block');
  assert.equal(payload.violations[0].category, 'blockcat');
});

test('testText CLI reads multiple stdin lines', () => {
  const payload = JSON.parse(run(['--json', '--stdin'], '法轮\nsilly\n'));
  assert.ok(Array.isArray(payload));
  assert.deepEqual(payload.map(item => item.action), ['block', 'replace']);
});

test('testText CLI can fail scripts on a block', () => {
  const result = spawnSync(
    process.execPath,
    [TOOL, '--dictionary', FIXTURE_DIR, '--fail-on-block', '--json', '法轮'],
    { encoding: 'utf8' }
  );
  assert.equal(result.status, 2);
});
