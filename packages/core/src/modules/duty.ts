import {
  and,
  desc,
  dutyCorrections,
  dutySessions,
  eq,
  factions,
  gameServers,
  inArray,
  lt,
  robloxUsers,
  sql,
  type DbExecutor,
} from '@enrp/database';
import { errors } from '@enrp/shared';
import { type Actor, actorId, requirePermission } from '../actor';
import { writeAudit } from '../audit';
import { type CoreContext, type TxContext } from '../context';
import { getSetting } from '../settings';
import { getActiveMembership } from './factions';

export type DutyStartResult =
  | { status: 'started'; sessionId: string; flags: string[] }
  | { status: 'already_on_duty'; sessionId: string }
  | { status: 'rejected'; reason: 'not_member' | 'faction_without_duty' | 'faction_mismatch' | 'unknown_player' };

export type DutyEndResult = { status: 'ended'; sessionId: string; durationSeconds: number } | { status: 'not_on_duty' };

/** Drizzle expandiert JS-Arrays zu Parameterlisten – daher explizit als ARRAY[...] bauen. */
function textArray(values: string[]) {
  return sql`array[${sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  )}]::text[]`;
}

function secondsBetween(a: Date, b: Date): number {
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 1000));
}

export async function getActiveDuty(db: DbExecutor, robloxUserId: number) {
  const [row] = await db
    .select({ session: dutySessions, faction: { id: factions.id, key: factions.key, name: factions.name } })
    .from(dutySessions)
    .innerJoin(factions, eq(factions.id, dutySessions.factionId))
    .where(and(eq(dutySessions.robloxUserId, robloxUserId), eq(dutySessions.status, 'active')));
  return row ?? null;
}

/**
 * Dienstbeginn (vom Roblox-Server gemeldet). Maßgeblich sind Fraktionszugehörigkeit laut Backend und die
 * Serverzeit des Backends. Ein abweichender, vom Spiel gemeldeter Zeitpunkt wird nur als Auffälligkeit markiert.
 */
export async function startDuty(
  ctx: TxContext,
  input: { robloxUserId: number; factionKey?: string; serverId?: string | null; reportedAt?: Date | null },
): Promise<DutyStartResult> {
  const now = ctx.now();
  const settings = await getSetting(ctx.db, 'duty');
  await ctx.db.execute(sql`select pg_advisory_xact_lock(hashtext(${`duty:${input.robloxUserId}`}))`);
  const [player] = await ctx.db.select({ id: robloxUsers.id }).from(robloxUsers).where(eq(robloxUsers.id, input.robloxUserId));
  if (!player) return { status: 'rejected', reason: 'unknown_player' };
  const membership = await getActiveMembership(ctx.db, input.robloxUserId);
  if (!membership) return { status: 'rejected', reason: 'not_member' };
  if (!membership.faction.hasDuty) return { status: 'rejected', reason: 'faction_without_duty' };
  if (input.factionKey && input.factionKey !== membership.faction.key) return { status: 'rejected', reason: 'faction_mismatch' };

  const flags: string[] = [];
  if (input.reportedAt && Math.abs(input.reportedAt.getTime() - now.getTime()) > settings.clockSkewToleranceSeconds * 1000) {
    flags.push('clock_skew');
  }
  const active = await getActiveDuty(ctx.db, input.robloxUserId);
  if (active) {
    if (active.faction.id === membership.faction.id && active.session.serverId === (input.serverId ?? null)) {
      return { status: 'already_on_duty', sessionId: active.session.id };
    }
    // Doppelte Session (z. B. Serverwechsel ohne Dienstende): alte Session schließen und markieren.
    await closeSession(ctx.db, active.session.id, now, 'auto_closed', 'superseded', ['double_start']);
    flags.push('previous_session_closed');
  }
  const [session] = await ctx.db
    .insert(dutySessions)
    .values({ robloxUserId: input.robloxUserId, factionId: membership.faction.id, serverId: input.serverId ?? null, startedAt: now, flags })
    .returning();
  return { status: 'started', sessionId: session!.id, flags };
}

async function closeSession(
  db: DbExecutor,
  sessionId: string,
  endedAt: Date,
  status: 'completed' | 'auto_closed',
  endReason: string,
  extraFlags: string[] = [],
) {
  const [row] = await db
    .update(dutySessions)
    .set({
      status,
      endedAt: sql`greatest(${endedAt}::timestamptz, ${dutySessions.startedAt})`,
      durationSeconds: sql`extract(epoch from (greatest(${endedAt}::timestamptz, ${dutySessions.startedAt}) - ${dutySessions.startedAt}))::int`,
      endReason,
      flags: extraFlags.length ? sql`array_cat(${dutySessions.flags}, ${textArray(extraFlags)})` : undefined,
    })
    .where(and(eq(dutySessions.id, sessionId), eq(dutySessions.status, 'active')))
    .returning();
  return row ?? null;
}

export async function endDuty(ctx: TxContext, input: { robloxUserId: number; reportedAt?: Date | null; reason?: string }): Promise<DutyEndResult> {
  const now = ctx.now();
  await ctx.db.execute(sql`select pg_advisory_xact_lock(hashtext(${`duty:${input.robloxUserId}`}))`);
  const active = await getActiveDuty(ctx.db, input.robloxUserId);
  if (!active) return { status: 'not_on_duty' };
  const settings = await getSetting(ctx.db, 'duty');
  const flags =
    input.reportedAt && Math.abs(input.reportedAt.getTime() - now.getTime()) > settings.clockSkewToleranceSeconds * 1000 ? ['clock_skew'] : [];
  const row = await closeSession(ctx.db, active.session.id, now, 'completed', input.reason ?? 'ended', flags);
  return { status: 'ended', sessionId: active.session.id, durationSeconds: row?.durationSeconds ?? secondsBetween(active.session.startedAt, now) };
}

/** Beendet eine laufende Session ohne Spielereignis (Fraktionswechsel, Spieler verlässt Server …). */
export async function endActiveDuty(ctx: TxContext, robloxUserId: number, reason: string, at?: Date) {
  const active = await getActiveDuty(ctx.db, robloxUserId);
  if (!active) return null;
  return closeSession(ctx.db, active.session.id, at ?? ctx.now(), 'auto_closed', reason, [reason]);
}

/**
 * Worker: schließt Sessions auf Servern ohne Heartbeat (Ende = letzter Heartbeat) und
 * Sessions, die die Höchstdauer überschreiten (Ende = Beginn + Höchstdauer).
 */
export async function closeStaleDutySessions(ctx: CoreContext): Promise<{ serverTimeout: number; maxDuration: number }> {
  const now = ctx.now();
  const settings = await getSetting(ctx.db, 'duty');
  const staleBefore = new Date(now.getTime() - settings.serverTimeoutSeconds * 1000);
  let serverTimeout = 0;
  let maxDuration = 0;
  await ctx.db.transaction(async (tx) => {
    const stale = await tx
      .select({ id: dutySessions.id, lastHeartbeatAt: gameServers.lastHeartbeatAt })
      .from(dutySessions)
      .innerJoin(gameServers, eq(gameServers.id, dutySessions.serverId))
      .where(and(eq(dutySessions.status, 'active'), lt(gameServers.lastHeartbeatAt, staleBefore)));
    for (const s of stale) {
      if (await closeSession(tx, s.id, s.lastHeartbeatAt, 'auto_closed', 'server_timeout', ['server_timeout'])) serverTimeout++;
    }
    const tooLong = await tx
      .select({ id: dutySessions.id, startedAt: dutySessions.startedAt })
      .from(dutySessions)
      .where(and(eq(dutySessions.status, 'active'), lt(dutySessions.startedAt, new Date(now.getTime() - settings.maxSessionHours * 3600_000))));
    for (const s of tooLong) {
      const end = new Date(s.startedAt.getTime() + settings.maxSessionHours * 3600_000);
      if (await closeSession(tx, s.id, end, 'auto_closed', 'max_duration', ['max_duration'])) maxDuration++;
    }
  });
  return { serverTimeout, maxDuration };
}

/** Berechtigte Korrektur einer Session mit Pflichtbegründung. */
export async function correctDutySession(
  ctx: CoreContext,
  actor: Actor,
  sessionId: string,
  patch: { startedAt?: Date; endedAt?: Date; invalidate?: boolean },
  reason: string,
) {
  const [session] = await ctx.db.select().from(dutySessions).where(eq(dutySessions.id, sessionId));
  if (!session) throw errors.notFound('Dienstsession');
  requirePermission(actor, 'duty:edit', { factionId: session.factionId });
  if (session.status === 'active' && !patch.invalidate) throw errors.invalidState('Laufende Sessions können nur ungültig gemacht werden.');
  const startedAt = patch.startedAt ?? session.startedAt;
  const endedAt = patch.endedAt ?? session.endedAt;
  if (endedAt && endedAt < startedAt) throw errors.badRequest('Das Ende darf nicht vor dem Beginn liegen.');
  if (endedAt && endedAt > ctx.now()) throw errors.badRequest('Das Ende darf nicht in der Zukunft liegen.');
  const settings = await getSetting(ctx.db, 'duty');
  if (endedAt && secondsBetween(startedAt, endedAt) > settings.maxSessionHours * 3600) {
    throw errors.badRequest(`Eine Session darf höchstens ${settings.maxSessionHours} Stunden dauern.`);
  }
  return ctx.db.transaction(async (tx) => {
    const before = { startedAt: session.startedAt, endedAt: session.endedAt, status: session.status, durationSeconds: session.durationSeconds };
    const after = patch.invalidate
      ? { ...before, status: 'invalidated' as const, endedAt: session.endedAt ?? ctx.now() }
      : { startedAt, endedAt, status: session.status, durationSeconds: endedAt ? secondsBetween(startedAt, endedAt) : null };
    const [row] = await tx
      .update(dutySessions)
      .set({
        startedAt: after.startedAt,
        endedAt: after.endedAt,
        status: after.status,
        durationSeconds: after.endedAt ? secondsBetween(after.startedAt, after.endedAt) : null,
        flags: sql`array_append(${dutySessions.flags}, 'corrected')`,
        endReason: patch.invalidate ? 'invalidated' : session.endReason,
      })
      .where(eq(dutySessions.id, sessionId))
      .returning();
    await tx.insert(dutyCorrections).values({ sessionId, actorId: actorId(actor), reason, before, after });
    await writeAudit(tx, actor, { action: patch.invalidate ? 'duty.invalidate' : 'duty.correct', resourceType: 'duty_session', resourceId: sessionId, reason, before, after }, ctx.now());
    return row!;
  });
}

export interface DutyFilter {
  robloxUserId?: number;
  factionIds?: string[] | 'all';
  since?: Date | null;
}

const effectiveSeconds = (since: Date | null | undefined) => sql`
  sum(extract(epoch from (coalesce(${dutySessions.endedAt}, now()) - greatest(${dutySessions.startedAt}, coalesce(${since ?? null}::timestamptz, ${dutySessions.startedAt})))))`;

function dutyWhere(filter: DutyFilter) {
  return and(
    sql`${dutySessions.status} <> 'invalidated'`,
    filter.robloxUserId ? eq(dutySessions.robloxUserId, filter.robloxUserId) : undefined,
    Array.isArray(filter.factionIds) ? (filter.factionIds.length ? inArray(dutySessions.factionId, filter.factionIds) : sql`false`) : undefined,
    filter.since ? sql`coalesce(${dutySessions.endedAt}, now()) > ${filter.since}` : undefined,
  );
}

/** Dienstzeit gesamt und je Fraktion (laufende Sessions zählen bis jetzt). */
export async function dutyTotals(db: DbExecutor, filter: DutyFilter) {
  const rows = await db
    .select({
      factionId: dutySessions.factionId,
      factionKey: factions.key,
      factionName: factions.name,
      seconds: sql<string>`coalesce(${effectiveSeconds(filter.since)}, 0)::bigint`,
      sessions: sql<number>`count(*)::int`,
    })
    .from(dutySessions)
    .innerJoin(factions, eq(factions.id, dutySessions.factionId))
    .where(dutyWhere(filter))
    .groupBy(dutySessions.factionId, factions.key, factions.name);
  const perFaction = rows.map((r) => ({ ...r, seconds: Number(r.seconds) }));
  return { totalSeconds: perFaction.reduce((a, r) => a + r.seconds, 0), sessions: perFaction.reduce((a, r) => a + r.sessions, 0), perFaction };
}

export async function dutyLeaderboard(db: DbExecutor, filter: DutyFilter & { limit?: number }) {
  const rows = await db
    .select({
      robloxUserId: dutySessions.robloxUserId,
      username: robloxUsers.username,
      seconds: sql<string>`coalesce(${effectiveSeconds(filter.since)}, 0)::bigint`,
    })
    .from(dutySessions)
    .innerJoin(robloxUsers, eq(robloxUsers.id, dutySessions.robloxUserId))
    .where(dutyWhere(filter))
    .groupBy(dutySessions.robloxUserId, robloxUsers.username)
    .orderBy(sql`3 desc`)
    .limit(Math.min(filter.limit ?? 10, 100));
  return rows.map((r, i) => ({ rank: i + 1, ...r, seconds: Number(r.seconds) }));
}

export async function listDutySessions(
  db: DbExecutor,
  filter: DutyFilter & { status?: string; flagged?: boolean; page: number; pageSize: number },
) {
  const where = and(
    filter.robloxUserId ? eq(dutySessions.robloxUserId, filter.robloxUserId) : undefined,
    Array.isArray(filter.factionIds) ? (filter.factionIds.length ? inArray(dutySessions.factionId, filter.factionIds) : sql`false`) : undefined,
    filter.status ? eq(dutySessions.status, filter.status as never) : undefined,
    filter.flagged ? sql`cardinality(${dutySessions.flags}) > 0` : undefined,
    filter.since ? sql`${dutySessions.startedAt} >= ${filter.since}` : undefined,
  );
  const items = await db
    .select({
      id: dutySessions.id,
      robloxUserId: dutySessions.robloxUserId,
      username: robloxUsers.username,
      factionKey: factions.key,
      factionName: factions.name,
      status: dutySessions.status,
      startedAt: dutySessions.startedAt,
      endedAt: dutySessions.endedAt,
      durationSeconds: dutySessions.durationSeconds,
      endReason: dutySessions.endReason,
      flags: dutySessions.flags,
    })
    .from(dutySessions)
    .innerJoin(factions, eq(factions.id, dutySessions.factionId))
    .innerJoin(robloxUsers, eq(robloxUsers.id, dutySessions.robloxUserId))
    .where(where)
    .orderBy(desc(dutySessions.startedAt))
    .limit(filter.pageSize)
    .offset((filter.page - 1) * filter.pageSize);
  const [total] = await db.select({ count: sql<number>`count(*)::int` }).from(dutySessions).where(where);
  return { items, total: total?.count ?? 0, page: filter.page, pageSize: filter.pageSize };
}

export async function listCorrections(db: DbExecutor, sessionId: string) {
  return db.select().from(dutyCorrections).where(eq(dutyCorrections.sessionId, sessionId)).orderBy(desc(dutyCorrections.createdAt));
}

export async function onDutyCounts(db: DbExecutor) {
  return db
    .select({ factionKey: factions.key, count: sql<number>`count(*)::int` })
    .from(dutySessions)
    .innerJoin(factions, eq(factions.id, dutySessions.factionId))
    .where(eq(dutySessions.status, 'active'))
    .groupBy(factions.key);
}
