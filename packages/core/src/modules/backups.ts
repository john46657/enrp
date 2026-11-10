import { and, backupRuns, desc, eq, restoreRequests, sql, type DbExecutor } from '@enrp/database';
import { errors } from '@enrp/shared';
import { type Actor, actorId, requirePermission, requireUser } from '../actor';
import { createApproval, registerApprovalExecutor } from '../approvals';
import { writeAudit } from '../audit';
import { type CoreContext, type TxContext } from '../context';

export async function requestBackup(ctx: CoreContext, actor: Actor) {
  requirePermission(actor, 'backups:create');
  const [running] = await ctx.db
    .select({ id: backupRuns.id })
    .from(backupRuns)
    .where(sql`${backupRuns.status} in ('running', 'verifying')`);
  if (running) throw errors.conflict('Es läuft bereits ein Backup.');
  await writeAudit(ctx.db, actor, { action: 'backup.request', resourceType: 'backup' }, ctx.now());
  await ctx.queue.enqueue('backups', 'backup.run', { kind: 'manual', triggeredBy: actorId(actor) }, { attempts: 1 });
  return { queued: true };
}

export async function startBackupRun(db: DbExecutor, input: { kind: string; triggeredBy: string }) {
  const [row] = await db
    .insert(backupRuns)
    .values({ kind: input.kind, triggeredBy: input.triggeredBy, status: 'running' })
    .returning();
  return row!;
}

export async function markBackupVerifying(
  db: DbExecutor,
  id: string,
  input: { fileName: string; storageLocation: string; sizeBytes: number; sha256: string },
) {
  await db
    .update(backupRuns)
    .set({ status: 'verifying', ...input })
    .where(eq(backupRuns.id, id));
}

/** Erst nach erfolgreicher Integritätsprüfung gilt ein Backup als erfolgreich. */
export async function completeBackupRun(
  db: DbExecutor,
  id: string,
  input: { verification: Record<string, unknown>; expiresAt: Date; now: Date },
) {
  const [row] = await db
    .update(backupRuns)
    .set({
      status: 'succeeded',
      verifiedAt: input.now,
      verification: input.verification,
      finishedAt: input.now,
      expiresAt: input.expiresAt,
    })
    .where(eq(backupRuns.id, id))
    .returning();
  return row!;
}

export async function failBackupRun(db: DbExecutor, id: string, error: string, now: Date) {
  const [row] = await db
    .update(backupRuns)
    .set({ status: 'failed', error: error.slice(0, 2000), finishedAt: now })
    .where(eq(backupRuns.id, id))
    .returning();
  return row!;
}

export async function listBackups(db: DbExecutor, limit = 50) {
  return db.select().from(backupRuns).orderBy(desc(backupRuns.startedAt)).limit(limit);
}

export async function getBackup(db: DbExecutor, id: string) {
  const [row] = await db.select().from(backupRuns).where(eq(backupRuns.id, id));
  if (!row) throw errors.notFound('Backup');
  return row;
}

/** Status für Monitoring und Automatisierung: letztes erfolgreiches Backup und Fehlschläge in Folge. */
export async function backupHealth(db: DbExecutor, now: Date) {
  const recent = await db
    .select()
    .from(backupRuns)
    .where(sql`${backupRuns.status} in ('succeeded', 'failed')`)
    .orderBy(desc(backupRuns.startedAt))
    .limit(20);
  let consecutiveFailures = 0;
  for (const r of recent) {
    if (r.status === 'failed') consecutiveFailures++;
    else break;
  }
  const lastSuccess = recent.find((r) => r.status === 'succeeded') ?? null;
  return {
    lastSuccessAt: lastSuccess?.verifiedAt ?? null,
    hoursSinceSuccess: lastSuccess?.verifiedAt
      ? Math.round((now.getTime() - lastSuccess.verifiedAt.getTime()) / 3600_000)
      : null,
    consecutiveFailures,
    lastRun: recent[0] ?? null,
  };
}

/**
 * Wiederherstellung anfordern. Vorschau aus den Prüfdaten des Backups. Produktion erfordert immer eine
 * Vier-Augen-Freigabe; andere Umgebungen benötigen backups:approve.
 */
export async function requestRestore(
  ctx: CoreContext,
  actor: Actor,
  input: { backupId: string; targetEnvironment: string; reason: string },
) {
  requireUser(actor);
  requirePermission(actor, 'backups:create');
  const backup = await getBackup(ctx.db, input.backupId);
  if (backup.status !== 'succeeded' || !backup.verifiedAt)
    throw errors.invalidState('Nur geprüfte, erfolgreiche Backups können wiederhergestellt werden.');
  if (backup.deletedAt) throw errors.invalidState('Die Backup-Datei wurde bereits gelöscht.');
  if (!['development', 'staging', 'production', 'restore_test'].includes(input.targetEnvironment))
    throw errors.badRequest('Unbekannte Zielumgebung.');
  const preview = {
    backupId: backup.id,
    fileName: backup.fileName,
    createdAt: backup.startedAt,
    sizeBytes: backup.sizeBytes,
    sha256: backup.sha256,
    tables: (backup.verification as { tables?: unknown } | null)?.tables ?? null,
    warning: input.targetEnvironment === 'production' ? 'Alle Daten seit dem Backup-Zeitpunkt gehen verloren.' : null,
  };
  const [request] = await ctx.db
    .insert(restoreRequests)
    .values({
      backupId: backup.id,
      targetEnvironment: input.targetEnvironment,
      preview,
      requestedBy: actorId(actor),
      reason: input.reason,
      status: 'awaiting_approval',
    })
    .returning();
  await writeAudit(
    ctx.db,
    actor,
    {
      action: 'backup.restore.request',
      resourceType: 'restore_request',
      resourceId: request!.id,
      reason: input.reason,
      after: { target: input.targetEnvironment, backupId: backup.id },
    },
    ctx.now(),
  );
  const approval = await createApproval(ctx, actor, {
    actionType: 'backup.restore',
    summary: `Backup vom ${backup.startedAt.toISOString()} in „${input.targetEnvironment}“ wiederherstellen`,
    payload: { restoreRequestId: request!.id, backupId: backup.id, targetEnvironment: input.targetEnvironment },
    reason: input.reason,
    ttlHours: 4,
  });
  await ctx.db
    .update(restoreRequests)
    .set({ approvalRequestId: approval.id })
    .where(eq(restoreRequests.id, request!.id));
  return { request: request!, approval, preview };
}

registerApprovalExecutor('backup.restore', {
  requiredPermission: 'backups:approve',
  execute: async (ctx: TxContext, payload) => {
    const id = String(payload.restoreRequestId);
    const [row] = await ctx.db
      .update(restoreRequests)
      .set({ status: 'approved' })
      .where(and(eq(restoreRequests.id, id), eq(restoreRequests.status, 'awaiting_approval')))
      .returning();
    if (!row) throw errors.invalidState('Wiederherstellungsanfrage nicht mehr offen.');
    await ctx.queue.enqueue(
      'backups',
      'restore.run',
      { restoreRequestId: id },
      { jobId: `restore-${id}`, attempts: 1 },
    );
    return { queued: true };
  },
});

export async function listRestoreRequests(db: DbExecutor, limit = 50) {
  return db.select().from(restoreRequests).orderBy(desc(restoreRequests.createdAt)).limit(limit);
}

export async function updateRestoreRequest(
  db: DbExecutor,
  id: string,
  status: string,
  preview?: Record<string, unknown>,
) {
  await db
    .update(restoreRequests)
    .set({ status, ...(preview ? { preview } : {}) })
    .where(eq(restoreRequests.id, id));
}
