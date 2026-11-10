import { z } from 'zod';
import {
  and,
  bolos,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  lt,
  or,
  robloxUsers,
  sql,
  type DbExecutor,
} from '@enrp/database';
import { BOLO_STATUS, errors, type BoloStatus } from '@enrp/shared';
import { type Actor, actorId, requirePermission } from '../actor';
import { writeAudit } from '../audit';
import { type CoreContext } from '../context';
import { getSetting } from '../settings';
import { likePattern } from '../util';
import { type LivePlayer, type LiveVehicle, normalizePlate, onlineServers } from './live';

/**
 * Fahndungen (BOLO) nach Personen oder Kennzeichen. Jeder Heartbeat eines Spielservers wird mit den aktiven
 * Fahndungen abgeglichen. Ein Treffer wird gespeichert, live im Dashboard gemeldet und – falls eingerichtet – mit
 * Ping in Discord gepostet; derselbe BOLO meldet sich frühestens nach der Abklingzeit erneut.
 */

type Bolo = typeof bolos.$inferSelect;

export const STATUS_LABEL: Record<BoloStatus, string> = {
  active: 'Aktiv',
  resolved: 'Erledigt',
  expired: 'Abgelaufen',
};

const common = {
  reason: z.string().trim().min(3).max(500),
  priority: z.number().int().min(1).max(3).optional(),
  /** Automatisch beenden nach … Stunden (leer = bis zur Erledigung). */
  expiresInHours: z
    .number()
    .int()
    .min(1)
    .max(24 * 30)
    .optional(),
};

export const createBoloSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('person'),
      robloxUserId: z.number().int().positive().optional(),
      /** Alternativ der Roblox-Benutzername eines bekannten Spielers. */
      username: z.string().trim().min(3).max(20).optional(),
      ...common,
    })
    .refine((v) => v.robloxUserId || v.username, { message: 'Roblox-ID oder Benutzername angeben.' }),
  z.object({
    kind: z.literal('vehicle'),
    plate: z.string().trim().min(2).max(16),
    vehicleDescription: z.string().trim().max(120).optional(),
    ...common,
  }),
]);
export type CreateBoloInput = z.infer<typeof createBoloSchema>;

/** Treffer-Info, wie sie gespeichert und gemeldet wird. */
export interface BoloHit {
  serverId: string;
  jobId: string;
  serverType: string;
  at: string;
  player?: { userId: number; username: string; team: string | null; wanted: number };
  vehicle?: {
    model: string;
    plate: string | null;
    color: string | null;
    ownerId: number | null;
    ownerName: string | null;
  };
}

export async function getBolo(db: DbExecutor, idOrNumber: string) {
  const isNumber = /^\d+$/.test(idOrNumber);
  const isUuid = /^[0-9a-f-]{36}$/i.test(idOrNumber);
  if (!isNumber && !isUuid) throw errors.notFound('Fahndung');
  const [row] = await db
    .select()
    .from(bolos)
    .where(isNumber ? eq(bolos.number, Number(idOrNumber)) : eq(bolos.id, idOrNumber));
  if (!row) throw errors.notFound('Fahndung');
  return row;
}

function publish(ctx: CoreContext, event: string, bolo: Bolo) {
  ctx.realtime.publish('dispatch', event, { id: bolo.id, number: bolo.number, kind: bolo.kind, status: bolo.status });
}

export async function createBolo(ctx: CoreContext, actor: Actor, input: CreateBoloInput) {
  requirePermission(actor, 'dispatch:create');
  const now = ctx.now();
  let person: { id: number; name: string | null } | null = null;
  if (input.kind === 'person') {
    const [known] = await ctx.db
      .select({ id: robloxUsers.id, username: robloxUsers.username })
      .from(robloxUsers)
      .where(
        input.robloxUserId
          ? eq(robloxUsers.id, input.robloxUserId)
          : sql`lower(${robloxUsers.username}) = ${input.username!.toLowerCase()}`,
      );
    if (!known && !input.robloxUserId)
      throw errors.badRequest(
        `Spieler „${input.username}“ ist unbekannt (noch nie im Spiel). Bitte die Roblox-ID angeben.`,
      );
    person = { id: known?.id ?? input.robloxUserId!, name: known?.username ?? input.username ?? null };
  }
  const plateNormalized = input.kind === 'vehicle' ? normalizePlate(input.plate) : null;
  if (input.kind === 'vehicle' && (!plateNormalized || plateNormalized.length < 2))
    throw errors.badRequest('Ungültiges Kennzeichen.');
  const bolo = await ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .insert(bolos)
      .values({
        kind: input.kind,
        robloxUserId: person?.id ?? null,
        personName: person?.name ?? null,
        plate: input.kind === 'vehicle' ? input.plate.toUpperCase() : null,
        plateNormalized,
        vehicleDescription: input.kind === 'vehicle' ? (input.vehicleDescription ?? null) : null,
        reason: input.reason,
        priority: input.priority ?? 2,
        createdBy: actorId(actor),
        expiresAt: input.expiresInHours ? new Date(now.getTime() + input.expiresInHours * 3_600_000) : null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    await writeAudit(
      tx,
      actor,
      {
        action: 'bolo.create',
        resourceType: 'bolo',
        resourceId: row!.id,
        reason: input.reason,
        after: { number: row!.number, kind: row!.kind, robloxUserId: row!.robloxUserId, plate: row!.plate },
      },
      now,
    );
    return row!;
  });
  publish(ctx, 'bolo.created', bolo);
  // Sofort gegen die aktuelle Live-Lage prüfen – nicht erst beim nächsten Heartbeat.
  for (const { server, live } of await onlineServers(ctx.db, now)) {
    await checkBoloHits(ctx, server, live, [bolo]);
  }
  return getBolo(ctx.db, bolo.id);
}

export async function listBolos(
  db: DbExecutor,
  actor: Actor,
  filter: { status?: string[]; kind?: 'person' | 'vehicle'; q?: string; page?: number; pageSize?: number } = {},
) {
  requirePermission(actor, 'dispatch:view');
  const status = (filter.status ?? []).filter((s): s is BoloStatus => (BOLO_STATUS as readonly string[]).includes(s));
  const q = filter.q?.trim();
  const where = and(
    status.length ? inArray(bolos.status, status) : undefined,
    filter.kind ? eq(bolos.kind, filter.kind) : undefined,
    q
      ? or(
          ilike(bolos.personName, likePattern(q)),
          ilike(bolos.plate, likePattern(q)),
          ilike(bolos.reason, likePattern(q)),
          ilike(bolos.vehicleDescription, likePattern(q)),
          /^\d+$/.test(q) ? eq(bolos.robloxUserId, Number(q)) : undefined,
          normalizePlate(q) ? eq(bolos.plateNormalized, normalizePlate(q)) : undefined,
        )
      : undefined,
  );
  const pageSize = Math.min(filter.pageSize ?? 25, 100);
  const page = Math.max(filter.page ?? 1, 1);
  const items = await db
    .select()
    .from(bolos)
    .where(where)
    // Aktive zuerst, dann nach Priorität und Alter
    .orderBy(sql`${bolos.status} <> 'active'`, bolos.priority, desc(bolos.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  const [count] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(bolos)
    .where(where);
  return { items, total: count?.n ?? 0, page, pageSize };
}

export async function resolveBolo(ctx: CoreContext, actor: Actor, idOrNumber: string, note?: string) {
  requirePermission(actor, 'dispatch:edit');
  const bolo = await getBolo(ctx.db, idOrNumber);
  if (bolo.status !== 'active') throw errors.conflict('Die Fahndung ist nicht mehr aktiv.');
  const now = ctx.now();
  const updated = await ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .update(bolos)
      .set({
        status: 'resolved',
        resolvedAt: now,
        resolvedBy: actorId(actor),
        resolveNote: note ?? null,
        updatedAt: now,
      })
      .where(and(eq(bolos.id, bolo.id), eq(bolos.status, 'active')))
      .returning();
    if (!row) throw errors.conflict('Die Fahndung ist nicht mehr aktiv.');
    await writeAudit(
      tx,
      actor,
      {
        action: 'bolo.resolve',
        resourceType: 'bolo',
        resourceId: row.id,
        reason: note ?? null,
        after: { status: 'resolved' },
      },
      now,
    );
    return row;
  });
  publish(ctx, 'bolo.resolved', updated);
  return updated;
}

/** Abgelaufene Fahndungen beenden (läuft bei jedem Abgleich mit). */
async function expireBolos(db: DbExecutor, now: Date) {
  return db
    .update(bolos)
    .set({ status: 'expired', updatedAt: now })
    .where(and(eq(bolos.status, 'active'), lt(bolos.expiresAt, now)))
    .returning({ id: bolos.id });
}

/** Sucht einen Treffer eines BOLO in der Live-Lage eines Servers. */
export function matchBolo(
  bolo: Pick<Bolo, 'kind' | 'robloxUserId' | 'plateNormalized'>,
  live: { players: LivePlayer[]; vehicles: LiveVehicle[] },
): Pick<BoloHit, 'player' | 'vehicle'> | null {
  const playerInfo = (p: LivePlayer) => ({
    userId: p.userId,
    username: p.username,
    team: p.team ?? null,
    wanted: p.wanted ?? 0,
  });
  if (bolo.kind === 'person') {
    const p = live.players.find((x) => x.userId === bolo.robloxUserId);
    return p ? { player: playerInfo(p) } : null;
  }
  const v = live.vehicles.find((x) => x.plate && normalizePlate(x.plate) === bolo.plateNormalized);
  if (!v) return null;
  const owner = v.ownerId ? live.players.find((p) => p.userId === v.ownerId) : undefined;
  return {
    vehicle: {
      model: v.model,
      plate: v.plate ?? null,
      color: v.color ?? null,
      ownerId: v.ownerId ?? null,
      ownerName: owner?.username ?? null,
    },
    ...(owner ? { player: playerInfo(owner) } : {}),
  };
}

/**
 * Gleicht die Live-Lage eines Servers mit den aktiven Fahndungen ab. Wird nach jedem Heartbeat aufgerufen.
 * Ein Treffer zählt nur, wenn der BOLO in der Abklingzeit noch nicht gemeldet wurde (bedingtes Update – auch bei
 * mehreren gleichzeitigen Heartbeats wird jeder Treffer nur einmal gemeldet).
 */
export async function checkBoloHits(
  ctx: CoreContext,
  server: { id: string; jobId: string; serverType: string },
  live: { players: LivePlayer[]; vehicles: LiveVehicle[] },
  only?: Bolo[],
) {
  const now = ctx.now();
  await expireBolos(ctx.db, now);
  const active =
    only ??
    (await ctx.db
      .select()
      .from(bolos)
      .where(and(eq(bolos.status, 'active'), or(isNull(bolos.expiresAt), sql`${bolos.expiresAt} >= ${now}`)))
      .limit(500));
  if (!active.length) return [];
  const { boloHitCooldownMinutes } = await getSetting(ctx.db, 'dispatch');
  const cutoff = new Date(now.getTime() - boloHitCooldownMinutes * 60_000);
  const hits: Bolo[] = [];
  for (const bolo of active) {
    const match = matchBolo(bolo, live);
    if (!match) continue;
    const hit: BoloHit = {
      serverId: server.id,
      jobId: server.jobId,
      serverType: server.serverType,
      at: now.toISOString(),
      ...match,
    };
    const [row] = await ctx.db
      .update(bolos)
      .set({
        hitCount: sql`${bolos.hitCount} + 1`,
        lastHitAt: now,
        lastHitServerId: server.id,
        lastHit: hit,
        updatedAt: now,
      })
      .where(
        and(
          eq(bolos.id, bolo.id),
          eq(bolos.status, 'active'),
          or(isNull(bolos.lastHitAt), lt(bolos.lastHitAt, cutoff)),
        ),
      )
      .returning();
    if (!row) continue;
    hits.push(row);
    publish(ctx, 'bolo.hit', row);
    await ctx.queue.enqueue('discord', 'bolo.hit', { boloId: row.id }, { jobId: `bolo-hit-${row.id}-${row.hitCount}` });
  }
  return hits;
}
