/**
 * Loads, validates and compiles a dictionary directory.
 *
 * Layout:
 *   manifest.json        (optional) version / explicit file list
 *   categories.json      category defaults
 *   words/*.json         one file per category
 *   rules.json           regex rules
 *   allowlist.json       span-level allow patterns
 *
 * Compilation is atomic: the caller gets a new immutable object or an error,
 * never a half-loaded dictionary.
 */
const fs = require('fs');
const path = require('path');
const {
  parse,
  manifestSchema,
  categoriesFileSchema,
  wordsFileSchema,
  rulesFileSchema,
  allowlistFileSchema,
} = require('./schema');
const { buildLexicon } = require('../match/lexicon');
const { buildRules } = require('../match/rules');
const { buildAllowlist } = require('../match/allowlist');
const { capAction, normalizeAction } = require('../policy/actions');
const { buildViews } = require('../text/views');

const KNOWN_SCOPES = new Set([
  'chat', 'nickname', 'message', 'recording', 'club_name', 'clan_name',
  'signature', 'pet_name', 'profile', 'invite_nickname',
]);

function levelFromSeverity(severity) {
  if (severity >= 4) return 'critical';
  if (severity === 3) return 'high';
  if (severity === 2) return 'medium';
  return 'low';
}

function readJson(file, label) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    throw new Error(`${label}: 无法读取 ${file}: ${error.message}`, { cause: error });
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${label}: JSON 解析失败 ${file}: ${error.message}`, { cause: error });
  }
}

/**
 * Reject the obvious catastrophic-backtracking shapes. The dictionary is local
 * trusted input, but a bad rule should not be able to freeze the event loop.
 */
function assertSafePattern(pattern, label) {
  if (pattern.length > 500) {
    throw new Error(`${label}: 正则过长 (${pattern.length} > 500)`);
  }
  if (/\((?:[^()]|\\.)*[*+](?:[^()]|\\.)*\)\s*(?:[*+]|\{\d*,?\d*\})/.test(pattern)) {
    throw new Error(`${label}: 疑似嵌套量词，可能造成灾难性回溯`);
  }
}

function resolveWordFiles(dir, manifest) {
  if (Array.isArray(manifest.files)) {
    return manifest.files.map((file) => {
      const resolved = path.resolve(dir, file);
      if (!resolved.startsWith(path.resolve(dir) + path.sep)) {
        throw new Error(`manifest.files 越界: ${file}`);
      }
      return resolved;
    });
  }

  const wordsDir = path.join(dir, 'words');
  if (!fs.existsSync(wordsDir)) return [];

  return fs.readdirSync(wordsDir)
    .filter(file => file.endsWith('.json'))
    .sort()
    .map(file => path.join(wordsDir, file));
}

function buildCategories(raw) {
  const categories = new Map();

  for (const [name, definition] of Object.entries(raw)) {
    const severity = definition.severity ?? 2;
    categories.set(name, {
      name: definition.name,
      severity,
      action: normalizeAction(definition.action || 'replace'),
      level: definition.level || levelFromSeverity(severity),
      scopes: definition.scopes || null,
      neverBlock: definition.neverBlock === true,
      maxAction: definition.maxAction ? normalizeAction(definition.maxAction) : null,
      description: definition.description || '',
    });
  }

  return categories;
}

function compileEntry(entry, categoryName, category, warnings) {
  const severity = entry.severity ?? category.severity;
  let action = normalizeAction(entry.action || category.action);
  if (category.maxAction) action = capAction(action, category.maxAction);

  const scopes = entry.scopes || category.scopes || null;
  if (scopes) {
    for (const scope of scopes) {
      if (!KNOWN_SCOPES.has(scope)) {
        warnings.push(`未知 scope "${scope}" (entry ${entry.id})`);
      }
    }
  }

  const normalizedWord = buildViews(entry.word).compact.text;
  if (!normalizedWord) {
    throw new Error(`entry ${entry.id}: word 归一化后为空`);
  }

  return {
    id: entry.id,
    word: entry.word,
    category: categoryName,
    severity,
    action,
    level: category.level || levelFromSeverity(severity),
    scopes,
    neverBlock: category.neverBlock || entry.neverBlock === true,
    description: entry.description || category.description || '',
    notes: entry.notes || '',
    match: entry.match || 'auto',
    maxGap: entry.maxGap,
    aliases: entry.aliases.map(alias =>
      (typeof alias === 'string' ? { word: alias } : alias)
    ),
  };
}

function compileRule(rule, categories) {
  const category = categories.get(rule.category);
  if (!category) {
    throw new Error(`rule ${rule.id}: 未知类别 ${rule.category}`);
  }

  assertSafePattern(rule.pattern, `rule ${rule.id}`);

  const severity = rule.severity ?? category.severity;
  let action = normalizeAction(rule.action || category.action);
  if (category.maxAction) action = capAction(action, category.maxAction);

  try {
    // Compiling up front turns a bad rule into a load-time error.
    new RegExp(rule.pattern, rule.flags || '');
  } catch (error) {
    throw new Error(`rule ${rule.id}: 正则编译失败: ${error.message}`, { cause: error });
  }

  return {
    id: rule.id,
    category: rule.category,
    pattern: rule.pattern,
    flags: rule.flags,
    view: rule.view,
    severity,
    action,
    level: category.level || levelFromSeverity(severity),
    scopes: rule.scopes || category.scopes || null,
    neverBlock: category.neverBlock === true,
    description: rule.description || category.description || '',
    maxMatches: rule.maxMatches,
  };
}

function loadDictionary(dirPath, options = {}) {
  const logger = options.logger;
  const dir = path.resolve(dirPath);
  const defaultMaxGap = Number.isInteger(options.defaultMaxGap) ? options.defaultMaxGap : 2;
  const warnings = [];

  if (!fs.existsSync(dir)) {
    throw new Error(`词库目录不存在: ${dir}`);
  }
  if (!fs.statSync(dir).isDirectory()) {
    throw new Error(`dictionary.path 必须指向目录: ${dir} (旧版 words.json 已不再支持)`);
  }

  const manifestPath = path.join(dir, 'manifest.json');
  const manifest = fs.existsSync(manifestPath)
    ? parse(manifestSchema, readJson(manifestPath, 'manifest'), 'manifest.json')
    : { version: '' };

  const categoriesPath = path.join(dir, 'categories.json');
  if (!fs.existsSync(categoriesPath)) {
    throw new Error(`缺少 categories.json: ${categoriesPath}`);
  }
  const categoriesRaw = parse(
    categoriesFileSchema,
    readJson(categoriesPath, 'categories.json'),
    'categories.json'
  );
  const categories = buildCategories(categoriesRaw);

  const entries = [];
  for (const file of resolveWordFiles(dir, manifest)) {
    const data = parse(wordsFileSchema, readJson(file, path.basename(file)), path.basename(file));
    const category = categories.get(data.category);
    if (!category) {
      throw new Error(`${path.basename(file)}: 未知类别 ${data.category}`);
    }

    for (const entry of data.entries) {
      entries.push(compileEntry(entry, data.category, category, warnings));
    }
  }

  if (entries.length === 0) {
    throw new Error(`词库为空: ${dir}`);
  }

  const rulesPath = path.join(dir, 'rules.json');
  const rules = [];
  if (fs.existsSync(rulesPath)) {
    const data = parse(rulesFileSchema, readJson(rulesPath, 'rules.json'), 'rules.json');
    for (const rule of data.rules) rules.push(compileRule(rule, categories));
  }

  const allowPath = path.join(dir, 'allowlist.json');
  let allowEntries = [];
  if (fs.existsSync(allowPath)) {
    const data = parse(
      allowlistFileSchema,
      readJson(allowPath, 'allowlist.json'),
      'allowlist.json'
    );
    allowEntries = data.allowlist;
    for (const entry of allowEntries) {
      if (entry.regex) assertSafePattern(entry.regex, `allowlist ${entry.id}`);
    }
  }

  // IDs are the stable handle used by logs, stats and allowlist references.
  const ids = new Set();
  for (const item of [...entries, ...rules, ...allowEntries]) {
    if (ids.has(item.id)) throw new Error(`重复 id: ${item.id}`);
    ids.add(item.id);
  }

  const lexicon = buildLexicon(entries, { defaultMaxGap, logger });
  const compiledRules = buildRules(rules);
  const allowlist = buildAllowlist(allowEntries, { defaultMaxGap, logger });

  return {
    version: manifest.version || '',
    description: manifest.description || '',
    categories,
    entries,
    lexicon,
    rules: compiledRules,
    allowlist,
    wordCount: entries.length,
    patternCount: lexicon.patternCount,
    ruleCount: compiledRules.length,
    allowCount: allowlist.size,
    warnings,
  };
}

module.exports = {
  loadDictionary,
  assertSafePattern,
  levelFromSeverity,
  KNOWN_SCOPES,
};
