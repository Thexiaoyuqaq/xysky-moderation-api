const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { z } = require('zod');

const actionSchema = z.enum(['allow', 'review', 'replace', 'block', 'warn']);

const scopePolicySchema = z.looseObject({
  // `review` is meaningless for nicknames (the client shows the original text),
  // so a scope profile can turn it into a mask or a hard block.
  reviewAction: actionSchema.optional(),
  maxAction: actionSchema.optional(),
});

const configSchema = z.looseObject({
  server: z.looseObject({
    host: z.string().default('0.0.0.0'),
    port: z.coerce.number().int().min(1).max(65535).default(8787),
  }).prefault({}),
  auth: z.looseObject({
    token: z.string().default(''),
  }).prefault({}),
  dictionary: z.looseObject({
    path: z.string().default('./data/dictionary'),
    version: z.string().default(''),
  }).prefault({}),
  moderation: z.looseObject({
    replacementChar: z.string().min(1).default('*'),
    maxTextLength: z.coerce.number().int().min(1).max(100000).default(2000),
    defaultScope: z.string().default('chat'),
    maxGap: z.coerce.number().int().min(0).max(16).default(2),
    logViolations: z.boolean().default(true),
    escalation: z.looseObject({
      enabled: z.boolean().default(true),
      sameCategory: z.coerce.number().int().min(0).default(3),
      totalSeverity: z.coerce.number().int().min(0).default(6),
    }).prefault({}),
    scopes: z.record(z.string(), scopePolicySchema).prefault({}),
  }).prefault({}),
  cache: z.looseObject({
    enabled: z.boolean().default(true),
    maxEntries: z.coerce.number().int().min(1).default(5000),
    ttlSeconds: z.coerce.number().int().min(0).default(300),
  }).prefault({}),
  rateLimit: z.looseObject({
    enabled: z.boolean().default(true),
    windowMs: z.coerce.number().int().min(100).default(10000),
    max: z.coerce.number().int().min(1).default(120),
    maxBuckets: z.coerce.number().int().min(100).default(10000),
  }).prefault({}),
  state: z.looseObject({
    enabled: z.boolean().default(true),
    ttlSeconds: z.coerce.number().int().min(1).default(600),
    maxUsers: z.coerce.number().int().min(1).default(20000),
    duplicateWindowMs: z.coerce.number().int().min(1000).default(60000),
    duplicateThreshold: z.coerce.number().int().min(2).default(3),
    violationWindowMs: z.coerce.number().int().min(60000).default(600000),
    violationThreshold: z.coerce.number().int().min(2).default(3),
    flood: z.looseObject({
      windowMs: z.coerce.number().int().min(1000).default(10000),
      max: z.coerce.number().int().min(1).default(8),
    }).prefault({}),
  }).prefault({}),
  heuristics: z.looseObject({
    enabled: z.boolean().default(true),
  }).prefault({}),
});

const ROOT = path.resolve(__dirname, '..');

function loadConfig(filePath = path.join(ROOT, 'config', 'config.yml')) {
  let raw = {};
  if (fs.existsSync(filePath)) {
    raw = yaml.load(fs.readFileSync(filePath, 'utf8')) || {};
  }

  const result = configSchema.safeParse(raw);
  if (!result.success) {
    const detail = result.error.issues
      .map(issue => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
      .join('\n');
    throw new Error(`配置文件校验失败:\n${detail}`);
  }

  const config = result.data;
  config.dictionary.path = path.isAbsolute(config.dictionary.path)
    ? config.dictionary.path
    : path.resolve(ROOT, config.dictionary.path);

  return config;
}

module.exports = { loadConfig, configSchema, ROOT };
