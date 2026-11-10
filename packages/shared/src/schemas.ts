import { z } from 'zod';

export const snowflake = z.string().regex(/^\d{15,22}$/, 'Ungültige Discord-ID');
export const robloxUserId = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const uuid = z.uuid();
/** Begründungen für kritische Aktionen: Pflicht, sinnvoll lang, ohne Steuerzeichen. */
export const reason = z
  .string()
  .trim()
  .min(3, 'Bitte gib eine Begründung an (mindestens 3 Zeichen).')
  .max(1000)
  // eslint-disable-next-line no-control-regex -- Steuerzeichen sollen gezielt abgelehnt werden
  .refine((v) => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(v), 'Ungültige Zeichen');

export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().trim().max(100).optional(),
  sort: z.string().max(40).optional(),
  order: z.enum(['asc', 'desc']).default('desc'),
});
export type PaginationQuery = z.infer<typeof paginationQuery>;

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export function paginatedSchema<T extends z.ZodType>(item: T) {
  return z.object({ items: z.array(item), page: z.number(), pageSize: z.number(), total: z.number() });
}

/** Zeiträume für Statistiken. */
export const statsPeriod = z.enum(['day', 'week', 'month', 'all']).default('week');
export type StatsPeriod = z.infer<typeof statsPeriod>;

export function periodStart(period: StatsPeriod, now = new Date()): Date | null {
  const d = new Date(now);
  switch (period) {
    case 'day':
      return new Date(d.getTime() - 24 * 3600_000);
    case 'week':
      return new Date(d.getTime() - 7 * 24 * 3600_000);
    case 'month':
      return new Date(d.getTime() - 30 * 24 * 3600_000);
    default:
      return null;
  }
}
