import { z } from 'zod';
import {
  accountLinks,
  and,
  desc,
  eq,
  gameServers,
  inArray,
  privateServers,
  robloxUsers,
  type DbExecutor,
} from '@enrp/database';
import { errors } from '@enrp/shared';
import { type Actor, hasPermission, requireUser } from '../actor';
import { writeAudit } from '../audit';
import { type CoreContext } from '../context';

/**
 * Privat-Server (VIP-Server) des Spiels. Jeder Privat-Server wird beim ersten Heartbeat angelegt (stabil über die
 * Roblox-PrivateServerId). Besitzer und von ihm ernannte Admins haben Spielrechte nur auf ihrem eigenen
 * Privat-Server; im Hauptspiel ändert sich nichts. Die Teamsperre ist eine Extra-Funktion nur für Privat-Server:
 * standardmäßig aus (jeder darf in jedes Team, auch Polizei).
 */

type Row = typeof privateServers.$inferSelect;

export const MAX_ADMINS = 25;
export const DEFAULT_TEAM_FACTIONS: Record<string, string> = {
  Polizei: 'polizei',
  Feuerwehr: 'feuerwehr',
  Rettungsdienst: 'rettungsdienst',
};

/** Beim Heartbeat eines privaten Servers: anlegen bzw. Besitzer und „zuletzt gesehen“ aktualisieren. */
export async function registerPrivateServer(db: DbExecutor, privateServerId: string, ownerRobloxId: number, now: Date) {
  const [row] = await db
    .insert(privateServers)
    .values({ privateServerId, ownerRobloxId, lastSeenAt: now, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({ target: privateServers.privateServerId, set: { ownerRobloxId, lastSeenAt: now } })
    .returning();
  return row!;
}

/** Was der Spielserver für die Teamsperre braucht (Teil der Heartbeat-Antwort). */
export const gameConfig = (row: Row) => ({
  id: row.id,
  name: row.name,
  teamLock: row.teamLock,
  teamFactions: row.teamLock ? row.teamFactions : {},
});

export async function getByPrivateServerId(db: DbExecutor, privateServerId: string) {
  const [row] = await db.select().from(privateServers).where(eq(privateServers.privateServerId, privateServerId));
  return row ?? null;
}

/** Besitzer oder ernannter Admin dieses Privat-Servers? */
export function isPrivateServerStaff(row: Row, robloxUserId: number) {
  return row.ownerRobloxId === robloxUserId || row.admins.includes(robloxUserId);
}

/** Roblox-Konten, die mit der handelnden Discord-Person verknüpft sind. */
async function linkedRobloxIds(db: DbExecutor, actor: Actor) {
  if (actor.kind !== 'user') return [];
  const rows = await db
    .select({ id: accountLinks.robloxUserId })
    .from(accountLinks)
    .where(and(eq(accountLinks.discordUserId, actor.discordUserId), eq(accountLinks.status, 'active')));
  return rows.map((r) => r.id);
}

async function canManage(db: DbExecutor, actor: Actor, row: Row) {
  if (hasPermission(actor, 'roblox_servers:configure')) return true;
  return (await linkedRobloxIds(db, actor)).includes(row.ownerRobloxId);
}

async function withDetails(db: DbExecutor, rows: Row[]) {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.privateServerId);
  const online = await db
    .select({
      privateServerId: gameServers.privateServerId,
      jobId: gameServers.jobId,
      playerCount: gameServers.playerCount,
      maxPlayers: gameServers.maxPlayers,
    })
    .from(gameServers)
    .where(and(inArray(gameServers.privateServerId, ids), eq(gameServers.status, 'online')));
  const userIds = [...new Set(rows.flatMap((r) => [r.ownerRobloxId, ...r.admins]))];
  const users = await db
    .select({ id: robloxUsers.id, username: robloxUsers.username })
    .from(robloxUsers)
    .where(inArray(robloxUsers.id, userIds));
  const name = new Map(users.map((u) => [u.id, u.username]));
  return rows.map((r) => {
    const live = online.find((o) => o.privateServerId === r.privateServerId);
    return {
      ...r,
      ownerName: name.get(r.ownerRobloxId) ?? null,
      adminList: r.admins.map((id) => ({ robloxUserId: id, username: name.get(id) ?? null })),
      online: live ? { jobId: live.jobId, playerCount: live.playerCount, maxPlayers: live.maxPlayers } : null,
    };
  });
}

/** Alle Privat-Server (Team mit roblox_servers:view) bzw. nur die eigenen (Besitzer über die Verknüpfung). */
export async function listPrivateServers(db: DbExecutor, actor: Actor) {
  requireUser(actor);
  const all = hasPermission(actor, 'roblox_servers:view');
  const own = await linkedRobloxIds(db, actor);
  if (!all && !own.length) return { items: [], canViewAll: false };
  const rows = await db
    .select()
    .from(privateServers)
    .where(all ? undefined : inArray(privateServers.ownerRobloxId, own))
    .orderBy(desc(privateServers.lastSeenAt))
    .limit(200);
  const items = await withDetails(db, rows);
  return { items: items.map((i) => ({ ...i, isOwner: own.includes(i.ownerRobloxId) })), canViewAll: all };
}

export async function getPrivateServer(db: DbExecutor, actor: Actor, id: string) {
  requireUser(actor);
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw errors.notFound('Privat-Server');
  const [row] = await db.select().from(privateServers).where(eq(privateServers.id, id));
  if (!row) throw errors.notFound('Privat-Server');
  const manage = await canManage(db, actor, row);
  if (!manage && !hasPermission(actor, 'roblox_servers:view')) throw errors.notFound('Privat-Server');
  const [detail] = await withDetails(db, [row]);
  return { ...detail!, canManage: manage };
}

export const updatePrivateServerSchema = z.object({
  name: z.string().trim().max(60).nullable().optional(),
  teamLock: z.boolean().optional(),
  teamFactions: z
    .record(z.string().trim().min(1).max(40), z.string().trim().min(1).max(40))
    .refine((v) => Object.keys(v).length <= 20, 'Höchstens 20 Teams.')
    .optional(),
  admins: z.array(z.number().int().positive()).max(MAX_ADMINS).optional(),
});

/** Einstellungen ändern: Besitzer (über die Discord-Verknüpfung) oder Team mit roblox_servers:configure. */
export async function updatePrivateServer(
  ctx: CoreContext,
  actor: Actor,
  id: string,
  input: z.infer<typeof updatePrivateServerSchema>,
) {
  const current = await getPrivateServer(ctx.db, actor, id);
  if (!current.canManage) throw errors.forbidden('Nur der Besitzer oder das Team darf diesen Privat-Server verwalten.');
  const now = ctx.now();
  const values: Partial<Row> = { updatedAt: now };
  if (input.name !== undefined) values.name = input.name || null;
  if (input.teamLock !== undefined) values.teamLock = input.teamLock;
  if (input.teamFactions !== undefined) values.teamFactions = input.teamFactions;
  if (input.teamLock && !input.teamFactions && !Object.keys(current.teamFactions).length)
    values.teamFactions = DEFAULT_TEAM_FACTIONS;
  if (input.admins !== undefined) values.admins = [...new Set(input.admins)].filter((a) => a !== current.ownerRobloxId);
  const updated = await ctx.db.transaction(async (tx) => {
    const [row] = await tx.update(privateServers).set(values).where(eq(privateServers.id, id)).returning();
    await writeAudit(
      tx,
      actor,
      {
        action: 'private_server.update',
        resourceType: 'private_server',
        resourceId: id,
        before: {
          name: current.name,
          teamLock: current.teamLock,
          teamFactions: current.teamFactions,
          admins: current.admins,
        },
        after: { name: row!.name, teamLock: row!.teamLock, teamFactions: row!.teamFactions, admins: row!.admins },
      },
      now,
    );
    return row!;
  });
  ctx.realtime.publish('servers', 'private_server.updated', { id });
  return getPrivateServer(ctx.db, actor, updated.id);
}
