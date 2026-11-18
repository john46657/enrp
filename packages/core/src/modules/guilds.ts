import { z } from 'zod';
import {
  and,
  asc,
  discordGuilds,
  eq,
  gameServers,
  inArray,
  privateServers,
  type DbExecutor,
  type DiscordGuildChannels,
} from '@enrp/database';
import { errors } from '@enrp/shared';
import { type Actor, requirePermission } from '../actor';
import { writeAudit } from '../audit';
import { type CoreContext } from '../context';
import { getSetting } from '../settings';

/**
 * Mehrere Discord-Server: der Haupt-Discord (DISCORD_GUILD_ID, Einstellungen wie bisher unter Konfiguration) und
 * weitere Discords – vor allem die Discords der Privat-Server. Jeder weitere Discord hat eigene Kanäle und Rollen
 * (Leitstelle, Mod-Calls, Spiel-Logs, Live-Panel). Ist er einem Privat-Server zugeordnet, landen dessen Notrufe,
 * Mod-Calls, Fahndungstreffer und Logs dort. Rechte gelten je Discord getrennt (role_bindings.guild_id); Discord-
 * Banns gelten nur im Discord, aus dem sie kommen – außer „global“, dann auch in allen Discords mit syncBans.
 */

type Row = typeof discordGuilds.$inferSelect;

const SNOW = z
  .string()
  .regex(/^\d{15,22}$/, 'Ungültige Discord-ID')
  .nullable()
  .optional();

export const guildChannelsSchema = z.object({
  dispatchChannelId: SNOW,
  dispatchPingRoleId: SNOW,
  modCallChannelId: SNOW,
  livePanelChannelId: SNOW,
  livePanelShowPlayers: z.boolean().optional(),
  gameLogs: z
    .object({
      killChannelId: SNOW,
      teamChannelId: SNOW,
      vehicleChannelId: SNOW,
      joinChannelId: SNOW,
      dutyChannelId: SNOW,
      actionChannelId: SNOW,
    })
    .optional(),
});

export const updateGuildSchema = z.object({
  kind: z.enum(['private_server', 'other']).optional(),
  privateServerId: z.uuid().nullable().optional(),
  active: z.boolean().optional(),
  syncBans: z.boolean().optional(),
  channels: guildChannelsSchema.optional(),
});

export const isMainGuild = (config: { guildId?: string }, guildId: string | null | undefined) =>
  !guildId || guildId === config.guildId;

/** Bot ist einem Discord beigetreten bzw. hat ihn beim Start gesehen (Haupt-Discord wird nicht gespeichert). */
export async function registerGuild(ctx: CoreContext, input: { id: string; name: string }) {
  if (isMainGuild(ctx.config, input.id)) return { main: true as const };
  const now = ctx.now();
  const [row] = await ctx.db
    .insert(discordGuilds)
    .values({ id: input.id, name: input.name.slice(0, 100), createdAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: discordGuilds.id,
      set: { name: input.name.slice(0, 100), botPresent: true, updatedAt: now },
    })
    .returning();
  return { main: false as const, guild: row! };
}

export async function markGuildLeft(ctx: CoreContext, guildId: string) {
  await ctx.db
    .update(discordGuilds)
    .set({ botPresent: false, updatedAt: ctx.now() })
    .where(eq(discordGuilds.id, guildId));
}

export async function listGuilds(ctx: CoreContext, actor: Actor) {
  requirePermission(actor, 'settings:view');
  const rows = await ctx.db
    .select({
      guild: discordGuilds,
      privateServerName: privateServers.name,
      ownerRobloxId: privateServers.ownerRobloxId,
    })
    .from(discordGuilds)
    .leftJoin(privateServers, eq(privateServers.id, discordGuilds.privateServerId))
    .orderBy(asc(discordGuilds.name));
  return {
    mainGuildId: ctx.config.guildId ?? null,
    items: rows.map((r) => ({
      ...r.guild,
      privateServer: r.guild.privateServerId
        ? { id: r.guild.privateServerId, name: r.privateServerName, ownerRobloxId: r.ownerRobloxId }
        : null,
    })),
  };
}

export async function getGuild(db: DbExecutor, id: string) {
  const [row] = await db.select().from(discordGuilds).where(eq(discordGuilds.id, id));
  if (!row) throw errors.notFound('Discord-Server');
  return row;
}

export async function updateGuild(
  ctx: CoreContext,
  actor: Actor,
  id: string,
  input: z.infer<typeof updateGuildSchema>,
  reason?: string,
) {
  requirePermission(actor, 'settings:edit');
  const current = await getGuild(ctx.db, id);
  const now = ctx.now();
  const values: Partial<Row> = { updatedAt: now };
  if (input.kind !== undefined) values.kind = input.kind;
  if (input.active !== undefined) values.active = input.active;
  if (input.syncBans !== undefined) values.syncBans = input.syncBans;
  if (input.channels !== undefined) values.channels = clean(input.channels);
  if (input.privateServerId !== undefined) {
    if (input.privateServerId) {
      const [ps] = await ctx.db.select().from(privateServers).where(eq(privateServers.id, input.privateServerId));
      if (!ps) throw errors.badRequest('Unbekannter Privat-Server.');
      const [taken] = await ctx.db
        .select({ id: discordGuilds.id })
        .from(discordGuilds)
        .where(eq(discordGuilds.privateServerId, input.privateServerId));
      if (taken && taken.id !== id)
        throw errors.conflict('Dieser Privat-Server ist schon einem anderen Discord zugeordnet.');
      values.kind = 'private_server';
    } else if (input.kind === undefined) values.kind = 'other';
    values.privateServerId = input.privateServerId;
  }
  const finalPs = values.privateServerId !== undefined ? values.privateServerId : current.privateServerId;
  if ((values.kind ?? current.kind) === 'private_server' && !finalPs)
    throw errors.badRequest('Für einen Privat-Server-Discord bitte den Privat-Server auswählen.');
  if ((values.kind ?? current.kind) === 'other' && finalPs) values.privateServerId = null;
  const row = await ctx.db.transaction(async (tx) => {
    const [updated] = await tx.update(discordGuilds).set(values).where(eq(discordGuilds.id, id)).returning();
    await writeAudit(
      tx,
      actor,
      {
        action: 'discord_guild.update',
        resourceType: 'discord_guild',
        resourceId: id,
        reason,
        before: pick(current),
        after: pick(updated!),
      },
      now,
    );
    return updated!;
  });
  return row;
}

const pick = (r: Row) => ({
  kind: r.kind,
  privateServerId: r.privateServerId,
  active: r.active,
  syncBans: r.syncBans,
  channels: r.channels,
});

/** Leere Felder entfernen, damit „leer = aus“ eindeutig ist. */
function clean(channels: z.infer<typeof guildChannelsSchema>): DiscordGuildChannels {
  const out: DiscordGuildChannels = {};
  for (const [k, v] of Object.entries(channels)) {
    if (k === 'gameLogs' && v && typeof v === 'object') {
      const logs = Object.fromEntries(Object.entries(v).filter(([, c]) => c));
      if (Object.keys(logs).length) out.gameLogs = logs;
    } else if (v !== null && v !== undefined && v !== '') {
      (out as Record<string, unknown>)[k] = v;
    }
  }
  return out;
}

/** Discord eines Spielservers (nur Privat-Server mit zugeordnetem, aktivem Discord). */
export async function guildForServer(db: DbExecutor, serverId: string | null | undefined) {
  if (!serverId) return null;
  const [row] = await db
    .select({ guild: discordGuilds })
    .from(gameServers)
    .innerJoin(privateServers, eq(privateServers.privateServerId, gameServers.privateServerId))
    .innerJoin(discordGuilds, eq(discordGuilds.privateServerId, privateServers.id))
    .where(and(eq(gameServers.id, serverId), eq(discordGuilds.active, true)));
  return row?.guild ?? null;
}

export async function guildForJobId(db: DbExecutor, jobId: string) {
  const [row] = await db.select({ id: gameServers.id }).from(gameServers).where(eq(gameServers.jobId, jobId));
  return guildForServer(db, row?.id);
}

/**
 * Wohin gehen Notrufe/Mod-Calls eines Servers? Privat-Server mit eigenem Discord und eingestelltem Kanal → dorthin,
 * sonst wie bisher in den Haupt-Discord.
 */
export async function dispatchTarget(ctx: CoreContext, serverId: string | null | undefined) {
  const guild = await guildForServer(ctx.db, serverId);
  const main = await getSetting(ctx.db, 'dispatch');
  const c = guild?.channels ?? {};
  return {
    guildId: guild?.id ?? null,
    channelId: c.dispatchChannelId ?? main.channelId,
    pingRoleId: c.dispatchChannelId ? (c.dispatchPingRoleId ?? null) : main.pingRoleId,
    modCallChannelId: c.modCallChannelId ?? main.modCallChannelId,
  };
}

/** Discords, in denen globale Discord-Banns zusätzlich gelten. */
export async function syncBanGuildIds(db: DbExecutor) {
  const rows = await db
    .select({ id: discordGuilds.id })
    .from(discordGuilds)
    .where(and(eq(discordGuilds.active, true), eq(discordGuilds.syncBans, true), eq(discordGuilds.botPresent, true)));
  return rows.map((r) => r.id);
}

/** Aktive weitere Discords mit Live-Panel (für den Worker). */
export async function livePanelGuilds(db: DbExecutor) {
  const rows = await db.select().from(discordGuilds).where(eq(discordGuilds.active, true));
  return rows.filter((r) => r.channels.livePanelChannelId);
}

/** JobIds der laufenden Server eines Privat-Servers (Live-Panel im Discord des Privat-Servers). */
export async function jobIdsForPrivateServer(db: DbExecutor, privateServerId: string) {
  const [ps] = await db.select().from(privateServers).where(eq(privateServers.id, privateServerId));
  if (!ps) return [];
  const rows = await db
    .select({ jobId: gameServers.jobId })
    .from(gameServers)
    .where(and(eq(gameServers.privateServerId, ps.privateServerId), inArray(gameServers.status, ['online'])));
  return rows.map((r) => r.jobId);
}
