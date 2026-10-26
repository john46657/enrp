import { type Paginated, type PaginationQuery } from '@enrp/shared';

export function pageOffset(q: Pick<PaginationQuery, 'page' | 'pageSize'>): number {
  return (q.page - 1) * q.pageSize;
}

export function paginated<T>(items: T[], total: number, q: Pick<PaginationQuery, 'page' | 'pageSize'>): Paginated<T> {
  return { items, total, page: q.page, pageSize: q.pageSize };
}

/** Escaped Suchbegriffe für ILIKE. */
export function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
}

export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const e = (err as { cause?: { code?: string; constraint?: string } } & { code?: string; constraint?: string }) ?? {};
  const pg = e.code ? e : e.cause ?? {};
  return pg.code === '23505' && (!constraint || pg.constraint === constraint);
}

export function isCheckViolation(err: unknown): boolean {
  const e = (err as { cause?: { code?: string }; code?: string }) ?? {};
  return (e.code ?? e.cause?.code) === '23514';
}
