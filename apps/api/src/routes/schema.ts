import { z } from 'zod';

/**
 * Zod-Schema → JSON-Schema für Fastifys Antwort-Serialisierung. Fastify gibt dadurch nur die dort
 * beschriebenen Felder aus; versehentlich mitgelesene interne Felder verlassen den Server nie.
 */
export function responseSchema(schema: z.ZodType): Record<string, unknown> {
  return z.toJSONSchema(schema, { target: 'draft-7', io: 'output' }) as Record<string, unknown>;
}
