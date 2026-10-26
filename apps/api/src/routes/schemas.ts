import { z } from 'zod';
import { paginationQuery, reason, robloxUserId, snowflake, statsPeriod } from '@enrp/shared';

export { paginationQuery, reason, robloxUserId, snowflake, statsPeriod };

export const idParam = z.object({ id: z.string().min(1).max(64) });
export const reasonBody = z.object({ reason });
export const csvList = z
  .string()
  .max(200)
  .optional()
  .transform((v) => (v ? v.split(',').filter(Boolean) : undefined));
export const isoDate = z.iso.datetime().transform((v) => new Date(v));
export const boolQuery = z.enum(['true', 'false']).optional().transform((v) => (v === undefined ? undefined : v === 'true'));
