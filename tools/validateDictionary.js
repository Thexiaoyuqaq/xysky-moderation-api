#!/usr/bin/env node
/**
 * Offline dictionary validator.
 *
 *   node tools/validateDictionary.js [directory]
 *   npm run validate
 *
 * Exits non-zero on schema errors, duplicate ids, single-character CJK words,
 * unsafe regexes and unknown categories.
 */
const path = require('path');
const { loadDictionary } = require('../src/dictionary/loader');

const target = process.argv[2] || path.join(__dirname, '..', 'data', 'dictionary');
const warnings = [];
const logger = {
  info() {},
  debug() {},
  error: (...args) => console.error(...args),
  warn: (...args) => warnings.push(args.join(' ')),
};

try {
  const dictionary = loadDictionary(target, { logger, defaultMaxGap: 2 });

  console.log(`dictionary : ${target}`);
  console.log(`version    : ${dictionary.version || '(none)'}`);
  console.log(`entries    : ${dictionary.wordCount}`);
  console.log(`patterns   : ${dictionary.patternCount}`);
  console.log(`rules      : ${dictionary.ruleCount}`);
  console.log(`allowlist  : ${dictionary.allowCount}`);
  console.log(`categories : ${dictionary.categories.size}`);

  const perCategory = {};
  for (const entry of dictionary.entries) {
    perCategory[entry.category] = (perCategory[entry.category] || 0) + 1;
  }
  console.log('by category:', perCategory);

  for (const warning of [...warnings, ...dictionary.warnings]) {
    console.warn(`warning: ${warning}`);
  }

  console.log('OK');
} catch (error) {
  console.error(`FAILED: ${error.message}`);
  process.exit(1);
}
