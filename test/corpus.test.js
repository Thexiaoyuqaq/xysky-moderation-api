const test = require('node:test');
const assert = require('node:assert/strict');
const { realEngine } = require('./support/helpers');

const { engine } = realEngine();
const run = text => engine.moderate({ text, scope: 'chat' });

function assertActions(cases, expected) {
  for (const text of cases) {
    assert.equal(run(text).action, expected, `${JSON.stringify(text)} => ${run(text).action}`);
  }
}

// Normal social-game chat must not be punished.
const BENIGN = [
  '你好呀，一起跑图吗？',
  '今天天气真好',
  '哈哈哈哈哈哈',
  '谢谢谢谢',
  '我今年18岁',
  '我在64号房间',
  '这个游戏真好玩',
  '我买了新季卡',
  '光遇的风景很美',
  '有人一起献祭吗',
  '去云野大厅',
  '我要去吃饭了',
  '主播你好',
  '加个好友一起玩',
  '你的衣服真好看',
  '我们去看电影吧',
  '我的微信没电了',
  '我微信被盗了',
  '我有139个蜡烛',
  '我住在3楼302室',
  '这个操作真傻',
  '我妈妈做饭很好吃',
  '你真牛逼',
  '这家伙真垃圾',
  '老师讲课很无聊',
  '兼职好累',
  '炒股亏了',
  '投资有风险',
  '我的银行卡丢了',
  '我身份证丢了',
  '我妈死了',
  '六四班同学',
  '我并不讨厌你',
  '666666666666',
  'hhhhhhhhhh',
  '我想死你了',
  '这游戏真好垃圾',
  '我有点瑟瑟发抖',
  '打擦边球',
  'QQ群怎么加',
  '该收心了',
];

// Allowlisted compounds and victim/news disclosures.
const ALLOWLISTED = [
  '我被强奸了',
  '杀人案新闻',
  '杀人游戏',
  '炸弹人',
  '南京大屠杀',
  '大屠杀纪念馆',
  '废物利用',
  '孤儿院',
  '狗屎运',
  '神经病学',
  '乳房检查',
  '性教育',
  '垃圾分类',
  '成年人',
  '成人礼',
  '杀毒软件',
  '阴道炎',
  '阴茎癌',
  '赌博害人',
  '谨防诈骗电话',
];

// Flagged but delivered unchanged (action=review).
const REVIEW = [
  '我在开车',
  '他开车来接我',
  '我想自杀了',
  '我朋友自残了',
  '不要赌博',
  '远离诈骗',
  '反对台独',
  '谨防诈骗',
  '举报外挂',
  '禁止外挂',
  '我不喜欢赌博',
  '我们抵制代购',
  '这不是色情游戏',
  'aaaaaaaaaaaa',
  '😀😀😀😀😀😀😀😀😀😀',
  '自杀自杀自杀',
  '活著沒意思',
  'sb',
  'nt',
  'zz',
  'fw',
  'md',
  'tg',
  'vpn',
  '翻墙',
  '河蟹',
  '乳化',
  '民运',
  '反共',
  '推广',
  '商务合作',
  '优惠券',
  '筹码',
  '腿照',
  '足控',
  '恋足',
  '恋物',
  '擦边',
  '瑟瑟',
  '导管',
  '性骚扰',
  '性侵',
  '猥亵',
  '一了百了',
  '我今天买了炸鱼',
  '刷心',
  '骗心',
];

const REPLACE = [
  '傻逼',
  '加微信',
  '13912345678',
  'www.example.com',
  '廢物',
  '傻 逼',
  '色情',
  '黄片',
  '黄图',
  '成人视频',
  '约炮',
  '裸照',
  '代购',
  '加群',
  '代练',
  '加vx',
  '我的微信号abc12345',
  'shit',
  'fuck',
];

const BLOCK = [
  '法轮',
  '我要杀了你',
  '我要强奸你',
  '法 轮',
  '法😀轮',
  '法\n轮',
  'f a l u n',
  'ｆａｌｕｎ',
  '六四事件',
  '赌场',
  '外挂',
  '开挂',
  '炸服',
  '儿童色情',
  '未成年约炮',
  '賭場',
  '殺人',
  '詐騙',
  '外掛',
  '強姦',
  '法輪',
  '槍支',
  '燃燒瓶',
  '兒童色情',
  '誘拐兒童',
  '拐賣兒童',
  '煉銅',
  '開童車',
  '黑鬼',
  '支那',
  '台独',
  '赌博',
  '诈骗',
  '屠杀',
  '炸弹',
  '恐怖袭击',
  '自杀式袭击',
  '卖号',
  '代充',
  '账号交易',
];

test('benign chat stays allow', () => {
  assertActions(BENIGN, 'allow');
});

test('allowlisted compounds and disclosures stay allow', () => {
  assertActions(ALLOWLISTED, 'allow');
});

test('review-level signals pass through unchanged', () => {
  assertActions(REVIEW, 'review');
  for (const text of REVIEW) {
    assert.equal(run(text).shouldBlock, false, text);
  }
});

test('replace-level signals are masked', () => {
  assertActions(REPLACE, 'replace');
});

test('hard categories block', () => {
  assertActions(BLOCK, 'block');
});

test('sentence terminators stop a CJK match', () => {
  assert.equal(run('法。轮').action, 'allow');
  assert.equal(run('法！轮').action, 'allow');
  assert.equal(run('法；轮').action, 'allow');
});

test('overlapping rules do not escalate one phone number', () => {
  const phone = run('13912345678');
  assert.equal(phone.action, 'replace');
  assert.equal(phone.escalated, false);
});

test('repeated violations escalate one step', () => {
  const profanity = run('傻逼傻逼傻逼');
  assert.equal(profanity.action, 'block');
  assert.equal(profanity.escalated, true);

  const ads = run('代购代购代购');
  assert.equal(ads.action, 'block');
  assert.equal(ads.escalated, true);
});

test('self-harm never escalates to blocking', () => {
  const result = run('自杀自杀自杀');
  assert.equal(result.action, 'review');
  assert.equal(result.shouldBlock, false);
  assert.ok(result.flags.includes('self_harm'));
});

test('flags expose the semantic category', () => {
  assert.ok(run('我想自杀了').flags.includes('self_harm'));
  assert.ok(run('13912345678').flags.includes('pii'));
  assert.ok(run('不要赌博').flags.includes('negated'));
  assert.ok(run('😀😀😀😀😀😀😀😀😀😀').flags.includes('spam'));
});

test('nickname scope turns review into replace', () => {
  const result = engine.moderate({ text: 'sb', scope: 'nickname' });
  assert.equal(result.action, 'replace');
});
