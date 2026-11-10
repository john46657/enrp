import {
  bolos,
  discordPanels,
  dispatchIncidents,
  dispatchUnits,
  eq,
  inArray,
  ne,
  robloxUsers,
  sql,
  type DbExecutor,
} from '@enrp/database';
import { DISPATCH_OPEN_STATUS } from '@enrp/shared';
import { type Actor, actorId } from '../actor';
import { type CoreContext } from '../context';
import { getSetting } from '../settings';
import { onDutyCounts } from './duty';
import { onlineServers } from './live';

/**
 * Spiel-Logs nach Discord und Live-Panel. Die Ereignisse selbst stehen schon in game_events; hier wird nur
 * entschieden, was in welchen Kanal geht. Pro Ereignis-Charge und Kanal entsteht höchstens eine Sammelnachricht
 * (je 15 Einträge), damit Discord bei vielen Fahrzeug-Spawns nicht überflutet wird.
 */

export const LOG_CATEGORY = {
  player_killed: 'killChannelId',
  team_changed: 'teamChannelId',
  vehicle_spawned: 'vehicleChannelId',
  vehicle_despawned: 'vehicleChannelId',
  player_joined: 'joinChannelId',
  player_left: 'joinChannelId',
  duty_start: 'dutyChannelId',
  duty_end: 'dutyChannelId',
} as const;

export interface LogEntry {
  type: string;
  at: string;
  data: Record<string, unknown>;
}

const CHUNK = 15;

async function enqueueEntries(
  ctx: CoreContext,
  channelId: string,
  server: { jobId: string; serverType: string } | null,
  entries: LogEntry[],
) {
  for (let i = 0; i < entries.length; i += CHUNK) {
    await ctx.queue.enqueue('discord', 'gamelog.post', { channelId, server, entries: entries.slice(i, i + CHUNK) });
  }
}

function withName(data: Record<string, unknown>, names: Map<number, string>) {
  const id = typeof data.userId === 'number' ? data.userId : null;
  return id && !data.username && names.has(id) ? { ...data, username: names.get(id) } : data;
}

/** Verarbeitete Spielereignisse einer Charge in die eingestellten Log-Kanäle. */
export async function queueGameLogs(
  ctx: CoreContext,
  server: { jobId: string; serverType: string },
  events: Array<{ type: string; occurredAt?: string; data: unknown }>,
) {
  const relevant = events.filter((e) => e.type in LOG_CATEGORY);
  if (!relevant.length) return 0;
  const settings = await getSetting(ctx.db, 'game_logs');
  if (!Object.values(settings).some(Boolean)) return 0;
  // Namen ergänzen, wo das Spiel nur die ID schickt (z. B. player_left)
  const missing = [
    ...new Set(
      relevant
        .map((e) => e.data as { userId?: number; username?: string })
        .filter((d) => d?.userId && !d.username)
        .map((d) => d.userId!),
    ),
  ];
  const names = new Map(
    missing.length
      ? (
          await ctx.db
            .select({ id: robloxUsers.id, username: robloxUsers.username })
            .from(robloxUsers)
            .where(inArray(robloxUsers.id, missing))
        ).map((u) => [u.id, u.username])
      : [],
  );
  const byChannel = new Map<string, LogEntry[]>();
  for (const event of relevant) {
    const channelId = settings[LOG_CATEGORY[event.type as keyof typeof LOG_CATEGORY]];
    if (!channelId) continue;
    const list = byChannel.get(channelId) ?? [];
    list.push({
      type: event.type,
      at: event.occurredAt ?? ctx.now().toISOString(),
      data: withName((event.data ?? {}) as Record<string, unknown>, names),
    });
    byChannel.set(channelId, list);
  }
  for (const [channelId, entries] of byChannel) await enqueueEntries(ctx, channelId, server, entries);
  return relevant.length;
}

/** Aktion des Teams an einem Spieler (Gefängnis, Kick, …) in den Aktions-Log. */
export async function queueActionLog(
  ctx: CoreContext,
  actor: Actor,
  entry: { action: string; robloxUserId: number; username: string; reason: string; details?: Record<string, unknown> },
  server: { jobId: string; serverType: string },
) {
  const settings = await getSetting(ctx.db, 'game_logs');
  if (!settings.actionChannelId) return;
  await enqueueEntries(ctx, settings.actionChannelId, server, [
    {
      type: 'player_action',
      at: ctx.now().toISOString(),
      data: {
        ...entry.details,
        action: entry.action,
        userId: entry.robloxUserId,
        username: entry.username,
        reason: entry.reason,
        by: actorId(actor),
      },
    },
  ]);
}

// ---------------------------------------------------------------------------
// Live-Panel
// ---------------------------------------------------------------------------

/** Zahlen für das Live-Panel (ohne Rechteprüfung – nur Worker). */
export async function livePanelData(db: DbExecutor, now: Date) {
  const servers = await onlineServers(db, now);
  const players = servers.flatMap((s) => s.live.players.map((p) => ({ ...p, serverType: s.server.serverType })));
  const teams = new Map<string, number>();
  for (const p of players) teams.set(p.team ?? 'Ohne Team', (teams.get(p.team ?? 'Ohne Team') ?? 0) + 1);
  const [incidents] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(dispatchIncidents)
    .where(inArray(dispatchIncidents.status, [...DISPATCH_OPEN_STATUS]));
  const [activeBolos] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(bolos)
    .where(eq(bolos.status, 'active'));
  const [units] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(dispatchUnits)
    .where(ne(dispatchUnits.status, 'off_duty'));
  return {
    at: now.toISOString(),
    servers: servers.map((s) => ({
      jobId: s.server.jobId,
      serverType: s.server.serverType,
      playerCount: s.server.playerCount,
      maxPlayers: s.server.maxPlayers,
    })),
    playerCount: players.length,
    players: players.map((p) => ({ username: p.username, team: p.team ?? null })),
    teams: [...teams.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })),
    onDuty: await onDutyCounts(db),
    openIncidents: incidents?.count ?? 0,
    activeBolos: activeBolos?.count ?? 0,
    unitsOnDuty: units?.count ?? 0,
  };
}

export async function getPanel(db: DbExecutor, key: string) {
  const [row] = await db.select().from(discordPanels).where(eq(discordPanels.key, key));
  return row ?? null;
}

export async function savePanel(db: DbExecutor, key: string, channelId: string, messageId: string, now: Date) {
  await db
    .insert(discordPanels)
    .values({ key, channelId, messageId, updatedAt: now })
    .onConflictDoUpdate({ target: discordPanels.key, set: { channelId, messageId, updatedAt: now } });
}
