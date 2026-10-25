#!/usr/bin/env node
/**
 * Ad-hoc text checker for the moderation dictionary.
 *
 *   npm run check -- "要测试的文本"
 *   npm run check -- --scope nickname "昵称"
 *   npm run check -- --file tools/samples.txt
 *   echo "一段文本" | npm run check -- --stdin
 *   npm run check -- --interactive
 *   npm run check -- --json "文本"
 *
 * Deterministic by default: cache and user state are disabled. Add --state
 * together with --user to exercise duplicate/flood escalation.
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { loadConfig } = require('../src/config');
const { loadDictionary } = require('../src/dictionary/loader');
const { ModerationEngine } = require('../src/engine');
const { Metrics } = require('../src/metrics');

const COLORS = {
  allow: '\x1b[32m',
  review: '\x1b[33m',
  replace: '\x1b[35m',
  block: '\x1b[31m',
  reset: '\x1b[0m',
  dim: '\x1b[2m',
};

const HELP = `
用法:
  node tools/testText.js [选项] "文本"
  npm run check -- [选项] "文本"

选项:
  --scope <name>       文本作用域（默认 chat）
  --user <id>          模拟用户 id（配合 --state 使用）
  --dictionary <dir>   指定词库目录（默认 config/config.yml 中的路径）
  --file <path>        逐行读取文本（# 开头的行忽略）
  --stdin              从标准输入逐行读取
  -i, --interactive    交互模式，输入一行查看一行
  --state              启用内存用户状态（重复/刷屏/累犯）
  --json               输出完整 JSON（单条为对象，多条为数组）
  --verbose            额外显示 flags 与命中详情
  --fail-on-block      存在 block 时以退出码 2 结束（便于脚本化）
  --no-color           禁用彩色输出
  -h, --help           显示帮助

示例:
  npm run check -- "加我微信一起跑图"
  npm run check -- --scope nickname "傻逼"
  npm run check -- --file tools/samples.txt
  echo "不要赌博" | npm run check -- --stdin
`;

function fail(message) {
  const error = new Error(message);
  error.userFacing = true;
  throw error;
}

function parseArgs(argv) {
  const options = {
    json: false,
    stdin: false,
    interactive: false,
    state: false,
    verbose: false,
    failOnBlock: false,
    color: Boolean(process.stdout.isTTY),
    help: false,
    text: '',
    scope: null,
    user: null,
    dictionary: null,
    file: null,
  };
  const positional = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = () => {
      const next = argv[index + 1];
      if (next === undefined || next.startsWith('--')) {
        fail(`参数 ${arg} 缺少值`);
      }
      index += 1;
      return next;
    };

    switch (arg) {
      case '-h':
      case '--help':
        options.help = true;
        break;
      case '--json':
        options.json = true;
        options.color = false;
        break;
      case '--stdin':
        options.stdin = true;
        break;
      case '-i':
      case '--interactive':
        options.interactive = true;
        break;
      case '--state':
        options.state = true;
        break;
      case '--verbose':
        options.verbose = true;
        break;
      case '--fail-on-block':
        options.failOnBlock = true;
        break;
      case '--no-color':
        options.color = false;
        break;
      case '--scope':
        options.scope = value();
        break;
      case '--user':
        options.user = value();
        break;
      case '--dictionary':
        options.dictionary = value();
        break;
      case '--file':
        options.file = value();
        break;
      default:
        if (arg.startsWith('--')) fail(`未知参数: ${arg}`);
        positional.push(arg);
    }
  }

  options.text = positional.join(' ').trim();
  return options;
}

function buildEngine(options) {
  const config = loadConfig();

  if (options.dictionary) {
    config.dictionary.path = path.resolve(process.cwd(), options.dictionary);
  }
  config.cache.enabled = false;
  config.state.enabled = options.state;
  config.rateLimit.enabled = false;
  config.moderation.logViolations = false;

  const logger = {
    info() {},
    debug() {},
    warn: (...args) => console.error(
      options.color ? `${COLORS.dim}warning:${COLORS.reset}` : 'warning:', ...args
    ),
    error: (...args) => console.error(
      options.color ? `${COLORS.dim}error:${COLORS.reset}` : 'error:', ...args
    ),
  };

  const dictionary = loadDictionary(config.dictionary.path, {
    logger,
    defaultMaxGap: config.moderation.maxGap,
  });

  const engine = new ModerationEngine({
    config,
    dictionary,
    logger,
    metrics: new Metrics(),
  });

  return {
    engine,
    scope: options.scope || config.moderation.defaultScope || 'chat',
    dictionary,
  };
}

function paint(value, action, enabled) {
  if (!enabled || !COLORS[action]) return value;
  return `${COLORS[action]}${value}${COLORS.reset}`;
}

function printResult(result, text, index, options) {
  const prefix = index === null ? '' : `${index + 1}. `;
  const label = paint(`[${result.action.toUpperCase()}]`, result.action, options.color);
  console.log(`${prefix}${label} ${text}`);

  if (result.filteredText !== text) {
    console.log(`   filtered : ${JSON.stringify(result.filteredText)}`);
  }

  if (options.verbose || result.violations.length > 0) {
    console.log(
      `   hits     : ${result.matchedCount}/${result.hitCount}`
      + `  suppressed=${result.suppressedCount}`
      + (result.escalated ? '  escalated' : '')
      + (result.flags.length ? `  flags=${result.flags.join(',')}` : '')
    );
  }

  for (const violation of result.violations) {
    const id = violation.id ? ` ${violation.id}` : '';
    const word = violation.word ? ` ${JSON.stringify(violation.word)}` : '';
    const negated = violation.negated ? ' (negated)' : '';
    console.log(
      `   - ${violation.category}${id} ${violation.action}`
      + ` sev=${violation.severity} @${violation.position.start}-${violation.position.end}`
      + `${word}${negated}`
    );
  }
}

async function readLines(stream) {
  let data = '';
  for await (const chunk of stream) data += chunk;
  return data;
}

function linesFrom(text) {
  return text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'));
}

async function runInteractive(engine, scope, options) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `${scope}> `,
  });

  console.log('输入文本回车查看结果，输入 .exit 退出。');
  rl.prompt();

  for await (const line of rl) {
    const text = line.trim();
    if (text === '.exit' || text === 'exit' || text === 'quit') break;

    if (text) {
      const result = engine.moderate({
        text,
        scope,
        userId: options.user || null,
      });
      if (options.json) console.log(JSON.stringify(result, null, 2));
      else printResult(result, text, null, options);
    }

    rl.prompt();
  }

  rl.close();
}

async function collectTexts(options) {
  if (options.file) {
    const file = path.resolve(process.cwd(), options.file);
    return linesFrom(fs.readFileSync(file, 'utf8'));
  }

  if (options.text) return [options.text];

  if (options.stdin || !process.stdin.isTTY) {
    return linesFrom(await readLines(process.stdin));
  }

  return [];
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    console.log(HELP.trim());
    return;
  }

  if (options.state && !options.user) {
    console.error('提示: --state 需要同时提供 --user 才会生效。');
  }

  const { engine, scope, dictionary } = buildEngine(options);

  const info = `字典: ${dictionary.wordCount} 条 / ${dictionary.patternCount} 模式`
    + ` / ${dictionary.ruleCount} 规则, scope=${scope}`;
  console.error(options.color ? `${COLORS.dim}${info}${COLORS.reset}` : info);

  if (options.interactive) {
    await runInteractive(engine, scope, options);
    return;
  }

  const texts = await collectTexts(options);
  if (texts.length === 0) {
    console.log(HELP.trim());
    process.exitCode = 1;
    return;
  }

  const results = texts.map(text => engine.moderate({
    text,
    scope,
    userId: options.user || null,
  }));

  if (options.json) {
    const payload = results.length === 1 ? results[0] : results;
    console.log(JSON.stringify(payload, null, 2));
  } else {
    results.forEach((result, index) => {
      printResult(result, texts[index], texts.length > 1 ? index : null, options);
    });
  }

  if (options.failOnBlock && results.some(result => result.action === 'block')) {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error(`错误: ${error.message}`);
  if (!error.userFacing) console.error(error.stack);
  process.exitCode = 1;
});
