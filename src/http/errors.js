const { z } = require('zod');

function notFound(req, res) {
  res.status(404).json({ error: 'Not found' });
}

function errorHandler(logger) {
  // eslint-disable-next-line no-unused-vars
  return (error, req, res, _next) => {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', issues: error.issues });
    }

    if (error?.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'Invalid JSON body' });
    }

    if (error?.type === 'entity.too.large') {
      return res.status(413).json({ error: 'Payload too large' });
    }

    logger?.error('Request failed', req.method, req.path, error?.message);
    return res.status(500).json({ error: 'Internal error' });
  };
}

module.exports = { notFound, errorHandler };
