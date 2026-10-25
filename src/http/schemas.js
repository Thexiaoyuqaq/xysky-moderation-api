const { z } = require('zod');

function createSchemas(config) {
  const maxTextLength = config.moderation.maxTextLength;

  const moderateSchema = z.object({
    text: z.string().max(maxTextLength),
    scope: z.string().max(32).optional(),
    userId: z.string().max(128).optional().nullable(),
    locale: z.string().max(32).optional().nullable(),
    context: z.any().optional().nullable(),
  });

  const batchSchema = z.object({
    items: z.array(moderateSchema).min(1).max(50),
  });

  return { moderateSchema, batchSchema };
}

module.exports = { createSchemas };
