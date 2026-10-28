import { and, auditEvents, desc, eq, gte, ilike, lte, sql, type DbExecutor } from '@enrp/database';
import { type Actor, actorId, actorTypeOf } from './actor';
import { canonicalJson, sha256Hex } from './crypto';
import { requestContext } from './request-context';

export const GENESIS_HASH = '0'.repeat(64);

export interface AuditEntry {
  action: string;
  resourceType: string;
  resourceId?: string | number | null;
  reason?: string | null;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown> | null;
  requestId?: string | null;
}

interface HashInput {
  occurredAt: string;
  actorType: string;
  actorId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  reason: string | null;
  before: unknown;
  after: unknown;
  metadata: unknown;
}

export function computeAuditHash(prevHash: string, input: HashInput): string {
  return sha256Hex(`${prevHash}|${canonicalJson(input)}`);
}

const normalize = (value: unknown) => (value === undefined ? null : JSON.parse(JSON.stringify(value)));

/**
 * Schreibt einen Audit-Eintrag. Muss in derselben Transaktion wie die eigentliche Änderung aufgerufen werden.
 * Ein Advisory-Lock serialisiert die Hash-Kette.
 */
export async function writeAudit(db: DbExecutor, actor: Actor, entry: AuditEntry, now: Date = new Date()) {
  await db.execute(sql`select pg_advisory_xact_lock(hashtext('enrp_audit_chain'))`);
  const [last] = await db.select({ hash: auditEvents.hash }).from(auditEvents).orderBy(desc(auditEvents.id)).limit(1);
  const prevHash = last?.hash ?? GENESIS_HASH;
  const occurredAt = new Date(now.getTime());
  const input: HashInput = {
    occurredAt: occurredAt.toISOString(),
    actorType: actorTypeOf(actor),
    actorId: actorId(actor),
    action: entry.action,
    resourceType: entry.resourceType,
    resourceId: entry.resourceId === undefined || entry.resourceId === null ? null : String(entry.resourceId),
    reason: entry.reason ?? null,
    before: normalize(entry.before),
    after: normalize(entry.after),
    metadata: normalize(entry.metadata),
  };
  const hash = computeAuditHash(prevHash, input);
  const [row] = await db
    .insert(auditEvents)
    .values({
      occurredAt,
      actorType: input.actorType as never,
      actorId: input.actorId,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      reason: input.reason,
      before: input.before,
      after: input.after,
      metadata: input.metadata,
      requestId: entry.requestId ?? requestContext.getStore()?.requestId ?? null,
      prevHash,
      hash,
    })
    .returning({ id: auditEvents.id });
  return row!.id;
}

export interface AuditVerification {
  ok: boolean;
  checked: number;
  firstId: number | null;
  lastId: number | null;
  brokenAt?: { id: number; reason: string };
}

/** Prüft die Hash-Kette. Nach Löschungen durch Aufbewahrungsfristen ist die älteste verbleibende Zeile der Anker. */
export async function verifyAuditChain(db: DbExecutor, batchSize = 1000): Promise<AuditVerification> {
  let lastId = 0;
  let prev: string | null = null;
  let checked = 0;
  let firstId: number | null = null;
  for (;;) {
    const rows = await db
      .select()
      .from(auditEvents)
      .where(sql`${auditEvents.id} > ${lastId}`)
      .orderBy(auditEvents.id)
      .limit(batchSize);
    if (!rows.length) break;
    for (const row of rows) {
      firstId ??= row.id;
      if (prev !== null && row.prevHash !== prev) {
        return {
          ok: false,
          checked,
          firstId,
          lastId: row.id,
          brokenAt: { id: row.id, reason: 'prev_hash passt nicht zur vorherigen Zeile' },
        };
      }
      const expected = computeAuditHash(row.prevHash, {
        occurredAt: row.occurredAt.toISOString(),
        actorType: row.actorType,
        actorId: row.actorId,
        action: row.action,
        resourceType: row.resourceType,
        resourceId: row.resourceId,
        reason: row.reason,
        before: row.before,
        after: row.after,
        metadata: row.metadata,
      });
      if (expected !== row.hash) {
        return {
          ok: false,
          checked,
          firstId,
          lastId: row.id,
          brokenAt: { id: row.id, reason: 'Inhalt wurde verändert (Hash stimmt nicht)' },
        };
      }
      prev = row.hash;
      lastId = row.id;
      checked++;
    }
  }
  return { ok: true, checked, firstId, lastId: checked ? lastId : null };
}

export interface AuditSearch {
  actorId?: string;
  action?: string;
  resourceType?: string;
  resourceId?: string;
  from?: Date;
  to?: Date;
  page: number;
  pageSize: number;
}

export async function searchAudit(db: DbExecutor, filter: AuditSearch) {
  const conditions = [
    filter.actorId ? eq(auditEvents.actorId, filter.actorId) : undefined,
    filter.action ? ilike(auditEvents.action, `${filter.action.replace(/[%_]/g, '')}%`) : undefined,
    filter.resourceType ? eq(auditEvents.resourceType, filter.resourceType) : undefined,
    filter.resourceId ? eq(auditEvents.resourceId, filter.resourceId) : undefined,
    filter.from ? gte(auditEvents.occurredAt, filter.from) : undefined,
    filter.to ? lte(auditEvents.occurredAt, filter.to) : undefined,
  ].filter(Boolean);
  const where = conditions.length ? and(...conditions) : undefined;
  const [items, [total]] = await Promise.all([
    db
      .select()
      .from(auditEvents)
      .where(where)
      .orderBy(desc(auditEvents.id))
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(auditEvents)
      .where(where),
  ]);
  return { items, total: total?.count ?? 0, page: filter.page, pageSize: filter.pageSize };
}

export interface DiffEntry {
  path: string;
  before: unknown;
  after: unknown;
}

/** Feldweiser Vergleich zweier JSON-Zustände für /audit diff. */
export function diffJson(before: unknown, after: unknown, path = ''): DiffEntry[] {
  const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  if (isObj(before) && isObj(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    return [...keys].sort().flatMap((k) => diffJson(before[k], after[k], path ? `${path}.${k}` : k));
  }
  if (canonicalJson(before ?? null) === canonicalJson(after ?? null)) return [];
  return [{ path: path || '(gesamt)', before: before ?? null, after: after ?? null }];
}
