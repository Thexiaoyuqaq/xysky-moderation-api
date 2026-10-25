const express = require('express');
const { createSchemas } = require('./schemas');
const { requireToken, requireReloadAuth } = require('./auth');
const { notFound, errorHandler } = require('./errors');

function createRoutes(options) {
  const { config, engine, logger, startedAt, reload } = options;
  const router = express.Router();
  const { moderateSchema, batchSchema } = createSchemas(config);
  const tokenAuth = requireToken(config, logger);
  const reloadAuth = requireReloadAuth(config, logger);

  const version = () => config.dictionary.version || engine.dictionary.version;

  router.get('/health', (req, res) => {
    const dictionary = engine.dictionary;
    res.json({
      ok: true,
      words: dictionary.wordCount,
      version: version(),
      uptimeMs: Date.now() - startedAt,
      cacheSize: engine.cache ? engine.cache.size : 0,
      // Additive diagnostics.
      patterns: dictionary.patternCount,
      rules: dictionary.ruleCount,
      allowlist: dictionary.allowCount,
      stateUsers: engine.state.enabled ? engine.state.size : 0,
    });
  });

  router.post('/v1/moderate', tokenAuth, (req, res, next) => {
    try {
      const input = moderateSchema.parse(req.body || {});
      res.json(engine.moderate(input));
    } catch (error) {
      next(error);
    }
  });

  router.post('/v1/moderate/batch', tokenAuth, (req, res, next) => {
    try {
      const { items } = batchSchema.parse(req.body || {});
      res.json({ results: items.map(item => engine.moderate(item)) });
    } catch (error) {
      next(error);
    }
  });

  router.get('/v1/stats', tokenAuth, (req, res) => {
    res.json(engine.stats());
  });

  router.post('/v1/reload', reloadAuth, (req, res) => {
    try {
      const dictionary = reload();
      logger?.info(
        'Dictionary reloaded',
        `entries=${dictionary.wordCount}`,
        `patterns=${dictionary.patternCount}`,
        `rules=${dictionary.ruleCount}`
      );
      res.json({
        ok: true,
        words: dictionary.wordCount,
        version: version(),
        patterns: dictionary.patternCount,
        rules: dictionary.ruleCount,
        allowlist: dictionary.allowCount,
        warnings: dictionary.warnings,
      });
    } catch (error) {
      logger?.error('Dictionary reload failed', error.message);
      res.status(500).json({ error: 'Reload failed', detail: error.message });
    }
  });

  router.use(notFound);
  router.use(errorHandler(logger));

  return router;
}

module.exports = { createRoutes };
