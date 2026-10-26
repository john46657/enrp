import { and, desc, environments, eq, releases, sql, type DbExecutor } from '@enrp/database';
import { AppError, errors } from '@enrp/shared';
import { type Actor, actorId, requirePermission, requireUser } from '../actor';
import { writeAudit } from '../audit';
import { type CoreContext } from '../context';
import { diffJson } from '../audit';

const VERSION_PATTERN = /^v?\d+\.\d+\.\d+(-[\w.]+)?$/;

export async function listEnvironments(db: DbExecutor) {
  return db.select().from(environments).orderBy(environments.key);
}

export async function getEnvironment(db: DbExecutor, key: string) {
  const [env] = await db.select().from(environments).where(eq(environments.key, key));
  if (!env) throw errors.notFound('Umgebung');
  return env;
}

/**
 * Meldet den Zustand einer Umgebung (Version + nicht geheime Konfiguration). Wird beim Start
 * jeder API-Instanz für die eigene Umgebung aufgerufen.
 */
export async function reportEnvironment(db: DbExecutor, key: string, input: { version: string; url?: string | null; config: Record<string, unknown> }) {
  await db
    .update(environments)
    .set({ currentVersion: input.version, url: input.url ?? undefined, configSnapshot: input.config })
    .where(eq(environments.key, key));
}

export async function compareEnvironments(db: DbExecutor, a: string, b: string) {
  const [envA, envB] = await Promise.all([getEnvironment(db, a), getEnvironment(db, b)]);
  return {
    a: { key: envA.key, version: envA.currentVersion },
    b: { key: envB.key, version: envB.currentVersion },
    versionDiffers: envA.currentVersion !== envB.currentVersion,
    configDiff: diffJson(envA.configSnapshot, envB.configSnapshot),
  };
}

export async function listReleases(db: DbExecutor, filter: { environment?: string; limit?: number }) {
  return db
    .select({ release: releases, environmentKey: environments.key })
    .from(releases)
    .innerJoin(environments, eq(environments.id, releases.environmentId))
    .where(filter.environment ? eq(environments.key, filter.environment) : undefined)
    .orderBy(desc(releases.createdAt))
    .limit(Math.min(filter.limit ?? 25, 100));
}

export async function getRelease(db: DbExecutor, idOrNumber: string) {
  const isNumber = /^\d+$/.test(idOrNumber);
  const [row] = await db
    .select({ release: releases, environmentKey: environments.key, requiresApproval: environments.requiresApproval })
    .from(releases)
    .innerJoin(environments, eq(environments.id, releases.environmentId))
    .where(isNumber ? eq(releases.number, Number(idOrNumber)) : eq(releases.id, idOrNumber));
  if (!row) throw errors.notFound('Release');
  return row;
}

/**
 * Bereitet ein Release vor. Es wird KEIN Befehl ausgeführt: Die Freigabe stößt ausschließlich die
 * konfigurierte CI/CD-Pipeline an (siehe docs/deployment.md).
 */
export async function prepareRelease(
  ctx: CoreContext,
  actor: Actor,
  input: { version: string; environment: string; commitSha?: string | null; notes?: string; kind?: 'deploy' | 'rollback' | 'promote' },
) {
  requirePermission(actor, 'releases:create');
  if (!VERSION_PATTERN.test(input.version)) throw errors.badRequest('Version im Format 1.2.3 angeben.');
  if (input.commitSha && !/^[0-9a-f]{7,40}$/i.test(input.commitSha)) throw errors.badRequest('Ungültiger Commit-Hash.');
  const env = await getEnvironment(ctx.db, input.environment);
  const [pending] = await ctx.db
    .select({ id: releases.id })
    .from(releases)
    .where(and(eq(releases.environmentId, env.id), sql`${releases.status} in ('prepared', 'approved', 'deploying')`));
  if (pending) throw errors.conflict('Für diese Umgebung ist bereits ein Release in Vorbereitung oder im Gange.');
  return ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .insert(releases)
      .values({ version: input.version, environmentId: env.id, kind: input.kind ?? 'deploy', commitSha: input.commitSha ?? null, notes: input.notes ?? '', preparedBy: actorId(actor) })
      .returning();
    await writeAudit(tx, actor, { action: `release.prepare`, resourceType: 'release', resourceId: row!.id, after: { version: row!.version, environment: env.key, kind: row!.kind } }, ctx.now());
    return row!;
  });
}

/**
 * Gibt ein Release frei. Vier-Augen-Prinzip: Wer vorbereitet hat, darf nicht freigeben (auch per DB-Constraint).
 * Danach übernimmt der Worker das Anstoßen der Pipeline.
 */
export async function approveRelease(ctx: CoreContext, actor: Actor, idOrNumber: string, reason: string) {
  const user = requireUser(actor);
  requirePermission(actor, 'releases:approve');
  const { release, environmentKey } = await getRelease(ctx.db, idOrNumber);
  if (release.status !== 'prepared') throw errors.invalidState(`Release ist bereits ${release.status}.`);
  if (release.preparedBy === user.discordUserId) throw new AppError('SELF_ACTION_FORBIDDEN', 'Releases müssen von einer anderen Person freigegeben werden.');
  const row = await ctx.db.transaction(async (tx) => {
    const [updated] = await tx
      .update(releases)
      .set({ status: 'approved', approvedBy: user.discordUserId })
      .where(and(eq(releases.id, release.id), eq(releases.status, 'prepared')))
      .returning();
    if (!updated) throw errors.invalidState('Release wurde parallel geändert.');
    await writeAudit(tx, actor, { action: 'release.approve', resourceType: 'release', resourceId: release.id, reason, metadata: { environment: environmentKey } }, ctx.now());
    return updated;
  });
  await ctx.queue.enqueue('maintenance', 'release.dispatch', { releaseId: row.id }, { jobId: `release-${row.id}` });
  return row;
}

export async function cancelRelease(ctx: CoreContext, actor: Actor, idOrNumber: string, reason: string) {
  requirePermission(actor, 'releases:create');
  const { release } = await getRelease(ctx.db, idOrNumber);
  const [row] = await ctx.db
    .update(releases)
    .set({ status: 'failed', failureReason: `Abgebrochen: ${reason}` })
    .where(and(eq(releases.id, release.id), eq(releases.status, 'prepared')))
    .returning();
  if (!row) throw errors.invalidState('Nur vorbereitete Releases können abgebrochen werden.');
  await writeAudit(ctx.db, actor, { action: 'release.cancel', resourceType: 'release', resourceId: release.id, reason }, ctx.now());
  return row;
}

/** Rückmeldung der Pipeline (über den Worker oder einen authentifizierten Webhook). */
export async function markReleaseResult(ctx: CoreContext, releaseId: string, result: { status: 'deploying' | 'deployed' | 'failed'; pipelineRunUrl?: string; failureReason?: string }) {
  const [row] = await ctx.db
    .update(releases)
    .set({
      status: result.status,
      pipelineRunUrl: result.pipelineRunUrl,
      failureReason: result.failureReason ?? null,
      deployedAt: result.status === 'deployed' ? ctx.now() : undefined,
    })
    .where(eq(releases.id, releaseId))
    .returning();
  if (!row) throw errors.notFound('Release');
  if (result.status === 'deployed') {
    const [env] = await ctx.db.select().from(environments).where(eq(environments.id, row.environmentId));
    if (env) await ctx.db.update(environments).set({ currentVersion: row.version }).where(eq(environments.id, env.id));
    // Rollbacks sind eigene Releases (kind = 'rollback') auf eine frühere Version; die Historie bleibt unverändert.
  }
  await writeAudit(ctx.db, { kind: 'system', name: 'pipeline' }, { action: `release.${result.status}`, resourceType: 'release', resourceId: releaseId, metadata: result }, ctx.now());
  return row;
}
