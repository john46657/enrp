import { z } from 'zod';
import { and, bolos, desc, eq, inArray, isNull, lt, or, robloxUsers, sql, type DbExecutor } from '@enrp/database';
import { errors } from '@enrp/shared';
import { type Actor, actorId, requirePermission } from '../actor';
import { writeAudit } from '../audit';
import { type CoreContext } from '../context';
import { getSetting } from '../settings';
import { guildForServer } from './guilds';
import { queuePlayerMessage } from './game';
import { type LiveState, normalizePlate, onlineServers } from './live';
import { addRecordEvent, listRecordEvents } from './support';

/**
 * Fahndungen (BOLO – „be on the lookout“): gesuchtes Fahrzeug über das Kennzeichen oder gesuchte Person über die
 * Roblox-ID. Jeder Heartbeat eines Spielservers wird gegen die aktiven Fahndungen geprüft. Ein Treffer erscheint
 * live im Dashboard, im Verlauf der Fahndung und im Leitstellen-Kanal (mit Rollen-Ping) – je Fahndung höchstens
 * alle 10 Minuten.
 */

export const BOLO_HIT_COOLDOWN_SECONDS = 600;

type Bolo = typeof bolos.$inferSelect;

export const createBoloSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('vehicle'),
    plate: z.string().trim().min(2).max(16),
    description: z.string().trim().max(500).optional(),
    reason: z.string().trim().min(3).max(300),
  }),
  z.object({
    kind: z.literal('person'),
    robloxUserId: z.number().int().positive(),
    description: z.string().trim().max(500).optional(),
    reason: z.string().trim().min(3).max(300),
  }),
]);

export async function getBolo(db: DbExecutor, idOrNumber: string) {
  const isNumber = /^\d+$/.test(idOrNumber);
  if (!isNumber && !/^[0-9a-f-]{36}$/i.test(idOrNumber)) throw errors.notFound('Fahndung');
  const [row] = await db
    .select()
    .from(bolos)
    .where(isNumber ? eq(bolos.number, Number(idOrNumber)) : eq(bolos.id, idOrNumber));
  if (!row) throw errors.notFound('Fahndung');
  return row;
}

function publish(ctx: CoreContext, type: string, bolo: Bolo, extra: Record<string, unknown> = {}) {
  ctx.realtime.publish('dispatch', type, { id: bolo.id, number: bolo.number, kind: bolo.kind, ...extra });
}

async function postDiscord(ctx: CoreContext, job: 'bolo.post' | 'bolo.hit', boloId: string) {
  const settings = await getSetting(ctx.db, 'dispatch');
  if (settings.channelId) await ctx.queue.enqueue('discord', job, { boloId });
}

export async function createBolo(ctx: CoreContext, actor: Actor, input: z.infer<typeof createBoloSchema>) {
  requirePermission(actor, 'dispatch:create');
  const now = ctx.now();
  const plate = input.kind === 'vehicle' ? normalizePlate(input.plate) : null;
  if (input.kind === 'vehicle' && plate!.length < 2) throw errors.badRequest('Ungültiges Kennzeichen.');
  const robloxUserId = input.kind === 'person' ? input.robloxUserId : null;
  const [existing] = await ctx.db
    .select()
    .from(bolos)
    .where(and(eq(bolos.status, 'active'), plate ? eq(bolos.plate, plate) : eq(bolos.robloxUserId, robloxUserId!)));
  if (existing) throw errors.badRequest(`Dafür gibt es schon die aktive Fahndung #${existing.number}.`);
  const bolo = await ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .insert(bolos)
      .values({
        kind: input.kind,
        plate,
        robloxUserId,
        description: input.description ?? '',
        reason: input.reason,
        createdBy: actorId(actor),
        createdAt: now,
      })
      .returning();
    await addRecordEvent(tx, {
      recordType: 'bolo',
      recordId: row!.id,
      type: 'created',
      actorId: actorId(actor),
      body: input.reason,
      at: now,
    });
    await writeAudit(
      tx,
      actor,
      {
        action: 'bolo.create',
        resourceType: 'bolo',
        resourceId: row!.id,
        reason: input.reason,
        after: { number: row!.number, kind: row!.kind, plate, robloxUserId },
      },
      now,
    );
    return row!;
  });
  publish(ctx, 'bolo.created', bolo);
  await postDiscord(ctx, 'bolo.post', bolo.id);
  // Sofort gegen die aktuelle Live-Lage prüfen – der Gesuchte könnte schon online sein.
  for (const { server, live } of await onlineServers(ctx.db, now)) {
    await checkBolos(ctx, server.id, live, [bolo]);
  }
  return getBolo(ctx.db, bolo.id);
}

export async function clearBolo(ctx: CoreContext, actor: Actor, idOrNumber: string, note?: string) {
  requirePermission(actor, 'dispatch:edit');
  const now = ctx.now();
  const current = await getBolo(ctx.db, idOrNumber);
  const bolo = await ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .update(bolos)
      .set({ status: 'cleared', clearedBy: actorId(actor), clearedAt: now })
      .where(and(eq(bolos.id, current.id), eq(bolos.status, 'active')))
      .returning();
    if (!row) throw errors.badRequest('Die Fahndung ist bereits aufgehoben.');
    await addRecordEvent(tx, {
      recordType: 'bolo',
      recordId: row.id,
      type: 'cleared',
      actorId: actorId(actor),
      body: note ?? null,
      at: now,
    });
    await writeAudit(
      tx,
      actor,
      { action: 'bolo.clear', resourceType: 'bolo', resourceId: row.id, reason: note, after: { status: 'cleared' } },
      now,
    );
    return row;
  });
  publish(ctx, 'bolo.cleared', bolo);
  return bolo;
}

export async function listBolos(
  db: DbExecutor,
  actor: Actor,
  filter: { status?: string[]; page: number; pageSize: number },
) {
  requirePermission(actor, 'dispatch:view');
  const where = filter.status?.length ? inArray(bolos.status, filter.status as never[]) : undefined;
  const rows = await db
    .select({ bolo: bolos, username: robloxUsers.username })
    .from(bolos)
    .leftJoin(robloxUsers, eq(robloxUsers.id, bolos.robloxUserId))
    .where(where)
    .orderBy(sql`case when ${bolos.status} = 'active' then 0 else 1 end`, desc(bolos.createdAt))
    .limit(filter.pageSize)
    .offset((filter.page - 1) * filter.pageSize);
  const [total] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(bolos)
    .where(where);
  return {
    items: rows.map((r) => ({ ...r.bolo, username: r.username })),
    total: total?.count ?? 0,
    page: filter.page,
    pageSize: filter.pageSize,
  };
}

export async function getBoloDetail(ctx: CoreContext, actor: Actor, idOrNumber: string) {
  requirePermission(actor, 'dispatch:view');
  const bolo = await getBolo(ctx.db, idOrNumber);
  const [user] = bolo.robloxUserId
    ? await ctx.db.select().from(robloxUsers).where(eq(robloxUsers.id, bolo.robloxUserId))
    : [];
  return {
    bolo: { ...bolo, username: user?.username ?? null },
    events: await listRecordEvents(ctx.db, 'bolo', bolo.id, true),
  };
}

/** Spieler der Polizei-Teams auf demselben Server im Spiel warnen (abschaltbar, höchstens 30 Nachrichten). */
async function alertPolice(ctx: CoreContext, serverId: string, live: LiveState, bolo: Bolo, summary: string) {
  const settings = await getSetting(ctx.db, 'dispatch');
  if (!settings.boloIngameAlert) return;
  const teams = new Set(settings.policeTeams.map((t) => t.toLowerCase()));
  const officers = live.players.filter((p) => p.team && teams.has(p.team.toLowerCase())).slice(0, 30);
  const what = bolo.kind === 'vehicle' ? `Kennzeichen ${bolo.plate}` : 'Gesuchte Person';
  for (const officer of officers) {
    await queuePlayerMessage(
      ctx.db,
      {
        serverId,
        robloxUserId: officer.userId,
        message: `🚨 Fahndung #${bolo.number}: ${what} auf diesem Server gesichtet – ${summary}. Grund: ${bolo.reason}`,
        reason: `Fahndungsalarm #${bolo.number}`,
        createdBy: 'system:bolo',
      },
      ctx.now(),
    );
  }
}

/** Was im Live-Zustand eines Servers auf die Fahndung passt (oder null). */
function matchBolo(bolo: Bolo, live: LiveState) {
  if (bolo.kind === 'vehicle' && bolo.plate) {
    const vehicle = live.vehicles.find((v) => normalizePlate(v.plate) === bolo.plate);
    if (!vehicle) return null;
    const owner = vehicle.ownerId ? live.players.find((p) => p.userId === vehicle.ownerId) : undefined;
    return {
      plate: vehicle.plate ?? bolo.plate,
      model: vehicle.model,
      color: vehicle.color ?? null,
      ownerId: vehicle.ownerId ?? null,
      ownerName: owner?.username ?? null,
    };
  }
  if (bolo.kind === 'person' && bolo.robloxUserId) {
    const player = live.players.find((p) => p.userId === bolo.robloxUserId);
    if (!player) return null;
    return { username: player.username, team: player.team ?? null, callsign: player.callsign ?? null };
  }
  return null;
}

/**
 * Prüft den Live-Zustand eines Servers gegen aktive Fahndungen (nach jedem Heartbeat). Die bedingte Aktualisierung
 * sorgt dafür, dass parallel eintreffende Heartbeats denselben Treffer nicht doppelt melden.
 */
export async function checkBolos(ctx: CoreContext, serverId: string, live: LiveState, only?: Bolo[]) {
  const active = only ?? (await ctx.db.select().from(bolos).where(eq(bolos.status, 'active')));
  if (!active.length) return [];
  const now = ctx.now();
  const cooldownStart = new Date(now.getTime() - BOLO_HIT_COOLDOWN_SECONDS * 1000);
  const hits: Bolo[] = [];
  for (const bolo of active) {
    const match = matchBolo(bolo, live);
    if (!match) continue;
    const hit = { ...match, serverId, at: now.toISOString() };
    const [row] = await ctx.db
      .update(bolos)
      .set({
        hitCount: sql`${bolos.hitCount} + 1`,
        lastHitAt: now,
        lastHitServerId: serverId,
        lastHit: hit,
      })
      .where(
        and(
          eq(bolos.id, bolo.id),
          eq(bolos.status, 'active'),
          or(isNull(bolos.lastHitAt), lt(bolos.lastHitAt, cooldownStart)),
        ),
      )
      .returning();
    if (!row) continue;
    const summary =
      'model' in match
        ? `${match.model}${match.color ? ` (${match.color})` : ''}${match.ownerName ? ` · Besitzer ${match.ownerName}` : ''}`
        : `${match.username}${match.team ? ` · Team ${match.team}` : ''}`;
    await addRecordEvent(ctx.db, {
      recordType: 'bolo',
      recordId: row.id,
      type: 'hit',
      actorId: 'system',
      body: `Treffer im Spiel: ${summary}`,
      data: hit,
      at: now,
    });
    publish(ctx, 'bolo.hit', row, { hit });
    await postDiscord(ctx, 'bolo.hit', row.id);
    // Treffer auf einem Privat-Server mit eigenem Discord: zusätzlich dort melden
    const guild = await guildForServer(ctx.db, serverId);
    if (guild?.channels.dispatchChannelId)
      await ctx.queue.enqueue('discord', 'bolo.hit', {
        boloId: row.id,
        channelId: guild.channels.dispatchChannelId,
        pingRoleId: guild.channels.dispatchPingRoleId ?? null,
      });
    await alertPolice(ctx, serverId, live, row, summary);
    hits.push(row);
  }
  return hits;
}
