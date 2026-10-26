import { z } from 'zod';
import {
  and,
  apiKeys,
  desc,
  eq,
  gameEvents,
  gameServers,
  isNull,
  lt,
  playSessions,
  requestNonces,
  robloxUsers,
  sql,
  type DbExecutor,
} from '@enrp/database';
import { AppError, errors } from '@enrp/shared';
import { type Actor, type RobloxServerActor, actorId, requirePermission } from '../actor';
import { writeAudit } from '../audit';
import { type CoreContext, type TxContext } from '../context';
import { randomToken, safeEqual, sha256Hex } from '../crypto';
import { isFlagEnabled } from '../flags';
import { isUniqueViolation } from '../util';
import { confirmRedemptionDelivered, currentMaintenance, inGameAnnouncements, redeemCode } from './community';
import { endActiveDuty, endDuty, startDuty } from './duty';
import { getActiveMembership } from './factions';
import { activeRobloxBan, pendingRobloxSanctions } from './moderation';
import { upsertRobloxUser } from './verification';
import { vehiclesForPlayer } from './vehicles';

// ---------------------------------------------------------------------------
// API-Schlüssel der Spielserver
// ---------------------------------------------------------------------------

const KEY_PREFIX = 'enrp_rbx_';

export async function createRobloxApiKey(ctx: CoreContext, actor: Actor, input: { name: string; allowedPlaceIds?: string[] }, reason: string) {
  requirePermission(actor, 'roblox_servers:configure');
  const secret = `${KEY_PREFIX}${randomToken(32)}`;
  const row = await ctx.db.transaction(async (tx) => {
    const [created] = await tx
      .insert(apiKeys)
      .values({
        name: input.name,
        kind: 'roblox_server',
        prefix: secret.slice(0, KEY_PREFIX.length + 6),
        keyHash: sha256Hex(secret),
        allowedPlaceIds: input.allowedPlaceIds?.length ? input.allowedPlaceIds : null,
        createdBy: actorId(actor),
      })
      .returning();
    await writeAudit(tx, actor, { action: 'roblox_key.create', resourceType: 'api_key', resourceId: created!.id, reason, after: { name: input.name, prefix: created!.prefix } }, ctx.now());
    return created!;
  });
  return { id: row.id, name: row.name, prefix: row.prefix, key: secret };
}

export async function revokeRobloxApiKey(ctx: CoreContext, actor: Actor, id: string, reason: string) {
  requirePermission(actor, 'roblox_servers:configure');
  const [row] = await ctx.db
    .update(apiKeys)
    .set({ revokedAt: ctx.now(), revokedBy: actorId(actor) })
    .where(and(eq(apiKeys.id, id), isNull(apiKeys.revokedAt)))
    .returning();
  if (!row) throw errors.notFound('Aktiver API-Schlüssel');
  await writeAudit(ctx.db, actor, { action: 'roblox_key.revoke', resourceType: 'api_key', resourceId: id, reason }, ctx.now());
  return { id: row.id, revokedAt: row.revokedAt };
}

export async function listRobloxApiKeys(db: DbExecutor) {
  return db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      prefix: apiKeys.prefix,
      allowedPlaceIds: apiKeys.allowedPlaceIds,
      createdBy: apiKeys.createdBy,
      createdAt: apiKeys.createdAt,
      lastUsedAt: apiKeys.lastUsedAt,
      revokedAt: apiKeys.revokedAt,
    })
    .from(apiKeys)
    .orderBy(desc(apiKeys.createdAt));
}

export const REQUEST_MAX_SKEW_SECONDS = 300;

/**
 * Authentifiziert eine Spielserver-Anfrage: Bearer-Schlüssel (aus dem Roblox Secrets Store),
 * Zeitstempel innerhalb ±5 Minuten und einmalige Nonce (Replay-Schutz).
 */
export async function authenticateRobloxRequest(
  db: DbExecutor,
  input: { bearer?: string; timestamp?: string; nonce?: string; placeId?: string | null },
  now: Date,
): Promise<{ apiKeyId: string }> {
  if (!input.bearer?.startsWith(KEY_PREFIX)) throw new AppError('UNAUTHENTICATED', 'Ungültiger oder fehlender API-Schlüssel.');
  const [key] = await db.select().from(apiKeys).where(eq(apiKeys.keyHash, sha256Hex(input.bearer)));
  if (!key || key.revokedAt || !safeEqual(key.keyHash, sha256Hex(input.bearer))) throw new AppError('UNAUTHENTICATED', 'Ungültiger oder widerrufener API-Schlüssel.');
  const ts = Number(input.timestamp);
  if (!Number.isFinite(ts) || Math.abs(now.getTime() / 1000 - ts) > REQUEST_MAX_SKEW_SECONDS) {
    throw new AppError('INVALID_SIGNATURE', 'Zeitstempel fehlt oder liegt außerhalb des erlaubten Zeitfensters.');
  }
  if (!input.nonce || !/^[\w{}-]{16,64}$/.test(input.nonce)) throw new AppError('INVALID_SIGNATURE', 'Nonce fehlt oder ist ungültig.');
  if (key.allowedPlaceIds?.length && (!input.placeId || !key.allowedPlaceIds.includes(input.placeId))) {
    throw errors.forbidden('Dieser API-Schlüssel ist für diesen Place nicht freigegeben.');
  }
  try {
    await db.insert(requestNonces).values({ nonce: `${key.id}:${input.nonce}`, apiKeyId: key.id, receivedAt: now });
  } catch (err) {
    if (isUniqueViolation(err)) throw new AppError('REPLAY_DETECTED', 'Diese Anfrage wurde bereits verarbeitet (Nonce wiederverwendet).');
    throw err;
  }
  await db.update(apiKeys).set({ lastUsedAt: now }).where(and(eq(apiKeys.id, key.id), sql`(${apiKeys.lastUsedAt} is null or ${apiKeys.lastUsedAt} < ${new Date(now.getTime() - 60_000)})`));
  return { apiKeyId: key.id };
}

// ---------------------------------------------------------------------------
// Heartbeat & Serverstatus
// ---------------------------------------------------------------------------

export const heartbeatSchema = z.object({
  jobId: z.string().min(1).max(100),
  placeId: z.string().regex(/^\d{1,20}$/),
  placeVersion: z.number().int().nonnegative().optional(),
  maxPlayers: z.number().int().min(0).max(1000).optional(),
  players: z
    .array(z.object({ userId: z.number().int().positive(), username: z.string().min(1).max(40), displayName: z.string().max(60).optional() }))
    .max(200),
  /** Zeitpunkt der letzten verarbeiteten Ankündigung (ISO), damit nur neue geliefert werden. */
  announcementsSince: z.iso.datetime().optional(),
});
export type HeartbeatInput = z.infer<typeof heartbeatSchema>;

export async function getServerByJobId(db: DbExecutor, jobId: string) {
  const [row] = await db.select().from(gameServers).where(eq(gameServers.jobId, jobId));
  return row ?? null;
}

/**
 * Heartbeat eines Spielservers: aktualisiert Status und Spielerliste, gleicht Spiel- und Dienstsessions ab
 * und liefert Steuerinformationen (Wartung, Kill-Switch, Ankündigungen, ausstehende Sanktionen) zurück.
 */
export async function processHeartbeat(ctx: CoreContext, actor: RobloxServerActor, input: HeartbeatInput) {
  const now = ctx.now();
  const result = await ctx.db.transaction(async (tx) => {
    const [server] = await tx
      .insert(gameServers)
      .values({
        jobId: input.jobId,
        placeId: input.placeId,
        placeVersion: input.placeVersion ?? null,
        apiKeyId: actor.apiKeyId,
        playerCount: input.players.length,
        maxPlayers: input.maxPlayers ?? null,
        status: 'online',
        startedAt: now,
        lastHeartbeatAt: now,
      })
      .onConflictDoUpdate({
        target: gameServers.jobId,
        set: { playerCount: input.players.length, maxPlayers: input.maxPlayers ?? null, placeVersion: input.placeVersion ?? null, status: 'online', lastHeartbeatAt: now, endedAt: null },
      })
      .returning();
    const txCtx: TxContext = { ...ctx, db: tx };
    const present = new Set(input.players.map((p) => p.userId));
    for (const p of input.players) {
      await upsertRobloxUser(tx, { id: p.userId, username: p.username, displayName: p.displayName }, now);
      await tx.update(robloxUsers).set({ lastSeenAt: now }).where(eq(robloxUsers.id, p.userId));
      await openPlaySession(tx, p.userId, server!.id, now);
    }
    // Spieler, die laut Heartbeat nicht mehr auf dem Server sind: Sessions schließen.
    const open = await tx
      .select({ robloxUserId: playSessions.robloxUserId })
      .from(playSessions)
      .where(and(eq(playSessions.serverId, server!.id), isNull(playSessions.leftAt)));
    for (const s of open.filter((o) => !present.has(o.robloxUserId))) {
      await closePlaySession(tx, s.robloxUserId, now);
      await endActiveDuty(txCtx, s.robloxUserId, 'player_missing', now);
    }
    return server!;
  });
  ctx.realtime.publish('servers', 'server.heartbeat', { jobId: input.jobId, playerCount: input.players.length });
  const since = input.announcementsSince ? new Date(input.announcementsSince) : new Date(now.getTime() - 5 * 60_000);
  const maintenance = await currentMaintenance(ctx.db, now);
  return {
    serverId: result.id,
    serverTime: now.toISOString(),
    killSwitch: await isFlagEnabled(ctx.db, 'kill_switch'),
    maintenance: { active: maintenance.active, message: maintenance.window?.message ?? null },
    dutyTracking: await isFlagEnabled(ctx.db, 'duty_tracking'),
    announcements: await inGameAnnouncements(ctx.db, since),
    sanctions: await pendingRobloxSanctions(ctx.db),
  };
}

async function openPlaySession(db: DbExecutor, robloxUserId: number, serverId: string, now: Date) {
  const [existing] = await db.select().from(playSessions).where(and(eq(playSessions.robloxUserId, robloxUserId), isNull(playSessions.leftAt)));
  if (existing?.serverId === serverId) return;
  if (existing) await closePlaySession(db, robloxUserId, now);
  await db.insert(playSessions).values({ robloxUserId, serverId, joinedAt: now }).onConflictDoNothing();
  await db.update(robloxUsers).set({ firstSeenAt: sql`coalesce(${robloxUsers.firstSeenAt}, ${now})`, lastSeenAt: now }).where(eq(robloxUsers.id, robloxUserId));
}

async function closePlaySession(db: DbExecutor, robloxUserId: number, now: Date) {
  const [closed] = await db
    .update(playSessions)
    .set({ leftAt: now, durationSeconds: sql`greatest(0, extract(epoch from (${now}::timestamptz - ${playSessions.joinedAt}))::int)` })
    .where(and(eq(playSessions.robloxUserId, robloxUserId), isNull(playSessions.leftAt)))
    .returning();
  if (closed?.durationSeconds) {
    await db
      .update(robloxUsers)
      .set({ totalPlaytimeSeconds: sql`${robloxUsers.totalPlaytimeSeconds} + ${closed.durationSeconds}`, lastSeenAt: now })
      .where(eq(robloxUsers.id, robloxUserId));
  }
  return closed ?? null;
}

/** Server meldet sein Herunterfahren (BindToClose). */
export async function processShutdown(ctx: CoreContext, jobId: string) {
  const now = ctx.now();
  return ctx.db.transaction(async (tx) => {
    const [server] = await tx.update(gameServers).set({ status: 'offline', endedAt: now, playerCount: 0 }).where(eq(gameServers.jobId, jobId)).returning();
    if (!server) return { closed: 0 };
    const open = await tx.select({ robloxUserId: playSessions.robloxUserId }).from(playSessions).where(and(eq(playSessions.serverId, server.id), isNull(playSessions.leftAt)));
    for (const s of open) {
      await closePlaySession(tx, s.robloxUserId, now);
      await endActiveDuty({ ...ctx, db: tx }, s.robloxUserId, 'server_shutdown', now);
    }
    return { closed: open.length };
  });
}

/** Worker: Server ohne Heartbeat als offline markieren und deren Spielsessions zum letzten Heartbeat schließen. */
export async function markStaleServers(ctx: CoreContext, timeoutSeconds: number) {
  const cutoff = new Date(ctx.now().getTime() - timeoutSeconds * 1000);
  const stale = await ctx.db.select().from(gameServers).where(and(eq(gameServers.status, 'online'), lt(gameServers.lastHeartbeatAt, cutoff)));
  for (const server of stale) {
    await ctx.db.transaction(async (tx) => {
      await tx.update(gameServers).set({ status: 'offline', endedAt: server.lastHeartbeatAt, playerCount: 0 }).where(eq(gameServers.id, server.id));
      const open = await tx.select({ robloxUserId: playSessions.robloxUserId }).from(playSessions).where(and(eq(playSessions.serverId, server.id), isNull(playSessions.leftAt)));
      for (const s of open) await closePlaySession(tx, s.robloxUserId, server.lastHeartbeatAt);
    });
  }
  if (stale.length) ctx.realtime.publish('servers', 'server.offline', { count: stale.length });
  return stale.length;
}

export async function serverOverview(db: DbExecutor, now: Date, staleSeconds = 180) {
  const online = await db
    .select()
    .from(gameServers)
    .where(and(eq(gameServers.status, 'online'), sql`${gameServers.lastHeartbeatAt} > ${new Date(now.getTime() - staleSeconds * 1000)}`))
    .orderBy(desc(gameServers.lastHeartbeatAt));
  const [last] = await db.select({ at: gameServers.lastHeartbeatAt }).from(gameServers).orderBy(desc(gameServers.lastHeartbeatAt)).limit(1);
  return {
    servers: online,
    playersOnline: online.reduce((sum, s) => sum + s.playerCount, 0),
    lastHeartbeatAt: last?.at ?? null,
    connected: online.length > 0,
  };
}

export async function listServers(db: DbExecutor, limit = 50) {
  return db.select().from(gameServers).orderBy(desc(gameServers.lastHeartbeatAt)).limit(limit);
}

// ---------------------------------------------------------------------------
// Spielereignisse
// ---------------------------------------------------------------------------

const baseEvent = z.object({
  /** Idempotenzschlüssel (GUID), vom Spielserver pro Ereignis erzeugt. */
  id: z.string().regex(/^[\w{}-]{8,64}$/),
  /** Vom Server gemeldeter Zeitpunkt – nur zur Plausibilitätsprüfung. */
  occurredAt: z.iso.datetime().optional(),
});
const playerRef = { userId: z.number().int().positive(), username: z.string().min(1).max(40).optional() };

export const gameEventSchema = z.discriminatedUnion('type', [
  baseEvent.extend({ type: z.literal('player_joined'), data: z.object({ ...playerRef, username: z.string().min(1).max(40), displayName: z.string().max(60).optional() }) }),
  baseEvent.extend({ type: z.literal('player_left'), data: z.object(playerRef) }),
  baseEvent.extend({ type: z.literal('duty_start'), data: z.object({ ...playerRef, faction: z.string().max(40).optional() }) }),
  baseEvent.extend({ type: z.literal('duty_end'), data: z.object(playerRef) }),
  baseEvent.extend({ type: z.literal('redemption_delivered'), data: z.object({ ...playerRef, redemptionId: z.uuid() }) }),
]);
export type GameEvent = z.infer<typeof gameEventSchema>;

export const eventBatchSchema = z.object({
  jobId: z.string().min(1).max(100),
  events: z.array(gameEventSchema).min(1).max(50),
});

export type EventResult = { id: string; status: 'processed' | 'duplicate' | 'rejected' | 'ignored'; result?: unknown; error?: string };

/**
 * Verarbeitet Spielereignisse einzeln und idempotent (eindeutig je API-Schlüssel + Ereignis-ID).
 * Ungültige Ereignisse werden verworfen und protokolliert, ohne den Rest der Charge zu blockieren.
 */
export async function processGameEvents(ctx: CoreContext, actor: RobloxServerActor, batch: z.infer<typeof eventBatchSchema>): Promise<EventResult[]> {
  const server = await getServerByJobId(ctx.db, batch.jobId);
  if (!server || server.apiKeyId !== actor.apiKeyId) {
    throw errors.badRequest('Unbekannter Server. Bitte zuerst einen Heartbeat senden.');
  }
  const killSwitch = await isFlagEnabled(ctx.db, 'kill_switch');
  const dutyTracking = await isFlagEnabled(ctx.db, 'duty_tracking');
  const results: EventResult[] = [];
  for (const event of batch.events) {
    try {
      const outcome = await ctx.db.transaction(async (tx) => {
        const [inserted] = await tx
          .insert(gameEvents)
          .values({ serverId: server.id, apiKeyId: actor.apiKeyId, type: event.type, idempotencyKey: event.id, payload: event, receivedAt: ctx.now() })
          .onConflictDoNothing()
          .returning({ id: gameEvents.id });
        if (!inserted) {
          const [existing] = await tx
            .select({ result: gameEvents.result, status: gameEvents.status })
            .from(gameEvents)
            .where(and(eq(gameEvents.apiKeyId, actor.apiKeyId), eq(gameEvents.idempotencyKey, event.id)));
          return { id: event.id, status: 'duplicate' as const, result: existing?.result };
        }
        let result: unknown;
        let status: EventResult['status'] = 'processed';
        if (killSwitch && event.type !== 'player_left' && event.type !== 'player_joined') {
          status = 'ignored';
          result = { reason: 'kill_switch' };
        } else {
          result = await applyEvent({ ...ctx, db: tx }, server.id, event, dutyTracking);
          if (result && typeof result === 'object' && (result as { status?: string }).status === 'rejected') status = 'rejected';
        }
        await tx.update(gameEvents).set({ result: result as never, status }).where(eq(gameEvents.id, inserted.id));
        return { id: event.id, status, result };
      });
      results.push(outcome);
    } catch (err) {
      ctx.logger.warn({ eventId: event.id, type: event.type, err: (err as Error).message }, 'Spielereignis fehlgeschlagen');
      results.push({ id: event.id, status: 'rejected', error: 'Verarbeitung fehlgeschlagen' });
    }
  }
  return results;
}

async function applyEvent(ctx: TxContext, serverId: string, event: GameEvent, dutyTracking: boolean): Promise<unknown> {
  const now = ctx.now();
  const reportedAt = event.occurredAt ? new Date(event.occurredAt) : null;
  switch (event.type) {
    case 'player_joined':
      await upsertRobloxUser(ctx.db, { id: event.data.userId, username: event.data.username, displayName: event.data.displayName }, now);
      await openPlaySession(ctx.db, event.data.userId, serverId, now);
      return { status: 'ok' };
    case 'player_left': {
      const closed = await closePlaySession(ctx.db, event.data.userId, now);
      const duty = await endActiveDuty(ctx, event.data.userId, 'player_left', now);
      return { status: 'ok', playSeconds: closed?.durationSeconds ?? 0, dutyEnded: Boolean(duty) };
    }
    case 'duty_start':
      if (!dutyTracking) return { status: 'rejected', reason: 'duty_tracking_disabled' };
      return startDuty(ctx, { robloxUserId: event.data.userId, factionKey: event.data.faction, serverId, reportedAt });
    case 'duty_end':
      if (!dutyTracking) return { status: 'rejected', reason: 'duty_tracking_disabled' };
      return endDuty(ctx, { robloxUserId: event.data.userId, reportedAt });
    case 'redemption_delivered':
      return { status: (await confirmRedemptionDelivered(ctx.db, event.data.redemptionId, event.data.userId, now)) ? 'ok' : 'unknown_redemption' };
  }
}

/** Beim Betreten: Bann-Prüfung, Fraktion, Dienststatus und erlaubte Fahrzeuge (serverseitig maßgeblich). */
export async function playerAccess(ctx: CoreContext, robloxUserId: number) {
  const now = ctx.now();
  const ban = await activeRobloxBan(ctx.db, robloxUserId, now);
  const membership = await getActiveMembership(ctx.db, robloxUserId);
  return {
    allowed: !ban,
    ban: ban ? { reason: ban.reason, expiresAt: ban.expiresAt, number: ban.number } : null,
    faction: membership ? { key: membership.faction.key, name: membership.faction.name, hasDuty: membership.faction.hasDuty } : null,
    vehicles: await vehiclesForPlayer(ctx.db, robloxUserId, membership?.faction.id ?? null),
  };
}

export const redeemSchema = z.object({
  jobId: z.string().min(1).max(100),
  userId: z.number().int().positive(),
  code: z.string().min(1).max(64),
});

export async function redeemFromGame(ctx: CoreContext, actor: RobloxServerActor, input: z.infer<typeof redeemSchema>, idempotencyKey: string) {
  const server = await getServerByJobId(ctx.db, input.jobId);
  if (!server || server.apiKeyId !== actor.apiKeyId) throw errors.badRequest('Unbekannter Server.');
  return redeemCode(ctx, { code: input.code, robloxUserId: input.userId, idempotencyKey: `${actor.apiKeyId}:${idempotencyKey}`, serverId: server.id });
}

export async function recentGameEvents(db: DbExecutor, filter: { type?: string; status?: string; limit?: number }) {
  return db
    .select()
    .from(gameEvents)
    .where(and(filter.type ? eq(gameEvents.type, filter.type) : undefined, filter.status ? eq(gameEvents.status, filter.status) : undefined))
    .orderBy(desc(gameEvents.receivedAt))
    .limit(Math.min(filter.limit ?? 100, 500));
}

