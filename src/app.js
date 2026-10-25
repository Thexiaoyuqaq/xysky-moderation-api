const express = require('express');
const { loadConfig } = require('./config');
const { createLogger } = require('./logger');
const { loadDictionary } = require('./dictionary/loader');
const { ModerationEngine } = require('./engine');
const { Metrics } = require('./metrics');
const { createRateLimiter } = require('./http/rateLimit');
const { createRoutes } = require('./http/routes');
const { errorHandler } = require('./http/errors');

function createApp(options = {}) {
  const config = options.config || loadConfig();
  const logger = options.logger || createLogger();

  const dictionary = options.dictionary || loadDictionary(config.dictionary.path, {
    logger,
    defaultMaxGap: config.moderation.maxGap,
  });
  if (config.dictionary.version) dictionary.version = config.dictionary.version;

  const metrics = options.metrics || new Metrics();
  const engine = new ModerationEngine({ config, dictionary, logger, metrics });

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.use(createRateLimiter(config, logger));
  app.use(createRoutes({
    config,
    engine,
    logger,
    startedAt: Date.now(),
    reload: () => {
      const next = loadDictionary(config.dictionary.path, {
        logger,
        defaultMaxGap: config.moderation.maxGap,
      });
      if (config.dictionary.version) next.version = config.dictionary.version;
      engine.replaceDictionary(next);
      return next;
    },
  }));

  // Body-parser errors happen before the router, so they need an app-level
  // error handler as well. Without this Express logs a stack and returns HTML.
  app.use(errorHandler(logger));

  return { app, config, dictionary, engine, cache: engine.cache, metrics, logger };
}

async function start() {
  const { app, config, engine, logger } = createApp();

  const server = await new Promise((resolve, reject) => {
    const instance = app.listen(config.server.port, config.server.host, () => resolve(instance));
    instance.once('error', reject);
  });

  logger.info(
    `Moderation API listening on ${config.server.host}:${config.server.port}`,
    `entries=${engine.dictionary.wordCount}`,
    `patterns=${engine.dictionary.patternCount}`,
    `rules=${engine.dictionary.ruleCount}`,
    `auth=${config.auth.token ? 'token' : 'open'}`,
    `state=${engine.state.enabled ? 'on' : 'off'}`
  );

  for (const warning of engine.dictionary.warnings) {
    logger.warn('Dictionary warning', warning);
  }

  const shutdown = (signal) => {
    logger.info(`Received ${signal}, shutting down`);
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  return server;
}

if (require.main === module) {
  start().catch((error) => {
    createLogger().error('Startup failed', error.message);
    process.exit(1);
  });
}

module.exports = { createApp, start };
