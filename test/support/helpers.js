const path = require('path');
const { loadConfig } = require('../../src/config');
const { loadDictionary } = require('../../src/dictionary/loader');
const { ModerationEngine } = require('../../src/engine');
const { Metrics } = require('../../src/metrics');

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };
const FIXTURE_DIR = path.join(__dirname, '..', 'fixtures', 'dictionary');
const REAL_DIR = path.join(__dirname, '..', '..', 'data', 'dictionary');

function makeConfig(dictionaryPath, overrides = {}) {
  const config = loadConfig();
  config.dictionary.path = dictionaryPath;
  config.cache.enabled = overrides.cache === true;
  config.cache.ttlSeconds = 60;
  config.state.enabled = overrides.state === true;
  config.rateLimit.enabled = false;

  if (overrides.moderation) {
    Object.assign(config.moderation, overrides.moderation);
  }
  if (overrides.auth) Object.assign(config.auth, overrides.auth);
  if (overrides.stateConfig) Object.assign(config.state, overrides.stateConfig);

  return config;
}

function buildEngine(dictionaryPath, overrides = {}) {
  const config = makeConfig(dictionaryPath, overrides);
  const dictionary = loadDictionary(config.dictionary.path, {
    logger: silentLogger,
    defaultMaxGap: config.moderation.maxGap,
  });

  return {
    config,
    dictionary,
    logger: silentLogger,
    engine: new ModerationEngine({
      config,
      dictionary,
      logger: silentLogger,
      metrics: new Metrics(),
    }),
  };
}

function fixtureEngine(overrides = {}) {
  return buildEngine(FIXTURE_DIR, overrides);
}

function realEngine(overrides = {}) {
  return buildEngine(REAL_DIR, overrides);
}

module.exports = {
  silentLogger,
  FIXTURE_DIR,
  REAL_DIR,
  makeConfig,
  buildEngine,
  fixtureEngine,
  realEngine,
};
