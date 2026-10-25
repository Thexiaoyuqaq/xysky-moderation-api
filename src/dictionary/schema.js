/**
 * Dictionary file schemas. Load-time validation is intentionally strict: a typo
 * in a word file should fail loudly instead of silently weakening moderation.
 */
const { z } = require('zod');

const ACTION = z.enum(['allow', 'review', 'replace', 'block', 'warn']);
const LEVEL = z.enum(['low', 'medium', 'high', 'critical']);
const SEVERITY = z.number().int().min(0).max(4);
const SCOPES = z.array(z.string().min(1).max(32)).max(20);
const MATCH = z.enum(['auto', 'cjk', 'latin']);
const ID = z.string().min(2).max(80).regex(/^[a-z0-9][a-z0-9._-]*$/i, 'id must be [a-z0-9._-]');

const aliasSchema = z.union([
  z.string().min(1).max(64),
  z.object({
    word: z.string().min(1).max(64),
    severity: SEVERITY.optional(),
    action: ACTION.optional(),
    match: MATCH.optional(),
    maxGap: z.number().int().min(0).max(16).optional(),
    scopes: SCOPES.optional(),
  }).strict(),
]);

const entrySchema = z.object({
  id: ID,
  word: z.string().min(1).max(64),
  aliases: z.array(aliasSchema).max(40).default([]),
  match: MATCH.default('auto'),
  maxGap: z.number().int().min(0).max(16).optional(),
  severity: SEVERITY.optional(),
  action: ACTION.optional(),
  scopes: SCOPES.optional(),
  description: z.string().max(200).optional(),
  notes: z.string().max(500).optional(),
}).strict();

const categorySchema = z.object({
  name: z.string().min(1).max(64),
  level: LEVEL.optional(),
  severity: SEVERITY.optional(),
  action: ACTION.optional(),
  scopes: SCOPES.optional(),
  neverBlock: z.boolean().optional(),
  maxAction: ACTION.optional(),
  description: z.string().max(200).optional(),
}).strict();

const categoriesFileSchema = z.record(z.string().min(1).max(40), categorySchema);

const wordsFileSchema = z.object({
  category: z.string().min(1).max(40),
  entries: z.array(entrySchema).min(1).max(2000),
}).strict();

const ruleSchema = z.object({
  id: ID,
  category: z.string().min(1).max(40),
  pattern: z.string().min(1).max(500),
  flags: z.string().max(10).regex(/^[gimsuy]*$/, 'invalid regex flags').default(''),
  view: z.enum(['canonical', 'folded', 'compact', 'raw']).default('canonical'),
  severity: SEVERITY.optional(),
  action: ACTION.optional(),
  scopes: SCOPES.optional(),
  description: z.string().max(200).optional(),
  maxMatches: z.number().int().min(1).max(100).optional(),
}).strict();

const rulesFileSchema = z.object({
  rules: z.array(ruleSchema).max(500),
}).strict();

const allowSchema = z.object({
  id: ID,
  pattern: z.string().min(1).max(64).optional(),
  regex: z.string().min(1).max(500).optional(),
  flags: z.string().max(10).regex(/^[gimsuy]*$/, 'invalid regex flags').default(''),
  view: z.enum(['canonical', 'folded', 'compact', 'raw']).default('canonical'),
  match: MATCH.default('auto'),
  maxGap: z.number().int().min(0).max(16).optional(),
  scopes: SCOPES.optional(),
  description: z.string().max(200).optional(),
}).strict().refine(
  value => Boolean(value.pattern) !== Boolean(value.regex),
  { message: 'allowlist entry needs exactly one of pattern/regex' }
);

const allowlistFileSchema = z.object({
  allowlist: z.array(allowSchema).max(1000),
}).strict();

const manifestSchema = z.object({
  version: z.string().max(64).default(''),
  description: z.string().max(200).optional(),
  files: z.array(z.string().max(200)).optional(),
}).strict();

function formatIssues(error) {
  return error.issues
    .map(issue => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
    .join('; ');
}

function parse(schema, value, label) {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new Error(`${label} 校验失败: ${formatIssues(result.error)}`);
  }
  return result.data;
}

module.exports = {
  parse,
  manifestSchema,
  categoriesFileSchema,
  wordsFileSchema,
  rulesFileSchema,
  allowlistFileSchema,
  ruleSchema,
  entrySchema,
  categorySchema,
};
