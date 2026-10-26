import { and, approvalRequests, desc, eq, lt, sql, type DbExecutor } from '@enrp/database';
import { AppError, errors } from '@enrp/shared';
import { type Actor, actorId, hasPermission, requirePermission, requireUser } from './actor';
import { writeAudit } from './audit';
import { type CoreContext, type TxContext } from './context';
import { canonicalJson, sha256Hex } from './crypto';

export interface ApprovalExecutor {
  /** Berechtigung, die zusätzlich zu approvals:approve für die Freigabe nötig ist. */
  requiredPermission: string;
  execute: (ctx: TxContext, payload: Record<string, unknown>, approval: { id: string; requestedBy: string; reason: string }) => Promise<unknown>;
}

const executors = new Map<string, ApprovalExecutor>();

export function registerApprovalExecutor(actionType: string, executor: ApprovalExecutor): void {
  executors.set(actionType, executor);
}

export function approvalActionTypes(): string[] {
  return [...executors.keys()].sort();
}

const DEFAULT_TTL_HOURS = 24;

export async function createApproval(
  ctx: CoreContext | TxContext,
  actor: Actor,
  input: { actionType: string; summary: string; payload: Record<string, unknown>; reason: string; ttlHours?: number },
) {
  const user = requireUser(actor);
  if (!executors.has(input.actionType)) throw errors.badRequest(`Unbekannter Freigabetyp: ${input.actionType}`);
  const ttl = Math.min(Math.max(input.ttlHours ?? DEFAULT_TTL_HOURS, 1), 168);
  const now = ctx.now();
  const run = async (db: DbExecutor) => {
    const [row] = await db
      .insert(approvalRequests)
      .values({
        actionType: input.actionType,
        summary: input.summary,
        payload: input.payload,
        payloadHash: sha256Hex(canonicalJson({ actionType: input.actionType, payload: input.payload })),
        reason: input.reason,
        requestedBy: user.discordUserId,
        expiresAt: new Date(now.getTime() + ttl * 3600_000),
      })
      .returning();
    await writeAudit(
      db,
      actor,
      { action: 'approval.create', resourceType: 'approval', resourceId: row!.id, reason: input.reason, after: { actionType: input.actionType, summary: input.summary } },
      now,
    );
    return row!;
  };
  // In einer bestehenden Transaktion legt drizzle einen Savepoint an.
  const row = await (ctx.db as CoreContext['db']).transaction(run);
  ctx.realtime.publish('approvals', 'approval.created', { id: row.id, number: row.number, summary: row.summary });
  return row;
}

export async function getApproval(db: DbExecutor, idOrNumber: string) {
  const isNumber = /^\d+$/.test(idOrNumber);
  const [row] = await db
    .select()
    .from(approvalRequests)
    .where(isNumber ? eq(approvalRequests.number, Number(idOrNumber)) : eq(approvalRequests.id, idOrNumber));
  return row ?? null;
}

export async function listApprovals(db: DbExecutor, status?: string, limit = 50) {
  return db
    .select()
    .from(approvalRequests)
    .where(status ? eq(approvalRequests.status, status as never) : undefined)
    .orderBy(desc(approvalRequests.createdAt))
    .limit(limit);
}

/**
 * Genehmigt oder lehnt eine Anfrage ab. Bei Genehmigung wird die Aktion in derselben Transaktion
 * genau einmal ausgeführt; schlägt sie fehl, bleibt die Anfrage offen.
 */
export async function decideApproval(
  ctx: CoreContext,
  actor: Actor,
  idOrNumber: string,
  decision: 'approve' | 'reject',
  reason: string,
) {
  const user = requireUser(actor);
  requirePermission(actor, 'approvals:approve');
  const pre = await getApproval(ctx.db, idOrNumber);
  if (pre?.status === 'pending' && pre.expiresAt <= ctx.now()) {
    // Außerhalb der Entscheidungs-Transaktion markieren, damit der Status nicht per Rollback verloren geht.
    await ctx.db.update(approvalRequests).set({ status: 'expired' }).where(and(eq(approvalRequests.id, pre.id), eq(approvalRequests.status, 'pending')));
    throw new AppError('GONE', 'Die Freigabeanfrage ist abgelaufen.');
  }
  return ctx.db.transaction(async (tx) => {
    const found = await getApproval(tx, idOrNumber);
    if (!found) throw errors.notFound('Freigabeanfrage');
    // Zeile sperren, damit parallele Entscheidungen nicht doppelt ausführen.
    const [approval] = await tx.select().from(approvalRequests).where(eq(approvalRequests.id, found.id)).for('update');
    if (!approval) throw errors.notFound('Freigabeanfrage');
    const now = ctx.now();
    if (approval.status !== 'pending') throw errors.invalidState(`Die Anfrage ist bereits ${approval.status}.`);
    if (approval.expiresAt <= now) throw new AppError('GONE', 'Die Freigabeanfrage ist abgelaufen.');
    if (approval.requestedBy === user.discordUserId) {
      throw new AppError('SELF_ACTION_FORBIDDEN', 'Du kannst deine eigene Anfrage nicht selbst genehmigen oder ablehnen.');
    }
    const executor = executors.get(approval.actionType);
    if (!executor) throw errors.invalidState('Für diesen Freigabetyp gibt es keine Ausführung mehr.');
    if (!hasPermission(actor, executor.requiredPermission)) {
      throw errors.forbidden(`Für diese Freigabe brauchst du zusätzlich „${executor.requiredPermission}“.`);
    }
    // Integrität: Payload darf seit der Beantragung nicht verändert worden sein.
    const hash = sha256Hex(canonicalJson({ actionType: approval.actionType, payload: approval.payload }));
    if (hash !== approval.payloadHash) throw errors.invalidState('Die Anfrage wurde verändert und kann nicht ausgeführt werden.');

    if (decision === 'reject') {
      const [row] = await tx
        .update(approvalRequests)
        .set({ status: 'rejected', decidedBy: user.discordUserId, decidedAt: now, decisionReason: reason })
        .where(eq(approvalRequests.id, approval.id))
        .returning();
      await writeAudit(tx, actor, { action: 'approval.reject', resourceType: 'approval', resourceId: approval.id, reason }, now);
      return row!;
    }

    const result = await executor.execute({ ...ctx, db: tx }, approval.payload as Record<string, unknown>, {
      id: approval.id,
      requestedBy: approval.requestedBy,
      reason: approval.reason,
    });
    const [row] = await tx
      .update(approvalRequests)
      .set({
        status: 'executed',
        decidedBy: user.discordUserId,
        decidedAt: now,
        decisionReason: reason,
        executedAt: now,
        executedBy: actorId(actor),
        executionResult: (result ?? null) as never,
      })
      .where(and(eq(approvalRequests.id, approval.id), eq(approvalRequests.status, 'pending')))
      .returning();
    if (!row) throw errors.invalidState('Die Anfrage wurde parallel bearbeitet.');
    await writeAudit(
      tx,
      actor,
      { action: 'approval.approve', resourceType: 'approval', resourceId: approval.id, reason, metadata: { actionType: approval.actionType } },
      now,
    );
    return row;
  });
}

export async function cancelApproval(ctx: CoreContext, actor: Actor, idOrNumber: string, reason: string) {
  const user = requireUser(actor);
  return ctx.db.transaction(async (tx) => {
    const approval = await getApproval(tx, idOrNumber);
    if (!approval) throw errors.notFound('Freigabeanfrage');
    if (approval.requestedBy !== user.discordUserId) throw errors.forbidden('Nur die antragstellende Person kann die Anfrage zurückziehen.');
    const [row] = await tx
      .update(approvalRequests)
      .set({ status: 'cancelled', decisionReason: reason, decidedAt: ctx.now() })
      .where(and(eq(approvalRequests.id, approval.id), eq(approvalRequests.status, 'pending')))
      .returning();
    if (!row) throw errors.invalidState('Die Anfrage ist nicht mehr offen.');
    await writeAudit(tx, actor, { action: 'approval.cancel', resourceType: 'approval', resourceId: approval.id, reason }, ctx.now());
    return row;
  });
}

/** Markiert abgelaufene Anfragen (Worker). */
export async function expireApprovals(db: DbExecutor, now: Date): Promise<number> {
  const rows = await db
    .update(approvalRequests)
    .set({ status: 'expired' })
    .where(and(eq(approvalRequests.status, 'pending'), lt(approvalRequests.expiresAt, now)))
    .returning({ id: approvalRequests.id });
  return rows.length;
}

export async function pendingApprovalCount(db: DbExecutor): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(approvalRequests)
    .where(eq(approvalRequests.status, 'pending'));
  return row?.count ?? 0;
}
