const test = require('node:test');
const assert = require('node:assert/strict');
const { buildViews, viewRange } = require('../src/text/views');

test('canonical folds full-width, traditional and zero-width characters', () => {
  assert.equal(buildViews('ｂａｄｗｏｒｄ').canonical.text, 'badword');
  assert.equal(buildViews('廢物').canonical.text, '废物');
  assert.equal(buildViews('a​b​c').canonical.text, 'abc');
});

test('folded applies leet and homoglyph folding', () => {
  assert.equal(buildViews('sh1t').folded.text, 'shit');
  assert.equal(buildViews('аv').folded.text, 'av'); // Cyrillic а
  assert.equal(buildViews('ＦＵＣＫ').folded.text, 'fuck');
});

test('compact records gap size and sentence crossings', () => {
  const spaced = buildViews('傻 逼');
  assert.equal(spaced.compact.text, '傻逼');
  assert.deepEqual(spaced.compact.gapBefore, [0, 1]);
  assert.deepEqual(spaced.compact.sentenceBreakBefore, [false, false]);

  const emoji = buildViews('傻😀逼');
  assert.equal(emoji.compact.text, '傻逼');
  assert.deepEqual(emoji.compact.gapBefore, [0, 2]);

  const sentence = buildViews('傻。逼');
  assert.equal(sentence.compact.text, '傻逼');
  assert.deepEqual(sentence.compact.sentenceBreakBefore, [false, true]);
});

test('view offsets stay aligned with surrogate pairs', () => {
  const views = buildViews('a😀b');
  assert.equal(views.canonical.text, 'a😀b');
  assert.deepEqual(views.canonical.starts, [0, 1, 1, 3]);
  assert.deepEqual(views.canonical.ends, [1, 3, 3, 4]);
  assert.deepEqual(viewRange(views.canonical, 0, 4), { start: 0, end: 4 });
  assert.deepEqual(viewRange(views.canonical, 1, 3), { start: 1, end: 3 });
});
